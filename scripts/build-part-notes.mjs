// Builds the part notes: for each character, what each of its shown top-level parts does IN that character.
// Written offline, never in the build. Output: curriculum/chinese/characters/part-notes.yaml (reviewed source); the app's JSON,
// public/characters/chinese/part-notes.generated.json, is built from it by "npm run characters:origins" (scripts/part-notes-files.mjs).
//
// Pipeline (batched, about 22 characters per call, never one call per character):
//   1. Code builds each character's input from components.generated.json (the parts exactly as the app shows them, with each part's own
//      meaning and pinyin, its Make Me a Hanzi role, the character's etymology type and hint) and meanings.generated.json.
//   2. WRITE: Luna (responses API) gives each part a role (meaning | sound | both | form | shape) and a short note, plus an optional origin.
//   3. CODE VALIDATES: the parts equal the input's, in order; the role is one of the five; the note is short; a part Make Me a Hanzi calls
//      phonetic is a sound (or both) part, and one it calls semantic is not a sound-only part. A mismatch is flagged, never overridden.
//   4. CHECK: DeepSeek (chat API) looks for factual errors and wrong roles and flags an entry with a reason, or passes it.
//   5. Flagged entries go back to Luna ONCE with the reason (a second pass, batched the same way), are validated and checked again.
//      Anything still flagged is dropped: the app then shows today's display for it.
//   Progress is kept in the state file, so a stopped run resumes; hand edits to the YAML win over the state.
//
// Usage: node scripts/build-part-notes.mjs [--limit N] [--chars 前河好想] [--dry-run] [--drop 前,河] [--report]
//   Options: --base-url http://localhost:5210/v1, --writer-model gpt-6-luna --writer-api responses, --checker-model DeepSeek-V4.1-Flash --checker-api chat,
//            --batch-size 22, --concurrency 36, --session-id part-notes (sent as x-session-id on every call), --api-key-env NAME (default PART_NOTES_API_KEY),
//            --state build/part-notes/state.json, --out curriculum/chinese/characters/part-notes.yaml, --timeout 300 (seconds per attempt)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCaller, createThrottleLog } from './build-phrase-bank.mjs'
import { MAX_NOTE_CHARS, MAX_NOTE_WORDS, MAX_ORIGIN_CHARS, ROLES, notesYamlPath, readNotesYaml, renderNotesYaml } from './part-notes-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chineseDir = join(root, 'public', 'characters', 'chinese')
export const DEFAULT_BATCH_SIZE = 22
export const DEFAULT_CONCURRENCY = 36

// ---------- input ----------

const SLOTS = { '⿰': ['left', 'right'], '⿱': ['top', 'bottom'], '⿲': ['left', 'middle', 'right'], '⿳': ['top', 'middle', 'bottom'] }
/** The first senses of a Unihan-style gloss, as src/core/characters/components.ts shows them. */
const firstSenses = (text, count = 2) => text.includes(';') ? text.split(';').slice(0, count).map(sense => sense.trim()).filter(Boolean).join('; ') : text.split(', ').slice(0, count + 1).join(', ')

export function readSources(dir = chineseDir, glyphFile = join(root, 'src', 'data', 'characters', 'part-glyphs.generated.json')) {
  const read = file => JSON.parse(readFileSync(file, 'utf8'))
  return { data: read(join(dir, 'components.generated.json')), meanings: read(join(dir, 'meanings.generated.json')).meanings, glyphs: read(glyphFile) }
}

