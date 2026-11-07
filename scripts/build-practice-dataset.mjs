// Builds the practice dataset (Ideas #202, sections 6 and 6a): pre-generated material the practice engine cannot derive from single phrases. Written offline, never in the build.
//
// Four kinds, one JSON file per band each (src/data/practice/<kind>-hsk-N.json) plus src/data/practice/index.json with counts:
//   accepted       other natural Chinese wordings / word orders and other English translations for each shipped phrase (+ words that are optional), so Translate and
//                  Tiles can be marked without AI.   Unit: a batch of --batch-size (25) phrases of one band, in readiness order.
//   exchanges      two-line exchanges, a question and a fitting reply, plus 2-3 plausible wrong replies.   Unit: one lesson (--per-lesson 6 exchanges per call).
//   grammar        per grammar point: a short explanation note and near-miss wrong versions of real bank phrases, each with a one-line why.   Unit: --batch-size 4 points.
//   conversations  4-8 lines, named speakers each marked female or male, 2 comprehension questions with exactly one right answer. Only where the lesson's words
//                  support one (--min-vocab words known, and the writer may answer with none); never padded.   Unit: one lesson (up to --conv-per-lesson 2).
//
// Pipeline per unit (batched, never one call per item): WRITE (writer model) -> CODE VALIDATES (every Chinese word must be ready by the item's readyAt, the same
// known-words rule as phrases; shapes; exactly one right option) -> CHECK (checker model, one call per batch; a conversation's questions are answered blind and must
// match the writer's single right answer) -> DEDUPE -> state + band files written. Items carry words, grammar and readyAt like phrases, and a 'speaker' voice
// (female or male) on every spoken line so audio can be added without a format change.
//
// Resumable: a unit finished (even with nothing kept) is recorded in the state file and skipped on the next run; a unit whose model call failed is simply done again.
// The band files are also read back at start, so a lost state file only loses the 'nothing kept' markers. --redo ignores the markers for the selected scope.
//
// Usage (hexad's gateway is http://localhost:5210/v1; set PRACTICE_API_KEY if it needs one):
//   node scripts/build-practice-dataset.mjs --report                       # units and model calls per kind and band, nothing written
//   node scripts/build-practice-dataset.mjs --kind accepted --band 1 --session-id practice-1
//   node scripts/build-practice-dataset.mjs --kind exchanges,grammar,conversations --band 1 --lessons 1-10 --limit 5
//   Options: --kind accepted,exchanges,grammar,conversations (default all), --band 1,2, --lessons 1-10 (lessons counted from 1; for phrases: their readyAt lesson),
//            --concurrency 32 (env PRACTICE_CONCURRENCY), --session-id ID (env PRACTICE_SESSION_ID; x-session-id on every call), --base-url URL (env PRACTICE_BASE_URL),
//            --writer-model gpt-6-luna --writer-api responses --checker-model DeepSeek-V4.1-Flash --checker-api chat, --api-key-env NAME (default PRACTICE_API_KEY, then PHRASE_API_KEY),
//            --batch-size N (accepted 25, grammar 4), --per-lesson 6, --conv-per-lesson 2, --per-point 6, --min-vocab 25, --limit N (units per kind), --redo, --dry-run,
//            --save-interval 5, --state FILE (default build/practice-dataset/state.json), --out DIR (default src/data/practice), --phrases-dir DIR (default src/data/phrases),
//            --data-dir DIR (default src/data/v2)
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BANDS, MAX_PHRASE_SYLLABLES, allowedFor, applyGrammar, buildCurriculum, createCaller, createThrottleLog, grammarFor, parseJSONReply, parseLessons, phraseKey, phrasePinyin, readCatalog, vocabularyFor } from './build-phrase-bank.mjs'
import { writeAtomic } from './phrase-bank-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export { BANDS, phraseKey }
export const KINDS = ['accepted', 'exchanges', 'grammar', 'conversations']
export const SCHEMA_VERSION = 1
export const VOICES = ['female', 'male']
export const NEAR_MISS_KINDS = ['order', 'particle', 'missing-particle', 'adverb', 'measure', 'negation', 'other']
export const MAX_LINE_SYLLABLES = 20
export const MAX_ALTERNATIVES = 6
const HAN = /\p{Script=Han}/u
const hanCount = text => Array.from(text).filter(char => HAN.test(char)).length
const text = value => typeof value === 'string' ? value.trim() : ''
const list = value => Array.isArray(value) ? value : []
const hash = value => createHash('sha1').update(value).digest('hex').slice(0, 8)
const lessonNumber = index => index + 1
const normalEnglish = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ---------------------------------------------------------------- windows: what may be used at a lesson

const labelCache = new WeakMap()
function labelOf(curriculum, form) {
  let labels = labelCache.get(curriculum)
  if (!labels) { labels = new Map(); for (const word of curriculum.ordered) if (!labels.has(word.ch)) labels.set(word.ch, word.lb); labelCache.set(curriculum, labels) }
  return labels.get(form)
}

const allowedCache = new WeakMap()
/** The window of a lesson index: the words and grammar introduced by then plus the function characters (what a phrase of readyAt = index may use). Cached. */
export function allowedAt(curriculum, index) {
  let byIndex = allowedCache.get(curriculum)
  if (!byIndex) { byIndex = new Map(); allowedCache.set(curriculum, byIndex) }
  let allowed = byIndex.get(index)
  if (!allowed) { allowed = allowedFor(curriculum, { index, ch: '' }, 0); byIndex.set(index, allowed) }
  return allowed
}

/** The band of each lesson (curriculum group) index: the band of a word or grammar point it introduces, else the previous lesson's. */
export function lessonBands(curriculum) {
  const bands = new Array(curriculum.groupCount).fill(undefined)
  for (const word of curriculum.ordered) if (word.index < bands.length && bands[word.index] === undefined) bands[word.index] = word.band
  for (const point of curriculum.grammarOrdered ?? []) if (point.index < bands.length && bands[point.index] === undefined) bands[point.index] = point.band
  let last = '1'
  return bands.map(band => { last = band ?? last; return last })
}

/** Words introduced by a lesson index, not counting function characters that are allowed everywhere. */
const vocabularyCount = (curriculum, index) => curriculum.ordered.filter(word => word.index <= index && HAN.test(word.ch)).length

