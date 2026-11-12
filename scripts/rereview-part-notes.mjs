// Second look at part notes the first review dropped as disputed-origin, sound-relation, speculative or not-about-character.
// Usage: node scripts/rereview-part-notes.mjs [--apply] [--original <commit with the pre-review YAML>] [--model claude-sonnet-5.5] [--batch-size 25] [--concurrency 12]
// Verdicts go to build/part-notes/review/second.json (resumable); --apply merges restored entries into part-notes.yaml.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { createCaller, createThrottleLog } from './build-phrase-bank.mjs'
import { buildInputs, chunks, listFrom, pool, readSources, validateEntry } from './build-part-notes.mjs'
import { notesYamlPath, parseNotesYaml, readNotesYaml, renderNotesYaml } from './part-notes-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const RECHECK = ['disputed-origin', 'sound-relation', 'speculative', 'not-about-character']

export const SECOND_SYSTEM = [
  'You give a second look at notes for a Chinese character-writing app that a first, too strict reviewer dropped. Each entry says what each top-level part of a character does IN that character (role: meaning | sound | both | form | shape, plus a short note) and may have a one-sentence origin. You get the input data (reading, meaning, Make Me a Hanzi etymology type and hint, parts with their own meaning, reading and role), the original entry and the first reviewer\'s reason.',
  'Rules for restoring:',
  '- A paleographic origin documented in standard references (oracle-bone or bronze forms, Shuowen) may be kept, worded "originally ..." or "traditionally explained as ...". It must be a documented account, not your guess.',
  '- A sound role is right when the part is a recognised phonetic of the character in standard references, even if the modern readings have drifted. Then use role sound (or both) and write the note as "old sound element" (optionally with what it meant), NOT a modern reading arrow such as kě → hé, unless the readings really are close.',
  '- Speculative notes ("possibly", "unclear", "may be") stay dropped. If you are not sure it is documented and true, drop.',
  '- Anything else in the entry must also be plainly true and about this character. You may correct notes, roles and origin when you are certain.',
  'Verdicts: "restore" with the whole corrected entry (every part, same ids and order, role, note of at most about 8 words, optional origin of at most 200 characters), or "drop" with a one-line reason.',
  'Reply with JSON only: {"verdicts":[{"ch":"前","verdict":"restore","entry":{"parts":[{"id":"止","role":"meaning","note":"..."}],"origin":"..."}},{"ch":"X","verdict":"drop","reason":"one line"}]}. Exactly one verdict per character, in order.',
].join('\n')

export const secondPrompt = items => 'Reconsider these ' + items.length + ' entries.\n' + items.map(({ input, entry, why }) => JSON.stringify(input) + '\nORIGINAL ' + JSON.stringify({ ch: input.ch, parts: entry.parts.map(part => ({ id: part.part, role: part.role, note: part.note })), ...(entry.origin ? { origin: entry.origin } : {}) }) + '\nFIRST REVIEW (' + why.category + '): ' + why.reason).join('\n\n')

export function settleSecond(input, raw) {
  const verdict = String(raw?.verdict ?? '').toLowerCase()
  if (verdict === 'restore') {
    const { entry, problems } = validateEntry(input, raw.entry)
    return problems.length ? { verdict: 'drop', reason: 'failed checks: ' + problems.join('; ') } : { verdict: 'restore', entry }
  }
  if (verdict === 'drop') return { verdict: 'drop', reason: String(raw.reason ?? '').split('\n')[0] }
  return undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : fallback }
  const dir = join(root, 'build', 'part-notes', 'review'), file = join(dir, 'second.json')
  mkdirSync(dir, { recursive: true })
  const second = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const first = JSON.parse(readFileSync(join(dir, 'verdicts.json'), 'utf8'))
  const save = () => writeFileSync(file, JSON.stringify(second))
  if (argv.includes('--apply')) {
    const notes = readNotesYaml()
    const counts = {}
    for (const [ch, v] of Object.entries(second)) {
      const cat = first[ch].category; counts[cat] ??= { restored: 0, stayed: 0 }
      if (v.verdict === 'restore') { notes[ch] = v.entry; counts[cat].restored++ } else counts[cat].stayed++
    }
    writeFileSync(notesYamlPath, renderNotesYaml(notes))
    console.log(JSON.stringify(counts)); return
  }
  const original = parseNotesYaml(execFileSync('git', ['show', flag('original', 'b24c4435') + ':curriculum/chinese/characters/part-notes.yaml'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }))
  const inputs = new Map(buildInputs(readSources()).map(input => [input.ch, input]))
  const todo = Object.keys(first).filter(ch => first[ch].verdict === 'drop' && RECHECK.includes(first[ch].category) && !second[ch])
  console.log(todo.length + ' to look at again')
  const throttle = createThrottleLog(console.log)
  const call = createCaller({ baseUrl: flag('base-url', 'http://localhost:5210/v1'), apiKey: process.env.PART_NOTES_API_KEY, model: flag('model', 'claude-sonnet-5.5'), api: 'chat', timeoutMs: 300000, headers: { 'x-session-id': flag('session-id', 'part-notes-review'), 'x-hexad-client': 'part-notes' }, onRetry: info => throttle.note(info) })
  await pool(chunks(todo, Number(flag('batch-size', 25))), Number(flag('concurrency', 12)), async group => {
    const items = group.map(ch => ({ input: inputs.get(ch), entry: original[ch], why: first[ch] }))
    for (let attempt = 0; attempt < 3; attempt++) {
      let list
      try { list = listFrom(await call(SECOND_SYSTEM, secondPrompt(items)), 'verdicts') } catch (error) { console.log('call failed: ' + error.message); continue }
      if (!list) continue
      const byCh = new Map(list.filter(row => row && typeof row.ch === 'string').map(row => [row.ch, row]))
      for (const { input } of items) { const s = byCh.has(input.ch) ? settleSecond(input, byCh.get(input.ch)) : undefined; if (s) second[input.ch] = s }
      if (items.every(({ input }) => second[input.ch])) break
    }
    save()
  }, (group, error) => console.log('batch failed: ' + error.message))
  throttle.flush(); save()
  console.log('done ' + Object.keys(second).length + ' of ' + todo.length)
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exitCode = 1 })