/** The top-level parts the app shows for a character (describeParts in src/core/characters/components.ts; a test keeps the two in step). */
export function shownParts(data, glyphs, character) {
  const entry = data.characters[character]
  if (!entry) return []
  const kids = entry.k ?? []
  const unmapped = kid => !!kid.u || (!kid.c && kid.s.length === 0)
  const claimed = new Set(kids.filter(kid => !kid.u).flatMap(kid => kid.s))
  const leftover = Array.from({ length: entry.n }, (_, i) => i).filter(stroke => !claimed.has(stroke))
  const parts = []
  kids.forEach((kid, index) => {
    const info = data.components[kid.c]
    const lacking = !kid.u && !!kid.c && !!glyphs.missing?.includes(kid.c)
    const drawn = !!kid.u || !kid.c || lacking
    const own = kid.s.length ? kid.s : unmapped(kid) && kids.filter(unmapped).length === 1 ? leftover : []
    const code = drawn && own.length ? glyphs.glyphs[character + ':' + own.join(',')] : undefined
    const glyph = drawn ? (code ? String.fromCodePoint(code) : undefined) : kid.c
    if (drawn && !glyph) return
    const slot = entry.d ? SLOTS[entry.d]?.[index] : undefined
    const noMeaning = (drawn && !lacking) || info?.status === 'none' || (info?.status === 'unknown' && !info.meaning)
    const meaning = noMeaning ? undefined : info?.byPosition && slot && info.byPosition[slot] ? info.byPosition[slot].en : info?.meaning?.en
    parts.push({ index, glyph, drawn, kid, info, slot, meaning: meaning ? firstSenses(meaning) : undefined })
  })
  return parts
}

/** One character's input for the model. id is what the model echoes back: the part's character, or [children] for a part drawn from strokes. */
export function buildInput(sources, character) {
  const { data, meanings, glyphs } = sources
  const entry = data.characters[character]
  const shown = shownParts(data, glyphs, character)
  const [py, en] = meanings[character] ?? []
  return {
    ch: character, py: py ?? '', en: en ?? '', type: entry.t ?? 'none', ...(entry.h ? { hint: entry.h } : {}),
    ...(entry.phoneticAlsoSemantic ? { also: entry.phoneticAlsoSemantic } : {}),
    parts: shown.map(part => {
      const kidsText = (part.kid.k ?? []).map(child => (child.c || '?') + (child.r ? '(' + child.r + ')' : ''))
      return {
        id: part.drawn ? '[' + ((part.kid.k ?? []).map(child => child.c).join('') || 'strokes') + ']' : part.glyph,
        own: part.meaning ?? null, py: part.drawn ? null : (meanings[part.glyph]?.[0] ?? part.info?.py ?? null),
        mmh: part.kid.r ?? null, ...(part.info?.meaning?.of && part.info.meaning.of !== part.glyph ? { variantOf: part.info.meaning.of } : {}),
        ...(kidsText.length ? { contains: kidsText } : {}), ...(part.kid.e?.t ? { partType: part.kid.e.t, ...(part.kid.e.h ? { partHint: part.kid.e.h } : {}) } : {}),
      }
    }),
  }
}

/** Every character with at least one shown part, in code point order, as inputs. */
export function buildInputs(sources, only) {
  const list = (only ?? Object.keys(sources.data.characters)).filter(ch => sources.data.characters[ch]).sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
  return list.map(ch => buildInput(sources, ch)).filter(input => input.parts.length)
}

// ---------- batching ----------

/** Chunks of about size, balanced: no chunk is a single item unless the whole list is (so only a lone last chunk could be one). */
export function chunks(list, size) {
  if (!list.length) return []
  const count = Math.ceil(list.length / size)
  const base = Math.floor(list.length / count), extra = list.length % count
  const out = []
  let at = 0
  for (let i = 0; i < count; i++) { const length = base + (i < extra ? 1 : 0); out.push(list.slice(at, at + length)); at += length }
  return out
}

// ---------- validation ----------