// ---------------------------------------------------------------- validation (code, not the model, decides what is allowed)

/** The words (labels) of a Chinese text and the reason it is refused: every Han character must be part of a word the window allows. */
export function analyzeChinese(curriculum, allowed, zh) {
  if (!HAN.test(zh)) return { reason: 'no Chinese' }
  if (/[A-Za-z0-9]/.test(zh)) return { reason: 'Latin letters or digits in Chinese' }
  if (hanCount(zh) > MAX_LINE_SYLLABLES) return { reason: 'too long' }
  if (!allowed.segmenter.covers(zh)) return { reason: 'uses a word not yet learned' }
  const words = []
  for (const form of allowed.segmenter.segment(zh)) {
    const lb = allowed.forms.get(form) ?? labelOf(curriculum, form)
    if (!lb) return { reason: 'uses a form that is no catalog word' }
    if (!words.includes(lb)) words.push(lb)
  }
  return { words }
}

/** A spoken line {zh, en, speaker?} as {zh, py, en, [speaker]} plus its words, or the reason. */
export function validateLine(curriculum, allowed, raw, { speaker = false } = {}) {
  if (!raw || typeof raw !== 'object') return { reason: 'not an object' }
  const zh = text(raw.zh), en = text(raw.en)
  if (!zh || !en) return { reason: 'missing zh or en' }
  if (HAN.test(en)) return { reason: 'Chinese in English' }
  const found = analyzeChinese(curriculum, allowed, zh)
  if (found.reason) return found
  let py
  try { py = phrasePinyin(zh, curriculum) } catch (reason) { return { reason: reason.message } }
  if (speaker && !VOICES.includes(raw.speaker)) return { reason: 'speaker is not female or male' }
  return { line: { zh, py, en, ...(speaker ? { speaker: raw.speaker } : {}) }, words: found.words }
}

const sameSet = (a, b) => a.length === b.length && a.every(value => b.includes(value))

/** Accepted answers of one bank phrase from the writer's {zhAlt, enAlt, optional}, cleaned: only what the phrase's own readyAt allows. */
export function validateAccepted(curriculum, phrase, raw) {
  const allowed = allowedAt(curriculum, phrase.readyAt)
  const own = phraseKey(phrase.zh), seen = new Set([own])
  const dropped = []
  const zhAlt = []
  for (const value of list(raw?.zhAlt)) {
    const zh = text(value), key = phraseKey(zh)
    const found = zh ? analyzeChinese(curriculum, allowed, zh) : { reason: 'empty' }
    if (found.reason) dropped.push(zh + ': ' + found.reason); else if (seen.has(key)) dropped.push(zh + ': duplicate'); else if (zhAlt.length < MAX_ALTERNATIVES) { seen.add(key); zhAlt.push(zh) }
  }
  const seenEn = new Set([normalEnglish(phrase.en)])
  const enAlt = []
  for (const value of list(raw?.enAlt)) {
    const en = text(value), key = normalEnglish(en)
    if (!en || HAN.test(en) || en.length > 160 || !key) dropped.push(en + ': not English'); else if (seenEn.has(key)) dropped.push(en + ': duplicate'); else if (enAlt.length < MAX_ALTERNATIVES) { seenEn.add(key); enAlt.push(en) }
  }
  // optional words: short, inside the phrase, and ignorable without changing its meaning (the checker confirms)
  const optional = []
  for (const value of list(raw?.optional)) { const word = text(value); if (word && word.length <= 2 && HAN.test(word) && phrase.zh.includes(word) && !optional.includes(word) && optional.length < 3) optional.push(word) }
  return { item: { key: own, zh: phrase.zh, en: phrase.en, zhAlt, enAlt, optional, readyAt: phrase.readyAt }, dropped }
}

/** An exchange from the writer, or the reason. wrong replies that fail validation are dropped; fewer than 2 left refuses the exchange. */
export function validateExchange(curriculum, allowed, raw, lesson) {
  const q = validateLine(curriculum, allowed, raw?.q, { speaker: true })
  if (q.reason) return { reason: 'question: ' + q.reason }
  const a = validateLine(curriculum, allowed, raw?.a, { speaker: true })
  if (a.reason) return { reason: 'reply: ' + a.reason }
  if (phraseKey(q.line.zh) === phraseKey(a.line.zh)) return { reason: 'reply repeats the question' }
  const keys = new Set([phraseKey(a.line.zh)]), wrong = [], words = [...new Set([...q.words, ...a.words])]
  for (const value of list(raw?.wrong)) {
    const line = validateLine(curriculum, allowed, value)
    const key = line.line ? phraseKey(line.line.zh) : ''
    if (line.reason || keys.has(key) || wrong.length >= 3) continue
    keys.add(key); wrong.push(line.line); for (const lb of line.words) if (!words.includes(lb)) words.push(lb)
  }
  if (wrong.length < 2) return { reason: 'fewer than 2 usable wrong replies' }
  const { grammar, readyAt } = applyGrammar(curriculum, { words }, raw?.grammar, allowed)
  return { item: { id: 'x' + hash(phraseKey(q.line.zh) + '|' + phraseKey(a.line.zh)), lesson: lessonNumber(lesson), q: q.line, a: a.line, wrong, words, grammar, readyAt } }
}

