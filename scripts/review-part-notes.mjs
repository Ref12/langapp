// Full review of every accepted part note: a second model reads each entry against the rules and answers keep / fix / drop.
// Usage: node scripts/review-part-notes.mjs [--apply] [--model claude-sonnet-5.5] [--batch-size 25] [--concurrency 12] [--session-id part-notes-review]
//   Verdicts are kept in build/part-notes/review/verdicts.json (resumable). Without --apply it only asks; with --apply it rewrites
//   part-notes.yaml (a fix that fails validateEntry becomes a drop) and the state file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCaller, createThrottleLog } from './build-phrase-bank.mjs'
import { acceptedNotes, buildInputs, chunks, listFrom, loadState, pool, readSources, saveState, validateEntry } from './build-part-notes.mjs'
import { notesYamlPath, readNotesYaml, renderNotesYaml } from './part-notes-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CATEGORIES = ['speculative', 'disputed-origin', 'sound-relation', 'false-claim', 'wrong-role', 'not-about-character', 'other']

export const REVIEW_SYSTEM = [
  'You are a strict reviewer of notes in a Chinese character-writing app. Each entry says what each top-level part of a character does IN that character (role: meaning | sound | both | form | shape, plus a short note) and may have a one-sentence origin. These notes teach history as fact, so the bar is: plainly true, and about THIS character.',
  'You get the input data (reading, meaning, Make Me a Hanzi etymology type and hint, each part with its own meaning, reading and Make Me a Hanzi role) and the entry. Use your own knowledge of character etymology too.',
  'Rules:',
  '1. Speculative notes ("possibly", "role uncertain", "may be", "unclear", "not a secure account") are not acceptable: drop them (category speculative). Stating plainly that a simplified character\'s strokes do not map to meaningful parts is not speculation when it is true.',
  '2. An origin story that is disputed is kept only when worded "traditionally explained as ..." (or equivalent) AND it matches the Make Me a Hanzi hint. Otherwise remove the origin (fix: leave the origin out) and keep the part roles if they stand on their own; if the roles do not stand on their own, drop (category disputed-origin).',
  '3. A sound note must name a real phonetic relation: the part\'s reading and the character\'s reading, with the part genuinely the phonetic of this character (loose tone/initial/final differences are fine; a part that is not the phonetic is not). Otherwise fix the role/note if the correct one is certain, else drop (category sound-relation).',
  '4. A form or shape note that only restates the traditional form without saying what the part does here is fine as long as it is true.',
  'Also drop for: a false or invented claim (false-claim), a wrong role that cannot be certainly corrected (wrong-role), a note about the part in general rather than this character (not-about-character).',
  'Verdicts: "keep" (every part and the origin are true as written); "fix" only when you are CERTAIN of the corrected entry, giving the whole corrected entry (every part, same ids and order, role, note of at most about 8 words, optional origin of at most 200 characters; omit origin to remove it); "drop" with a category and a one-line reason.',
  'When unsure whether something is true, do not keep it: drop. Reply with JSON only: {"verdicts":[{"ch":"河","verdict":"keep"},{"ch":"X","verdict":"fix","entry":{"parts":[{"id":"氵","role":"meaning","note":"water"}],"origin":"..."},"reason":"..."},{"ch":"Y","verdict":"drop","category":"speculative","reason":"one line"}]}',
  'Return exactly one verdict per character, in the order given.',
].join('\n')

export const reviewPrompt = items => 'Review these ' + items.length + ' entries. Each is the input data, then the entry.\n' + items.map(({ input, entry }) => JSON.stringify(input) + '\nENTRY ' + JSON.stringify({ ch: input.ch, parts: entry.parts.map(part => ({ id: part.part, role: part.role, note: part.note })), ...(entry.origin ? { origin: entry.origin } : {}) })).join('\n\n')