const wordsOf = text => text.trim().split(/\s+/).filter(Boolean).length
/** Normalises a raw entry from the model; returns { entry, problems }. Never changes a role. */
export function validateEntry(input, raw) {
  const problems = []
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) return { problems: ['no parts list'] }
  if (raw.parts.length !== input.parts.length) problems.push('expected ' + input.parts.length + ' parts, got ' + raw.parts.length)
  const parts = []
  input.parts.forEach((want, at) => {
    const got = raw.parts[at]
    if (!got || typeof got !== 'object') { problems.push('part ' + (at + 1) + ' missing'); return }
    if (got.id !== want.id) problems.push('part ' + (at + 1) + ' is ' + JSON.stringify(got.id) + ', expected ' + want.id)
    const role = typeof got.role === 'string' ? got.role.trim().toLowerCase() : ''
    if (!ROLES.includes(role)) problems.push(want.id + ': role "' + got.role + '" is not one of ' + ROLES.join('/'))
    const note = typeof got.note === 'string' ? got.note.trim() : ''
    if (!note) problems.push(want.id + ': empty note')
    else if (wordsOf(note) > MAX_NOTE_WORDS || note.length > MAX_NOTE_CHARS || /[\r\n]/.test(note)) problems.push(want.id + ': note too long (at most about 8 words): ' + note)
    if (want.mmh === 'phonetic' && ROLES.includes(role) && role !== 'sound' && role !== 'both') problems.push(want.id + ': Make Me a Hanzi marks it phonetic, but the role is ' + role)
    if (want.mmh === 'semantic' && role === 'sound') problems.push(want.id + ': Make Me a Hanzi marks it semantic, but the role is sound')
    parts.push({ part: want.id, role, note })
  })
  let origin
  if (raw.origin !== undefined && raw.origin !== null && String(raw.origin).trim() !== '') {
    origin = String(raw.origin).trim()
    if (origin.length > MAX_ORIGIN_CHARS || /[\r\n]/.test(origin)) problems.push('origin too long or not one line')
  }
  return { entry: { ...(origin ? { origin } : {}), parts }, problems }
}

// ---------- prompts ----------

export const WRITER_SYSTEM = [
  'You write short notes for a Chinese character-writing app. For each character you get its top-level parts exactly as the app shows them.',
  'The app used to show each part\'s own dictionary meaning, which misleads: a part may be in the character for its sound, for an older form, or only for its shape.',
  'For each part say what it does IN THIS CHARACTER. Reply with JSON only: {"items":[{"ch":"河","parts":[{"id":"氵","role":"meaning","note":"water: a river"},...],"origin":"..."}]}',
  'Return one item per character, in the order given; "parts" must repeat every input part in the same order with the same "id" (copy the id exactly).',
  'role is exactly one of:',
  '  meaning: the part contributes meaning here;',
  '  sound: the part gives the pronunciation (a phonetic);',
  '  both: it gives sound and also meaning;',
  '  form: the part stands for an older or different element (for example 月 for 舟 "boat" in 前, or 又 standing in for a complex part of a traditional character);',
  '  shape: it only matches the shape; it carries neither sound nor meaning.',
  'note: what the part contributes here, at most about 8 words, in English. Examples: 氵 in 河: "water: a river"; 可 in 河: "sound kě → hé"; 月 in 前: "once 舟 boat: the foot is on a boat". For a sound part give its reading and the character\'s reading ("sound kě → hé"); sounds are often only approximate, so say "sound xiāng → xiǎng", never claim they are identical.',
  'origin (optional, one sentence, at most 200 characters): how the parts make the meaning, when that is clear, e.g. 前: "A foot 止 on a boat 舟: moving forward; 刂 added later." Leave it out when the history is not clear.',
  'Do not offer a modern mnemonic or folk story as history. When a simplified character dropped or replaced parts of the traditional form, say so (role form or shape). Say what the part is or stands for here ("woman", "boat, once 舟"); do not write "part of the traditional explanation".',
  'Be plainly true. Never invent. Where the history is uncertain or only traditional, say "traditionally explained as ..." or just state the role. Do not repeat the part\'s dictionary meaning if it is not what the part does here.',
  'Input fields: ch, py (pinyin), en (short meaning); type and hint: the character\'s etymology type (pictophonetic, ideographic, pictographic, or none) and the Make Me a Hanzi hint, which can be wrong or terse; "also": the phonetic part that also carries meaning.',
  'Per part: id; own (its own dictionary meaning, null if none); py; mmh (Make Me a Hanzi role: "semantic", "phonetic" or null; trust it for sound versus meaning unless it is clearly wrong); variantOf (it is a form of this radical); contains (its own pieces); partType/partHint.',
  'A part marked mmh "phonetic" must be role sound or both. A part marked "semantic" is not a sound-only part. A part in brackets such as [丷一] is drawn from strokes: describe what those pieces are or stand for.',
  'Worked examples (the style, not text to copy):',
  '前 (qián, front): parts [丷一] and 刖. [丷一]: form, "worn-down 止 foot"; 刖: form, "月 for 舟 boat; 刂 added later"; origin "A foot 止 on a boat 舟: moving forward; 刂 was added later."',
  '河 (hé, river): 氵 meaning "water: a river"; 可 sound "sound kě → hé".',
  '想 (xiǎng, think): 相 sound "sound xiāng → xiǎng"; 心 meaning "heart: thinking".',
].join('\n')