/** A conversation from the writer, or the reason: 4-8 lines, 2-3 named speakers each female or male, exactly 2 questions each with one right option. */
export function validateConversation(curriculum, allowed, raw, lesson) {
  const rawLines = list(raw?.lines)
  if (rawLines.length < 4 || rawLines.length > 8) return { reason: 'needs 4 to 8 lines, has ' + rawLines.length }
  const voices = new Map(), lines = [], words = []
  for (const value of rawLines) {
    const name = text(value?.name)
    if (!name || HAN.test(name) === false && !/^[\p{L}][\p{L} .'-]*$/u.test(name) || name.length > 20) return { reason: 'a line has no usable speaker name' }
    const line = validateLine(curriculum, allowed, value, { speaker: true })
    if (line.reason) return { reason: 'line: ' + line.reason }
    if (voices.has(name) && voices.get(name) !== line.line.speaker) return { reason: name + ' is both female and male' }
    voices.set(name, line.line.speaker)
    lines.push({ name, ...line.line }); for (const lb of line.words) if (!words.includes(lb)) words.push(lb)
  }
  if (voices.size < 2 || voices.size > 3) return { reason: 'needs 2 or 3 speakers' }
  if (lines.some((line, at) => at && lines[at - 1].name === line.name && lines[at - 1].zh === line.zh)) return { reason: 'a line repeats' }
  const questions = list(raw?.questions)
  if (questions.length !== 2) return { reason: 'needs exactly 2 questions' }
  const checked = []
  for (const value of questions) {
    const q = text(value?.q), options = list(value?.options).map(text), answer = value?.answer
    if (!q || HAN.test(q) || options.some(option => !option || HAN.test(option))) return { reason: 'question or option missing or not English' }
    if (options.length < 3 || options.length > 4 || new Set(options.map(normalEnglish)).size !== options.length) return { reason: 'needs 3 or 4 different options' }
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return { reason: 'answer is not exactly one option' }
    checked.push({ q, options, answer })
  }
  if (new Set(checked.map(item => normalEnglish(item.q))).size !== 2) return { reason: 'the two questions are the same' }
  const { grammar, readyAt } = applyGrammar(curriculum, { words }, raw?.grammar, allowed)
  const key = lines.map(line => phraseKey(line.zh)).join('|')
  return { item: { id: 'c' + hash(key), lesson: lessonNumber(lesson), speakers: [...voices].map(([name, speaker]) => ({ name, speaker })), lines, questions: checked, words, grammar, readyAt } }
}

/** One grammar point from the writer: its note and the near misses of the real bank phrases it was given ('phrases' maps the ids p1.. to bank phrases). */
export function validateGrammarPoint(curriculum, entry, raw, { bankKeys, perPoint = 6 }) {
  const dropped = []
  const note = text(raw?.note)
  const items = [], seen = new Set()
  for (const value of list(raw?.items)) {
    const phrase = entry.phrases.find(candidate => candidate.pid === text(value?.phrase))
    const wrong = text(value?.wrong), why = text(value?.why), kind = NEAR_MISS_KINDS.includes(value?.kind) ? value.kind : 'other'
    const key = phraseKey(wrong)
    const reason = !phrase ? 'not one of the given phrases' : !wrong || !why ? 'missing wrong or why' : why.length > 220 ? 'why is too long' : HAN.test(wrong) === false ? 'no Chinese'
      : key === phrase.key ? 'same as the real phrase' : bankKeys.has(key) ? 'is itself a bank phrase' : seen.has(phrase.key + key) ? 'duplicate' : undefined
    const found = reason ? { reason } : analyzeChinese(curriculum, allowedAt(curriculum, phrase.readyAt), wrong)
    if (found.reason) { dropped.push(wrong + ': ' + found.reason); continue }
    if (items.length >= perPoint) break
    seen.add(phrase.key + key)
    let wrongPy
    try { wrongPy = phrasePinyin(wrong, curriculum) } catch { wrongPy = undefined }
    items.push({ id: 'g' + hash(entry.point.lb + '|' + phrase.key + '|' + key), ref: entry.point.lb, phrase: phrase.key, zh: phrase.zh, en: phrase.en, wrong, ...(wrongPy ? { wrongPy } : {}), kind, why, readyAt: phrase.readyAt })
  }
  return { point: { ref: entry.point.lb, ...(note.length >= 20 && note.length <= 500 ? { note } : {}), readyAt: Math.max(entry.point.index, ...items.map(item => item.readyAt)), items }, dropped }
}

// ---------------------------------------------------------------- state

export const emptyState = () => ({ version: SCHEMA_VERSION, done: {}, accepted: {}, exchanges: {}, grammar: {}, conversations: {} })

export function loadState(file) {
  if (!existsSync(file)) return emptyState()
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return { ...emptyState(), ...raw, done: raw.done ?? {} }
}
export const saveState = (file, state) => writeAtomic(file, JSON.stringify(state) + '\n')

const bandFile = (dir, kind, band) => join(dir, kind + '-hsk-' + band + '.json')
export const indexFile = dir => join(dir, 'index.json')

/** Items of the band files already on disk join the state (never replacing one it has), so a lost state file loses only the 'nothing kept' markers. */
export function hydrate(state, dir) {
  for (const band of BANDS) for (const kind of KINDS) {
    const file = bandFile(dir, kind, band)
    if (!existsSync(file)) continue
    let parsed
    try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    for (const item of list(parsed.items)) {
      if (kind === 'accepted') state.accepted[item.key] ??= { band, ...item }
      else if (kind === 'grammar') state.grammar[item.ref] ??= { band, ...item }
      else { state[kind][item.id] ??= { band, ...item }; state.done[kind + ':' + item.lesson] ??= { status: 'done' } }
    }
    if (kind === 'grammar') for (const item of list(parsed.items)) state.done['grammar:' + item.ref] ??= { status: 'done' }
    if (kind === 'accepted') for (const item of list(parsed.items)) state.done['accepted:' + item.key] ??= { status: 'done' }
  }
}

const strip = ({ band: _band, ...item }) => item
const byReady = (a, b) => a.readyAt - b.readyAt || String(a.id ?? a.key ?? a.ref).localeCompare(String(b.id ?? b.key ?? b.ref))

/** The files of the dataset from the state: [{ file, text, counts }] per band and kind, and the index. Deterministic: sorted by readiness then id. */
export function buildOutputs(state, dir, bands = BANDS) {
  const files = new Map(), index = { schemaVersion: SCHEMA_VERSION, bands: {}, totals: { accepted: 0, exchanges: 0, grammarPoints: 0, nearMisses: 0, conversations: 0 } }
  for (const band of bands) {
    const pick = records => Object.values(records).filter(record => record.band === band).map(strip).sort(byReady)
    const accepted = pick(state.accepted).filter(item => item.zhAlt.length || item.enAlt.length || item.optional.length)
    const exchanges = pick(state.exchanges), conversations = pick(state.conversations)
    const grammar = pick(state.grammar).filter(point => point.note || point.items.length)
    const sets = { accepted, exchanges, grammar, conversations }
    for (const kind of KINDS) files.set(bandFile(dir, kind, band), fileText(kind, band, sets[kind]))
    const nearMisses = grammar.reduce((sum, point) => sum + point.items.length, 0)
    index.bands[band] = { accepted: accepted.length, exchanges: exchanges.length, grammar: { points: grammar.length, nearMisses }, conversations: conversations.length }
    index.totals.accepted += accepted.length; index.totals.exchanges += exchanges.length; index.totals.grammarPoints += grammar.length; index.totals.nearMisses += nearMisses; index.totals.conversations += conversations.length
  }
  files.set(indexFile(dir), JSON.stringify(index, null, 1) + '\n')
  return files
}
const fileText = (kind, band, items) => '{"schemaVersion":' + SCHEMA_VERSION + ',"kind":"' + kind + '","band":"' + band + '","items":[' + (items.length ? '\n' : '') + items.map(item => JSON.stringify(item)).join(',\n') + (items.length ? '\n' : '') + ']}\n'

/** Writes the state and the changed files at most every interval ms (flush() writes now: end of a kind, of the run, Ctrl-C). */
export function createSaver({ state, options, interval = 5000, clock = Date.now, write = writeAtomic, bands = BANDS }) {
  const last = new Map()
  let dirty = false, at = -Infinity, timer
  const run = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    saveState(options.state, state)
    // the index lists every band, so with a band selection the other bands' counts come from their files: build all and write only what changed
    for (const [file, content] of buildOutputs(state, options.out, bands)) if (last.get(file) !== content) { write(file, content); last.set(file, content) }
    dirty = false; at = clock()
  }
  const save = () => {
    dirty = true
    const wait = interval - (clock() - at)
    if (wait <= 0) run(); else if (timer === undefined) { timer = setTimeout(() => { timer = undefined; if (dirty) run() }, wait); timer.unref?.() }
  }
  save.flush = () => { if (dirty) run() }
  return save
}

// ---------------------------------------------------------------- the bank

/** Every shipped phrase: { band, id, key, zh, py, en, words, grammar, readyAt }. */
export function readBank(dir) {
  const phrases = []
  for (const band of BANDS) {
    const file = join(dir, 'hsk-' + band + '.json')
    if (!existsSync(file)) continue
    for (const phrase of JSON.parse(readFileSync(file, 'utf8')).phrases ?? []) phrases.push({ band, id: phrase.id, key: phraseKey(phrase.zh), zh: phrase.zh, py: phrase.py, en: phrase.en, words: phrase.words ?? [], grammar: phrase.grammar ?? [], readyAt: phrase.readyAt ?? 0 })
  }
  return phrases
}

// ---------------------------------------------------------------- prompts

const SYSTEM = 'You write Mandarin practice material for English-speaking learners, and check it. Reply with one JSON object only, no prose and no code fences.'
const vocabularyText = (curriculum, index) => vocabularyFor(curriculum, { index, ch: '' }, 0).map(group => 'Lesson ' + group.lesson + ': ' + group.words.join('; ')).join('\n')
const grammarText = (curriculum, index) => grammarFor(curriculum, { index, ch: '' }, 0).map(group => 'Lesson ' + group.lesson + ': ' + group.points.map(point => point.ref + ' = ' + point.pattern + ' (' + point.meaning + ')').join(' | ')).join('\n')
const FUNCTION_NOTE = 'The particles 的了吗呢吧是不很也都和在有这那我你他她们个 may always be used. Use no other Chinese word than the ones listed. Use no Latin letters or digits in Chinese. Names of people only if listed as vocabulary.'

const acceptedPrompt = (curriculum, batch) => ({
  system: SYSTEM,
  user: 'For each phrase below give the OTHER natural ways a learner could answer when asked to translate it.\n' +
    '- zhAlt: other natural Chinese wordings and word orders for the SAME English meaning (not the given Chinese; no meaning change; only natural sentences; up to ' + MAX_ALTERNATIVES + '). Each phrase has a lesson number: use only words from vocabulary up to that lesson. ' + FUNCTION_NOTE + '\n' +
    '- enAlt: other acceptable English translations of the Chinese (up to ' + MAX_ALTERNATIVES + ', natural, same meaning, e.g. contractions, synonyms, "a" vs "the" only when both are right).\n' +
    '- optional: Chinese words of the given phrase (1-2 characters) that can be left out or added without changing the meaning, such as a trailing 了 or 的; usually empty.\n' +
    'Empty lists are the right answer when there are none. Never pad.\n\nVocabulary by lesson (newest first):\n' + vocabularyText(curriculum, batch.maxReady) +
    '\n\nPhrases:\n' + batch.items.map(phrase => JSON.stringify({ id: phrase.pid, zh: phrase.zh, en: phrase.en, lesson: lessonNumber(phrase.readyAt) })).join('\n') +
    '\n\nReply {"items":[{"id":"...","zhAlt":[],"enAlt":[],"optional":[]}]} with one entry per phrase.',
})
const acceptedCheck = items => ({
  system: SYSTEM,
  user: 'You check alternative answers for Chinese-English translation exercises. For each entry, the original is correct. List the 0-based index of every alternative that is unnatural or ungrammatical Chinese (badZh), whose meaning differs from the original (badZh, badEn), or that is not natural English (badEn). List in badOptional every optional word that is NOT really ignorable without changing the meaning. Be strict: only flawless alternatives pass.\n\n' +
    items.map(item => JSON.stringify({ id: item.pid, zh: item.zh, en: item.en, zhAlt: item.zhAlt, enAlt: item.enAlt, optional: item.optional })).join('\n') + '\n\nReply {"items":[{"id":"...","badZh":[],"badEn":[],"badOptional":[]}]}.',
})

const exchangePrompt = (curriculum, lesson, count) => ({
  system: SYSTEM,
  user: 'Write ' + count + ' two-line exchanges for lesson ' + lessonNumber(lesson) + ': a question (q) and a fitting reply (a), like A: 你叫什么名字？ B: 我叫小明。 For each also give 2 or 3 WRONG replies that are plausible (the right kind of sentence, same topic) but do not fit this question, so a learner who understood the question would not pick them.\n' +
    'Rules: favour the newest words and grammar of lesson ' + lessonNumber(lesson) + ' but anything up to it is allowed. ' + FUNCTION_NOTE + ' Each line is short (at most ' + MAX_PHRASE_SYLLABLES + ' syllables). Vary the question types (who, what, where, how many, yes/no...). Every wrong reply must be unmistakably wrong for the question: do not give an alternative that could also be a good answer. q and a each have a "speaker" voice, "female" or "male". List in "grammar" the grammar refs the exchange really uses (empty when none).\n\n' +
    'Vocabulary by lesson (newest first):\n' + vocabularyText(curriculum, lesson) + '\n\nGrammar points by lesson (newest first):\n' + grammarText(curriculum, lesson) +
    '\n\nReply {"items":[{"q":{"zh":"","en":"","speaker":"female"},"a":{"zh":"","en":"","speaker":"male"},"wrong":[{"zh":"","en":""}],"grammar":[]}]}.',
})
const exchangeCheck = items => ({
  system: SYSTEM,
  user: 'Check two-line exchanges for a Chinese course. For each: "fits" is true when the reply is a natural, correct answer to the question and the English translations match the Chinese. "wrongFit" lists the 0-based index of every wrong reply that actually COULD be a good answer to the question (those are bad wrong replies). "natural" is false when any Chinese or English is unnatural.\n\n' +
    items.map(item => JSON.stringify({ id: item.id, q: item.q, a: item.a, wrong: item.wrong })).join('\n') + '\n\nReply {"items":[{"id":"...","fits":true,"natural":true,"wrongFit":[]}]}.',
})

const grammarPrompt = (curriculum, entries) => ({
  system: SYSTEM,
  user: 'For each grammar point below write (1) a short explanation note for an English-speaking learner (20-60 words: what the pattern is, when to use it, the one thing learners get wrong) and (2) near-miss WRONG versions of the real phrases given: a wrong word order, a wrong or missing particle, a misplaced 都 or 也, a wrong measure word, a wrong negation. Each near miss must be clearly ungrammatical or wrong in Chinese (not just unusual), close to the real phrase (same words, small change), and use only words the phrase already uses or that its lesson allows. ' + FUNCTION_NOTE + '\n' +
    'Each item: phrase (the id given), wrong (the wrong Chinese sentence), kind (one of ' + NEAR_MISS_KINDS.join(', ') + '), why (ONE English sentence, at most 25 words, saying why it is wrong and what is right). Give up to 6 items per point, from different phrases; fewer if a good near miss does not exist; none if no phrases are given. Never invent phrases.\n\n' +
    entries.map(entry => 'Grammar point ' + JSON.stringify({ ref: entry.point.lb, pattern: entry.point.pt, meaning: entry.point.ds.slice(0, 160), lesson: lessonNumber(entry.point.index) }) + '\nPhrases:\n' + entry.phrases.map(phrase => JSON.stringify({ id: phrase.pid, zh: phrase.zh, en: phrase.en })).join('\n')).join('\n\n') +
    '\n\nReply {"points":[{"ref":"...","note":"...","items":[{"phrase":"p1","wrong":"","kind":"order","why":""}]}]}.',
})
const grammarCheck = points => ({
  system: SYSTEM,
  user: 'You are a strict Chinese teacher. For each near miss, "wrongOk" is true only when the wrong sentence is really wrong or clearly unnatural Chinese for the reason given (it must NOT be acceptable Chinese), and "whyOk" is true when the explanation is correct, one sentence, and fits. For each note, "noteOk" is true when it is accurate and clear.\n\n' +
    points.map(point => JSON.stringify({ ref: point.ref, note: point.note, items: point.items.map(item => ({ id: item.id, right: item.zh, wrong: item.wrong, why: item.why })) })).join('\n') + '\n\nReply {"points":[{"ref":"...","noteOk":true,"items":[{"id":"...","wrongOk":true,"whyOk":true}]}]}.',
})

const conversationPrompt = (curriculum, lesson, count) => ({
  system: SYSTEM,
  user: 'Decide whether the vocabulary up to lesson ' + lessonNumber(lesson) + ' supports a short conversation worth listening to (something to actually talk about: not just greetings repeated or a list of nouns). If it does not, reply {"conversations":[]}: that is a good answer, never pad. Otherwise write up to ' + count + ' conversations that use the newest words of lesson ' + lessonNumber(lesson) + '.\n' +
    'Each conversation: 4 to 8 lines, 2 or 3 named speakers (a "name" in Chinese or pinyin, e.g. 小明 or Xiaoming, only use a Chinese name inside a line if it is listed vocabulary) and each speaker is "female" or "male" (a speaker keeps one voice). ' + FUNCTION_NOTE + ' Lines are short and natural. Then exactly 2 comprehension questions IN ENGLISH about the conversation, each with 3 or 4 English options of which exactly ONE is right (answer = its 0-based index); the wrong options must be clearly wrong from the text, and the question must be answerable from it. List "grammar" refs the lines really use.\n\n' +
    'Vocabulary by lesson (newest first):\n' + vocabularyText(curriculum, lesson) + '\n\nGrammar points by lesson (newest first):\n' + grammarText(curriculum, lesson) +
    '\n\nReply {"conversations":[{"lines":[{"name":"","speaker":"female","zh":"","en":""}],"questions":[{"q":"","options":["","",""],"answer":0}],"grammar":[]}]}.',
})
const conversationCheck = items => ({
  system: SYSTEM,
  user: 'For each conversation: answer its two questions yourself from the conversation only, ignoring any hint of the intended answer, and give for each the 0-based index of the ONE option that is right ("answers": [first, second]; use -1 when none or more than one option is right). "natural" is false if any Chinese is unnatural or any English does not match its Chinese.\n\n' +
    items.map(item => JSON.stringify({ id: item.id, lines: item.lines.map(line => line.name + ': ' + line.zh + ' (' + line.en + ')'), questions: item.questions.map(question => ({ q: question.q, options: question.options })) })).join('\n') + '\n\nReply {"items":[{"id":"...","natural":true,"answers":[0,0]}]}.',
})

// ---------------------------------------------------------------- the kinds: plan units, write, validate, check, merge

const inRange = (lesson, options) => lesson >= (options.lessons?.from ?? 1) && lesson <= (options.lessons?.to ?? Infinity)
const chunks = (items, size) => { const out = []; for (let at = 0; at < items.length; at += Math.max(1, size)) out.push(items.slice(at, at + Math.max(1, size))); return out }
const wantBand = (options, band) => !options.bands?.length || options.bands.includes(band)
const isDone = (state, options, id) => !options.redo && state.done[id]?.status === 'done'

async function askJSON(call, { system, user }) {
  let last
  for (let attempt = 0; attempt < 2; attempt++) { try { return parseJSONReply(await call(system, user)) } catch (reason) { last = reason; if (/^Model call failed/.test(reason?.message ?? '')) throw reason } }
  throw last
}
const rows = (reply, field = 'items') => new Map(list(reply?.[field]).map(row => [row?.id ?? row?.ref, row]))
const indexes = value => new Set(list(value).filter(Number.isInteger))

/** Each kind: plan(ctx) -> units; run(ctx, unit, io) -> { items, written, invalid, rejected } (nothing merged); merge(ctx, unit, result). */
export const KIND_SPECS = {
  accepted: {
    plan(ctx) {
      const { curriculum, state, options, bank } = ctx
      const out = []
      for (const band of BANDS) {
        if (!wantBand(options, band)) continue
        const todo = bank.filter(phrase => phrase.band === band && inRange(lessonNumber(phrase.readyAt), options) && !(state.accepted[phrase.key] && isDone(state, options, 'accepted:' + phrase.key))).sort((a, b) => a.readyAt - b.readyAt || a.id - b.id)
        for (const items of chunks(todo, options.batchSize.accepted)) out.push({ id: 'accepted:' + band + ':' + items[0].id, band, items: items.map((phrase, at) => ({ ...phrase, pid: 'k' + (at + 1) })), maxReady: items[items.length - 1].readyAt })
      }
      return out
    },
    async run({ curriculum }, unit, io) {
      const reply = await askJSON(io.write, acceptedPrompt(curriculum, unit))
      const written = rows(reply)
      let invalid = 0
      const drafts = unit.items.map(phrase => { const { item, dropped } = validateAccepted(curriculum, phrase, written.get(phrase.pid)); invalid += dropped.length; return { ...item, pid: phrase.pid } })
      const withAlts = drafts.filter(item => item.zhAlt.length || item.enAlt.length || item.optional.length)
      let rejected = 0
      if (withAlts.length) {
        const verdicts = rows(await askJSON(io.check, acceptedCheck(withAlts)))
        for (const item of withAlts) {
          const verdict = verdicts.get(item.pid)
          if (!verdict) { item.zhAlt = []; item.enAlt = []; item.optional = []; rejected++; continue }
          const badZh = indexes(verdict.badZh), badEn = indexes(verdict.badEn), badOptional = new Set(list(verdict.badOptional))
          rejected += badZh.size + badEn.size + badOptional.size
          item.zhAlt = item.zhAlt.filter((_, at) => !badZh.has(at)); item.enAlt = item.enAlt.filter((_, at) => !badEn.has(at)); item.optional = item.optional.filter(word => !badOptional.has(word))
        }
      }
      return { items: drafts.map(({ pid: _pid, ...item }) => item), written: withAlts.reduce((sum, item) => sum + item.zhAlt.length + item.enAlt.length, 0), invalid, rejected }
    },
    merge({ state, stats }, unit, result) {
      for (const item of result.items) { state.accepted[item.key] = { band: unit.band, ...item }; state.done['accepted:' + item.key] = { status: 'done' } }
      stats.kept += result.items.reduce((sum, item) => sum + item.zhAlt.length + item.enAlt.length, 0)
    },
  },

  exchanges: {
    plan({ curriculum, state, options }) {
      const bands = lessonBands(curriculum)
      const out = []
      for (let lesson = 0; lesson < curriculum.groupCount; lesson++) if (wantBand(options, bands[lesson]) && inRange(lessonNumber(lesson), options) && !isDone(state, options, 'exchanges:' + lessonNumber(lesson))) out.push({ id: 'exchanges:' + lessonNumber(lesson), lesson, band: bands[lesson] })
      return out
    },
    async run({ curriculum, options }, unit, io) {
      const reply = await askJSON(io.write, exchangePrompt(curriculum, unit.lesson, options.perLesson))
      const allowed = allowedAt(curriculum, unit.lesson)
      const drafts = [], seen = new Set()
      let invalid = 0
      for (const raw of list(reply?.items)) { const found = validateExchange(curriculum, allowed, raw, unit.lesson); if (found.reason || seen.has(found.item.id)) invalid++; else { seen.add(found.item.id); drafts.push(found.item) } }
      let rejected = 0, kept = drafts
      if (drafts.length) {
        const verdicts = rows(await askJSON(io.check, exchangeCheck(drafts)))
        kept = []
        for (const item of drafts) {
          const verdict = verdicts.get(item.id)
          if (!verdict || verdict.fits !== true || verdict.natural !== true) { rejected++; continue }
          const bad = indexes(verdict.wrongFit)
          const wrong = item.wrong.filter((_, at) => !bad.has(at))
          if (wrong.length < 2) { rejected++; continue }
          kept.push({ ...item, wrong })
        }
      }
      return { items: kept, written: drafts.length + invalid, invalid, rejected }
    },
    merge({ state, stats }, unit, result) {
      const pairs = new Set(Object.values(state.exchanges).map(item => phraseKey(item.q.zh) + '|' + phraseKey(item.a.zh)))
      for (const item of result.items) {
        const pair = phraseKey(item.q.zh) + '|' + phraseKey(item.a.zh)
        if (state.exchanges[item.id] || pairs.has(pair)) { stats.duplicates++; continue }
        pairs.add(pair); state.exchanges[item.id] = { band: unit.band, ...item }; stats.kept++
      }
      state.done[unit.id] = { status: 'done', kept: result.items.length }
    },
  },

  grammar: {
    plan({ curriculum, state, options, bank }) {
      const byRef = new Map()
      for (const phrase of bank) for (const ref of phrase.grammar) { const found = byRef.get(ref) ?? []; found.push(phrase); byRef.set(ref, found) }
      const entries = []
      for (const point of curriculum.grammarOrdered ?? []) {
        if (!wantBand(options, point.band) || !inRange(lessonNumber(point.index), options) || isDone(state, options, 'grammar:' + point.lb)) continue
        entries.push({ point, phrases: spread(byRef.get(point.lb) ?? [], 8).map((phrase, at) => ({ ...phrase, pid: 'p' + (at + 1) })) })
      }
      return chunks(entries, options.batchSize.grammar).map(group => ({ id: 'grammar:' + group[0].point.lb, entries: group, band: group[0].point.band }))
    },
    async run({ curriculum, options, bankKeys }, unit, io) {
      const reply = await askJSON(io.write, grammarPrompt(curriculum, unit.entries))
      const written = rows(reply, 'points')
      let invalid = 0, total = 0
      const drafts = unit.entries.map(entry => { const { point, dropped } = validateGrammarPoint(curriculum, entry, written.get(entry.point.lb), { bankKeys, perPoint: options.perPoint }); invalid += dropped.length; total += point.items.length; return { ...point, band: entry.point.band } })
      const withContent = drafts.filter(point => point.note || point.items.length)
      let rejected = 0
      if (withContent.length) {
        const verdicts = rows(await askJSON(io.check, grammarCheck(withContent)), 'points')
        for (const point of withContent) {
          const verdict = verdicts.get(point.ref)
          const items = new Map(list(verdict?.items).map(row => [row?.id, row]))
          const before = point.items.length
          point.items = point.items.filter(item => items.get(item.id)?.wrongOk === true && items.get(item.id)?.whyOk === true)
          rejected += before - point.items.length
          if (verdict?.noteOk !== true && point.note) { delete point.note; rejected++ }
        }
      }
      return { items: drafts, written: total, invalid, rejected }
    },
    merge({ state, stats }, unit, result) {
      for (const point of result.items) {
        state.grammar[point.ref] = { ...point, band: unit.entries.find(entry => entry.point.lb === point.ref).point.band }
        state.done['grammar:' + point.ref] = { status: 'done', kept: point.items.length }
        stats.kept += point.items.length
      }
    },
  },

  conversations: {
    plan({ curriculum, state, options }) {
      const bands = lessonBands(curriculum)
      const out = []
      for (let lesson = 0; lesson < curriculum.groupCount; lesson++) {
        if (!wantBand(options, bands[lesson]) || !inRange(lessonNumber(lesson), options)) continue
        const id = 'conversations:' + lessonNumber(lesson)
        if (isDone(state, options, id) && state.done[id].status === 'done') continue
        // too few words to talk about: no call at all (recorded as skipped, planned again when --min-vocab is lowered)
        if (vocabularyCount(curriculum, lesson) < options.minVocab) { state.done[id] = { status: 'skipped' }; continue }
        out.push({ id, lesson, band: bands[lesson] })
      }
      return out
    },
    async run({ curriculum, options }, unit, io) {
      const reply = await askJSON(io.write, conversationPrompt(curriculum, unit.lesson, options.convPerLesson))
      const allowed = allowedAt(curriculum, unit.lesson)
      const drafts = [], seen = new Set()
      let invalid = 0
      for (const raw of list(reply?.conversations)) { const found = validateConversation(curriculum, allowed, raw, unit.lesson); if (found.reason || seen.has(found.item.id)) invalid++; else { seen.add(found.item.id); drafts.push(found.item) } }
      let rejected = 0, kept = []
      if (drafts.length) {
        const verdicts = rows(await askJSON(io.check, conversationCheck(drafts)))
        for (const item of drafts) {
          const verdict = verdicts.get(item.id)
          const answers = list(verdict?.answers)
          // the checker answered blind: it must find exactly the one right option the writer named, for both questions
          if (verdict?.natural === true && answers.length === 2 && answers.every((answer, at) => answer === item.questions[at].answer)) kept.push(item); else rejected++
        }
      }
      return { items: kept, written: drafts.length + invalid, invalid, rejected }
    },
    merge({ state, stats }, unit, result) {
      const keys = new Set(Object.values(state.conversations).map(item => item.lines.map(line => phraseKey(line.zh)).join('|')))
      for (const item of result.items) {
        const key = item.lines.map(line => phraseKey(line.zh)).join('|')
        if (state.conversations[item.id] || keys.has(key)) { stats.duplicates++; continue }
        keys.add(key); state.conversations[item.id] = { band: unit.band, ...item }; stats.kept++
      }
      state.done[unit.id] = { status: result.items.length ? 'done' : 'done', kept: result.items.length }
    },
  },
}

/** Up to n phrases spread over the list sorted by length (short to long), so near misses come from phrases of different sizes. */
export function spread(phrases, n) {
  const sorted = [...phrases].sort((a, b) => hanCount(a.zh) - hanCount(b.zh) || a.id - b.id)
  if (sorted.length <= n) return sorted
  return Array.from({ length: n }, (_, at) => sorted[Math.floor(at * sorted.length / n)])
}

// ---------------------------------------------------------------- running

/** Runs fn over the items with at most 'concurrency' in flight. */
export async function pool(items, concurrency, fn) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => { while (next < items.length) { const item = items[next++]; await fn(item) } }))
}