/** Turns a model verdict into { verdict, entry?, category?, reason }; a fix that fails validation becomes a drop. */
export function settle(input, entry, raw) {
  const verdict = String(raw?.verdict ?? '').toLowerCase()
  if (verdict === 'keep') return { verdict: 'keep' }
  if (verdict === 'fix') {
    const { entry: fixed, problems } = validateEntry(input, raw.entry)
    const same = JSON.stringify(fixed) === JSON.stringify(entry)
    if (!problems.length && !same) return { verdict: 'fix', entry: fixed, reason: String(raw.reason ?? '') }
    if (!problems.length && same) return { verdict: 'keep' }
    return { verdict: 'drop', category: 'other', reason: 'fix failed checks: ' + problems.join('; ') }
  }
  if (verdict === 'drop') return { verdict: 'drop', category: CATEGORIES.includes(raw.category) ? raw.category : 'other', reason: String(raw.reason ?? '').split('\n')[0] }
  return undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : fallback }
  const model = flag('model', 'claude-sonnet-5.5'), batch = Number(flag('batch-size', 25)), concurrency = Number(flag('concurrency', 12))
  const dir = join(root, 'build', 'part-notes', 'review'), file = join(dir, 'verdicts.json')
  mkdirSync(dir, { recursive: true })
  const verdicts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const statePath = join(root, 'build', 'part-notes', 'state.json')
  const state = loadState(statePath)
  const notes = readNotesYaml()
  const inputs = new Map(buildInputs(readSources()).map(input => [input.ch, input]))
  const save = () => writeFileSync(file, JSON.stringify(verdicts))
  if (!argv.includes('--apply')) {
    const todo = Object.keys(notes).filter(ch => !verdicts[ch])
    console.log(Object.keys(notes).length + ' accepted, ' + todo.length + ' to review')
    const throttle = createThrottleLog(console.log)
    const call = createCaller({ baseUrl: flag('base-url', 'http://localhost:5210/v1'), apiKey: process.env.PART_NOTES_API_KEY, model, api: 'chat', timeoutMs: 300000, headers: { 'x-session-id': flag('session-id', 'part-notes-review'), 'x-hexad-client': 'part-notes' }, onRetry: info => throttle.note(info) })
    let done = 0, failed = 0
    await pool(chunks(todo, batch), concurrency, async group => {
      const items = group.map(ch => ({ input: inputs.get(ch), entry: notes[ch] }))
      for (let attempt = 0; attempt < 3; attempt++) {
        let list
        try { list = listFrom(await call(REVIEW_SYSTEM, reviewPrompt(items)), 'verdicts') } catch (error) { console.log('call failed: ' + error.message); continue }
        if (!list) continue
        const byCh = new Map(list.filter(row => row && typeof row.ch === 'string').map(row => [row.ch, row]))
        for (const { input, entry } of items) { const settled = byCh.has(input.ch) ? settle(input, entry, byCh.get(input.ch)) : undefined; if (settled) verdicts[input.ch] = settled }
        if (items.every(({ input }) => verdicts[input.ch])) break
      }
      done += group.length; save()
    }, error => { failed++; console.log('batch failed: ' + error.message) })
    throttle.flush(); save()
    console.log('reviewed ' + Object.keys(verdicts).length + ' of ' + Object.keys(notes).length + '; failed batches ' + failed)
    return
  }
  const missing = Object.keys(notes).filter(ch => !verdicts[ch])
  if (missing.length) throw new Error(missing.length + ' accepted entries have no verdict yet (' + missing.slice(0, 10).join('') + ')')
  syncWith(state, notes)
  for (const [ch, v] of Object.entries(verdicts)) {
    if (!notes[ch]) continue
    if (v.verdict === 'fix') state.chars[ch] = { ...state.chars[ch], status: 'accepted', entry: v.entry, reviewed: 'fixed' }
    else if (v.verdict === 'drop') state.chars[ch] = { status: 'dropped', by: 'review', reasons: [v.category + ': ' + v.reason] }
  }
  saveState(statePath, state)
  writeFileSync(notesYamlPath, renderNotesYaml(acceptedNotes(state)))
  const counts = { keep: 0, fix: 0, drop: {} }
  for (const v of Object.values(verdicts)) { if (v.verdict === 'drop') counts.drop[v.category] = (counts.drop[v.category] ?? 0) + 1; else counts[v.verdict]++ }
  console.log(JSON.stringify(counts))
}
function syncWith(state, notes) { for (const [ch, entry] of Object.entries(notes)) state.chars[ch] = { ...(state.chars[ch] ?? {}), status: 'accepted', entry } }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exitCode = 1 })