export const CHECKER_SYSTEM = [
  'You are a careful fact-checker for notes in a Chinese character-writing app. Each entry says what each top-level part of a character does IN that character: role (meaning | sound | both | form | shape) and a short note, plus an optional origin sentence.',
  'Role meanings: meaning = contributes meaning; sound = gives the pronunciation; both = sound and meaning; form = stands for an older or different element; shape = only matches the shape.',
  'Flag an entry only for a clear problem: a wrong role (for example a sound part called meaning, or the reverse); a false or invented claim about the part, its reading, or the character\'s history; a sound claim whose readings are wrong; or a note that is about the part in general rather than this character. Do not flag style, brevity, or hedged ("traditionally explained as ...") statements that are reasonable.',
  'A note "sound X → Y" is correct when X is the recognised phonetic component of the character; the readings need not match in tone, initial or final (do not flag that). A top-level part may be a bundle (for example 刖 in 前 is 月 + 刂, where 月 stands for 舟 boat): judge the note against the whole bundle, and the part ids are as the app shows them. The character type "none" only means the source has no type for it.',
  'When the input\'s hint (from Make Me a Hanzi) gives an explanation and the entry presents it as traditional ("traditionally explained as ..."), do not flag it even if scholars dispute it (for example 好 as 女 woman + 子 child).',
  'Be lenient about wording and emphasis; flag only what you are confident is wrong.',
  'Use your own knowledge of Chinese character etymology and the data given (Make Me a Hanzi roles and hints are usually right but not always).',
  'Reply with JSON only: {"flagged":[{"ch":"X","reason":"what is wrong and what it should say"}]}. List only flagged entries; {"flagged":[]} when all pass.',
].join('\n')

const lineOf = input => JSON.stringify(input)

export const writePrompt = (inputs, prior = {}) => 'Write the notes for these ' + inputs.length + ' characters (input: one JSON object per line). Reply with ONE JSON object {"items":[...]} holding all ' + inputs.length + ' items.\n' + inputs.map(input => lineOf(input) + (prior[input.ch] ? '\nYour previous attempt was flagged: ' + prior[input.ch].reasons.join(' | ') + '\nPrevious attempt: ' + JSON.stringify(prior[input.ch].entry ?? null) + '\nWrite it again so that it is correct.' : '')).join('\n')

export const checkPrompt = (items) => 'Check these ' + items.length + ' entries. Each line is the input data, then the proposed entry.\n' + items.map(({ input, entry }) => lineOf(input) + '\nENTRY ' + JSON.stringify({ ch: input.ch, parts: entry.parts.map(part => ({ id: part.part, role: part.role, note: part.note })), ...(entry.origin ? { origin: entry.origin } : {}) })).join('\n\n')

// ---------- one pass over a group ----------

/** Every top-level JSON object in a reply (the writer sometimes answers with one object per line instead of one object). */
export function jsonObjects(text) {
  const found = []
  let depth = 0, start = -1, inString = false, escaped = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue }
    if (char === '"') inString = true
    else if (char === '{') { if (depth++ === 0) start = at }
    else if (char === '}' && depth > 0 && --depth === 0) { try { found.push(JSON.parse(text.slice(start, at + 1))) } catch { /* skip it */ } }
  }
  return found
}