export const newStats = () => ({ units: 0, failed: 0, written: 0, invalid: 0, rejected: 0, duplicates: 0, kept: 0, calls: 0 })

/** Plans and runs one kind. A failed unit (model call or unreadable reply) is logged and left for the next run. */
export async function runKind({ kind, ctx, io, log = () => {}, save = () => {} }) {
  const spec = KIND_SPECS[kind]
  ctx.stats = newStats()
  let units = spec.plan(ctx)
  if (ctx.options.limit !== undefined) units = units.slice(0, ctx.options.limit)
  const counted = { write: io.write, check: io.check }
  const counting = { write: (...args) => { ctx.stats.calls++; return counted.write(...args) }, check: (...args) => { ctx.stats.calls++; return counted.check(...args) } }
  await pool(units, ctx.options.concurrency, async unit => {
    try {
      const result = await spec.run(ctx, unit, counting)
      spec.merge(ctx, unit, result)
      ctx.stats.units++; ctx.stats.written += result.written; ctx.stats.invalid += result.invalid; ctx.stats.rejected += result.rejected
      log(kind + ' ' + unit.id + ': ' + result.written + ' written, ' + result.invalid + ' invalid, ' + result.rejected + ' rejected by the check, ' + ctx.stats.kept + ' kept so far')
      save()
    } catch (reason) { ctx.stats.failed++; log(kind + ' ' + unit.id + ' failed (run again to retry it): ' + (reason instanceof Error ? reason.message : String(reason))) }
  })
  save.flush?.()
  return ctx.stats
}