/** A reply's list under key ("items" or "flagged"), merged over every object in it; undefined when there is no such list. */
export function listFrom(text, key) {
  const list = []
  let seen = false
  for (const object of jsonObjects(text)) {
    if (Array.isArray(object[key])) { seen = true; list.push(...object[key]) } else if (typeof object.ch === 'string') { seen = true; list.push(object) } // a bare item on its own line
  }
  return seen ? list : undefined
}

/** Calls the model and parses the list from the reply; an unusable reply is asked for once more. */
async function askList(call, system, user, key) {
  for (let attempt = 0; ; attempt++) {
    const list = listFrom(await call(system, user), key)
    if (list) return list
    if (attempt >= 1) throw new Error('the reply had no "' + key + '" list')
  }
}

/** Writes, validates and checks one group of inputs. Returns { [ch]: { entry } | { flags: string[], entry? } }; throws when a model call fails for good. */
export async function processGroup({ inputs, io, prior, log = () => {} }) {
  const rows = new Map((await askList(io.write, WRITER_SYSTEM, writePrompt(inputs, prior), 'items')).filter(item => item && typeof item.ch === 'string').map(item => [item.ch, item]))
  const result = {}, toCheck = []
  for (const input of inputs) {
    const raw = rows.get(input.ch)
    if (!raw) { result[input.ch] = { missing: true }; continue }
    const { entry, problems } = validateEntry(input, raw)
    if (problems.length) result[input.ch] = { flags: problems, entry }
    else toCheck.push({ input, entry })
  }
  if (toCheck.length) {
    const flagged = new Map((await askList(io.check, CHECKER_SYSTEM, checkPrompt(toCheck), 'flagged')).filter(row => row && typeof row.ch === 'string').map(row => [row.ch, String(row.reason ?? '').trim() || 'flagged by the checker']))
    for (const { input, entry } of toCheck) result[input.ch] = flagged.has(input.ch) ? { flags: ['checker: ' + flagged.get(input.ch)], entry } : { entry }
  }
  return result
}

// ---------- state ----------

export const emptyState = () => ({ version: 1, chars: {}, stats: { calls: { write: 0, check: 0 }, failures: 0, retries: 0, ms: 0, runs: 0 } })

export function loadState(file) {
  if (!existsSync(file)) return emptyState()
  const state = JSON.parse(readFileSync(file, 'utf8'))
  return { ...emptyState(), ...state, stats: { ...emptyState().stats, ...state.stats, calls: { ...emptyState().stats.calls, ...state.stats?.calls } } }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.tmp'
  writeFileSync(temp, JSON.stringify(state))
  renameSync(temp, file)
}

/** The YAML wins over the state: an accepted character missing from it was dropped in review; a character in it is accepted. */
export function syncWithYaml(state, notes) {
  for (const [ch, record] of Object.entries(state.chars)) if (record.status === 'accepted' && !notes[ch]) state.chars[ch] = { status: 'dropped', by: 'review', reasons: record.reasons ?? [] }
  for (const [ch, entry] of Object.entries(notes)) state.chars[ch] = { ...(state.chars[ch]?.status === 'accepted' ? state.chars[ch] : {}), status: 'accepted', entry }
}

export const acceptedNotes = state => Object.fromEntries(Object.entries(state.chars).filter(([, record]) => record.status === 'accepted').map(([ch, record]) => [ch, record.entry]))

export function countsOf(state) {
  const counts = { accepted: 0, droppedChecker: 0, droppedReview: 0, pending: 0, flagged: 0, roles: { meaning: 0, sound: 0, both: 0, form: 0, shape: 0 }, withOrigin: 0 }
  for (const record of Object.values(state.chars)) {
    if (record.status === 'accepted') { counts.accepted++; if (record.entry.origin) counts.withOrigin++; for (const part of record.entry.parts) counts.roles[part.role]++ }
    else if (record.status === 'dropped') counts[record.by === 'review' ? 'droppedReview' : 'droppedChecker']++
    else counts[record.status === 'flagged' ? 'flagged' : 'pending']++
  }
  return counts
}

// ---------- the run ----------

/** Runs groups with at most concurrency in flight; a failing group is reported through onError and does not stop the others. */
export async function pool(groups, concurrency, work, onError) {
  let next = 0
  const run = async () => { while (next < groups.length) { const group = groups[next++]; try { await work(group) } catch (reason) { onError(group, reason) } } }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), groups.length) }, run))
}

export async function runPipeline({ inputs, state, io, options, log = () => {}, save = () => {} }) {
  const byCh = new Map(inputs.map(input => [input.ch, input]))
  const pass = async (wanted, label, redo) => {
    const groups = chunks(wanted, options.batchSize)
    log(label + ': ' + wanted.length + ' characters in ' + groups.length + ' batches of about ' + options.batchSize)
    let done = 0
    await pool(groups, options.concurrency, async group => {
      const prior = redo ? Object.fromEntries(group.map(input => [input.ch, { reasons: state.chars[input.ch].reasons, entry: state.chars[input.ch].raw }])) : undefined
      const result = await processGroup({ inputs: group, io, prior, log })
      for (const [ch, row] of Object.entries(result)) {
        if (row.missing) continue // the writer left it out: it stays pending (or flagged) and is asked again
        if (!row.flags) state.chars[ch] = { status: 'accepted', entry: row.entry, round: redo ? 2 : 1, ...(redo ? { reasons: state.chars[ch].reasons } : {}) }
        else if (redo) state.chars[ch] = { status: 'dropped', by: 'checker', reasons: [...(state.chars[ch].reasons ?? []), 'after rewrite: ' + row.flags.join(' | ')] }
        else state.chars[ch] = { status: 'flagged', reasons: row.flags, raw: row.entry }
      }
      done++
      if (done % 10 === 0) log(label + ': ' + done + '/' + groups.length + ' batches')
      save()
    }, (group, reason) => { state.stats.failures++; log('batch of ' + group.length + ' (' + group[0].ch + '...) failed: ' + (reason instanceof Error ? reason.message : reason)) })
  }
  const pending = () => inputs.filter(input => !['accepted', 'dropped', 'flagged'].includes(state.chars[input.ch]?.status))
  await pass(pending(), 'pass 1 (write and check)', false)
  if (pending().length) await pass(pending(), 'pass 1 again for failed batches', false)
  const flagged = inputs.filter(input => state.chars[input.ch]?.status === 'flagged')
  if (flagged.length) await pass(flagged, 'pass 2 (rewrite flagged, check again)', true)
  const left = inputs.filter(input => state.chars[input.ch]?.status === 'flagged')
  if (left.length) await pass(left, 'pass 2 again for batches that failed or came back short', true)
  for (const input of inputs) if (state.chars[input.ch]?.status === 'flagged') state.chars[input.ch] = { status: 'dropped', by: 'checker', reasons: [...state.chars[input.ch].reasons, 'no rewrite came back'] }
  save()
  return byCh.size
}

// ---------- command line ----------

export function parseArgs(argv, env = process.env) {
  const flags = new Map()
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (!arg.startsWith('--')) throw new Error('Unexpected argument: ' + arg)
    const [name, inline] = arg.slice(2).split(/=(.*)/s)
    flags.set(name, ['dry-run', 'report', 'help'].includes(name) ? true : inline ?? argv[++at])
  }
  const get = (name, fallback) => flags.get(name) ?? fallback
  return {
    help: flags.has('help'), dryRun: flags.has('dry-run'), report: flags.has('report'),
    baseUrl: get('base-url', 'http://localhost:5210/v1'), apiKey: env[get('api-key-env', 'PART_NOTES_API_KEY')],
    writer: { model: get('writer-model', 'gpt-6-luna'), api: get('writer-api', 'responses') }, checker: { model: get('checker-model', 'DeepSeek-V4.1-Flash'), api: get('checker-api', 'chat') },
    batchSize: Math.max(2, Number(get('batch-size', DEFAULT_BATCH_SIZE))), concurrency: Math.max(1, Math.floor(Number(get('concurrency', DEFAULT_CONCURRENCY))) || 1),
    sessionId: get('session-id', 'part-notes'), timeoutMs: Number(get('timeout', 300)) * 1000,
    limit: flags.has('limit') ? Number(flags.get('limit')) : undefined, chars: flags.has('chars') ? [...flags.get('chars')] : undefined,
    drop: flags.has('drop') ? [...String(flags.get('drop')).replace(/[,\s]/g, '')] : [],
    state: resolve(get('state', join(root, 'build', 'part-notes', 'state.json'))), out: resolve(get('out', notesYamlPath)),
  }
}