/** Units and model calls (a write and at most one check each) per kind and band, from the plan (nothing done is left out unless --redo). */
export function planReport(ctx) {
  const report = {}
  for (const kind of KINDS) {
    const bands = {}
    const saved = JSON.stringify(ctx.state.done)
    for (const unit of KIND_SPECS[kind].plan({ ...ctx, options: { ...ctx.options, limit: undefined } })) { const band = unit.band; bands[band] ??= { units: 0, calls: 0 }; bands[band].units++; bands[band].calls += 2 }
    ctx.state.done = JSON.parse(saved)
    report[kind] = bands
  }
  return report
}

// ---------------------------------------------------------------- command line

export function parseArgs(argv, env = process.env) {
  const flags = new Map()
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (!arg.startsWith('--')) throw new Error('Unexpected argument: ' + arg)
    const [name, inline] = arg.slice(2).split(/=(.*)/s)
    flags.set(name, ['report', 'redo', 'dry-run', 'help'].includes(name) ? true : inline ?? argv[++at])
  }
  const get = (name, envName, fallback) => flags.get(name) ?? env['PRACTICE_' + envName] ?? fallback
  const csv = value => value ? String(value).split(',').map(item => item.trim()).filter(Boolean) : undefined
  const kinds = csv(flags.get('kind')) ?? KINDS
  for (const kind of kinds) if (!KINDS.includes(kind)) throw new Error('--kind takes ' + KINDS.join(', ') + ': ' + kind)
  const bands = csv(flags.get('band'))
  for (const band of bands ?? []) if (!BANDS.includes(band)) throw new Error('--band takes 1 to 6: ' + band)
  const number = (name, envName, fallback) => { const value = Number(get(name, envName, fallback)); if (!Number.isFinite(value) || value < 0) throw new Error('--' + name + ' takes a number'); return value }
  const batch = number('batch-size', 'BATCH_SIZE', 0)
  return {
    help: flags.has('help'), report: flags.has('report'), dryRun: flags.has('dry-run'), redo: flags.has('redo'), kinds, bands,
    lessons: flags.has('lessons') ? parseLessons(flags.get('lessons')) : undefined, limit: flags.has('limit') ? Number(flags.get('limit')) : undefined,
    concurrency: Math.max(1, Math.floor(number('concurrency', 'CONCURRENCY', 32)) || 1), sessionId: get('session-id', 'SESSION_ID', 'practice-dataset-' + new Date().toISOString().slice(0, 19)),
    saveInterval: Math.max(0, number('save-interval', 'SAVE_INTERVAL', 5)) * 1000,
    batchSize: { accepted: batch || 25, grammar: batch || 4 }, perLesson: number('per-lesson', 'PER_LESSON', 6), convPerLesson: number('conv-per-lesson', 'CONV_PER_LESSON', 2), perPoint: number('per-point', 'PER_POINT', 6), minVocab: number('min-vocab', 'MIN_VOCAB', 25),
    baseUrl: get('base-url', 'BASE_URL', env.PHRASE_BASE_URL ?? 'http://localhost:5210/v1'),
    apiKey: env[get('api-key-env', 'API_KEY_ENV', env.PRACTICE_API_KEY !== undefined ? 'PRACTICE_API_KEY' : 'PHRASE_API_KEY')],
    roles: { writer: { model: get('writer-model', 'WRITER_MODEL', 'gpt-6-luna'), api: get('writer-api', 'WRITER_API', 'responses') }, checker: { model: get('checker-model', 'CHECKER_MODEL', 'DeepSeek-V4.1-Flash'), api: get('checker-api', 'CHECKER_API', 'chat') } },
    state: resolve(get('state', 'STATE', join(root, 'build', 'practice-dataset', 'state.json'))), out: resolve(get('out', 'OUT', join(root, 'src', 'data', 'practice'))),
    phrasesDir: resolve(get('phrases-dir', 'PHRASES_DIR', join(root, 'src', 'data', 'phrases'))), dataDir: resolve(get('data-dir', 'DATA_DIR', join(root, 'src', 'data', 'v2'))),
  }
}