export function createIO(options, log = () => {}, fetchImpl) {
  const throttle = createThrottleLog(log)
  const calls = { write: 0, check: 0 }
  const make = (role, kind) => {
    const call = createCaller({ onRetry: info => { calls.retries = (calls.retries ?? 0) + 1; throttle.note(info) }, headers: { 'x-session-id': options.sessionId, 'x-hexad-client': 'part-notes' }, baseUrl: options.baseUrl, apiKey: options.apiKey, model: role.model, api: role.api, timeoutMs: options.timeoutMs, ...(fetchImpl ? { fetchImpl, sleep: async () => {} } : {}) })
    return async (system, user) => { calls[kind]++; return call(system, user) }
  }
  return { write: make(options.writer, 'write'), check: make(options.checker, 'check'), calls, flushThrottle: throttle.flush }
}

export async function main(argv = process.argv.slice(2), { log = console.log, fetchImpl } = {}) {
  const options = parseArgs(argv)
  if (options.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')); return }
  const sources = readSources()
  let inputs = buildInputs(sources, options.chars)
  if (options.limit) inputs = inputs.slice(0, options.limit)
  const state = loadState(options.state)
  syncWithYaml(state, readNotesYaml(options.out))
  for (const ch of options.drop) if (state.chars[ch]) state.chars[ch] = { status: 'dropped', by: 'review', reasons: ['dropped in review'] }
  const write = () => { saveState(options.state, state); writeFileSync(options.out, renderNotesYaml(acceptedNotes(state))) }
  if (options.drop.length) { write(); log('dropped ' + options.drop.join('')); return }
  if (options.report) { log(JSON.stringify(countsOf(state), null, 1) + '\n' + JSON.stringify(state.stats)); return }
  if (options.dryRun) {
    const todo = inputs.filter(input => !['accepted', 'dropped', 'flagged'].includes(state.chars[input.ch]?.status))
    const groups = chunks(todo, options.batchSize)
    log(inputs.length + ' characters with shown parts; ' + todo.length + ' to write in ' + groups.length + ' batches (' + groups.map(group => group.length).join(',') + '); first: ' + JSON.stringify(inputs[0]))
    return
  }
  log('session id: ' + options.sessionId)
  const io = createIO(options, log, fetchImpl)
  const started = Date.now()
  let timer
  const save = () => { if (!timer) timer = setTimeout(() => { timer = undefined; write() }, 3000) }
  const stop = () => { try { addStats(state, io, started); write() } finally { process.exit(130) } }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try { await runPipeline({ inputs, state, io, options, log, save }) } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); clearTimeout(timer) }
  io.flushThrottle()
  const calls = { ...io.calls }
  addStats(state, io, started)
  write()
  log(JSON.stringify(countsOf(state)))
  log('calls: ' + JSON.stringify(calls) + ', failed batches: ' + state.stats.failures + ', this run took ' + Math.round((Date.now() - started) / 1000) + ' s')
}

function addStats(state, io, started) {
  state.stats.calls.write += io.calls.write; state.stats.calls.check += io.calls.check; state.stats.retries += io.calls.retries ?? 0
  state.stats.ms += Date.now() - started; state.stats.runs++
  io.calls.write = io.calls.check = 0; io.calls.retries = 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exitCode = 1 })