export function createIO(options, fetchImpl, log = () => {}) {
  const throttle = createThrottleLog(log)
  const make = role => createCaller({ onRetry: throttle.note, headers: { 'x-session-id': options.sessionId, 'x-hexad-client': 'practice-dataset' }, baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.roles[role].model, api: options.roles[role].api, ...(fetchImpl ? { fetchImpl, sleep: async () => {} } : {}) })
  return { write: make('writer'), check: make('checker'), flushThrottle: throttle.flush }
}

export async function main(argv = process.argv.slice(2), { fetchImpl, log = console.log, io: given } = {}) {
  const options = parseArgs(argv)
  if (options.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')); return }
  const curriculum = buildCurriculum(readCatalog(options.dataDir))
  const bank = readBank(options.phrasesDir)
  const state = loadState(options.state)
  hydrate(state, options.out)
  const ctx = { curriculum, state, options, bank, bankKeys: new Set(bank.map(phrase => phrase.key)) }
  if (options.report) { log(JSON.stringify({ phrases: bank.length, lessons: curriculum.groupCount, note: 'calls = one write and at most one check per unit', plan: planReport(ctx) }, null, 1)); return }
  if (options.dryRun) { for (const kind of options.kinds) log(kind + ': ' + KIND_SPECS[kind].plan({ ...ctx, options: { ...options, limit: undefined } }).length + ' units to do'); return }
  log('session id: ' + options.sessionId)
  const io = given ?? createIO(options, fetchImpl, log)
  const save = createSaver({ state, options, interval: options.saveInterval })
  const stop = () => { try { save.flush() } finally { process.exit(130) } }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const totals = {}
  try { for (const kind of options.kinds) { totals[kind] = await runKind({ kind, ctx, io, log, save }); log(kind + ': ' + JSON.stringify(totals[kind])) } } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop) }
  io.flushThrottle?.()
  save(); save.flush()
  return totals
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exit(1) })
