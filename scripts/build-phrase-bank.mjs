// Builds the phrase bank: the authored YAML curriculum/chinese/authoring/phrases/hsk-N.yaml (one flat list of phrases per band) and the app's JSON
// src/data/phrases/hsk-N.json generated from it (npm run curriculum:generate makes the same JSON). Written offline by hand, never in the build.
//
// A phrase is stored once and lists every word it uses in 'words' and every grammar pattern in 'grammar'; per-word and per-grammar-point counts are
// derived from those lists. Its id counts from 1 within the band file (lastId in the file is the highest ever given: ids never change or get reused).
// A phrase goes in the band of the word it uses that the curriculum introduces last. source is ai here; book and media (with an optional ref) are reserved
// for later imports.
//
// Pipeline (all batched, no agent loop):
//   1. Code reads the catalog (src/data/v2) and decides which TARGETS need more phrases: every word, and every grammar point, with fewer than --target
//      (default 3) authored examples that fit plus phrases in hand (a phrase counts for each word it uses and each grammar point it is tagged with).
//   2. LOOK-AHEAD PASSES. A "lesson" is one curriculum group (--lessons counts from 1). A word or grammar point introduced in lesson L may use words and
//      grammar from lessons up to L + look-ahead. Pass 0 is the strict rule; later passes (default 0,2,4,8,16) only work on targets still under --target.
//      A phrase records lookahead (the pass that produced it) and readyAt: the highest lesson index among its words AND grammar points. The app uses a
//      phrase only once it knows those words (and, for ai, book and media phrases, those grammar points).
//   3. CREDIT. Phrases already in hand count towards every word and grammar point they use before anything new is written, and a phrase written for one
//      target counts for the others it uses. The writer is told which phrases the batch's targets already have.
//   4. PLAN (opt-in, --plan) - a strong model gives each target a short spec per phrase.
//   5. WRITE - a cheap model writes the phrases. A batch mixes words and grammar points of the same or adjacent lessons. The vocabulary and the grammar
//      points of the window are listed by lesson, newest first. For a word it writes phrases containing the word; for a grammar point it writes phrases that
//      use that construct naturally. It tags each phrase with the grammar refs it really uses.
//   6. CODE VALIDATES each phrase: has pinyin and English, is short, uses only words in the window plus the function characters the app allows
//      everywhere (FUNCTION_CHARACTERS in src/core/drills/content.ts); every grammar tag must be a real grammar ref in the window (others are dropped).
//   7. CHECK - the strong model judges natural Chinese and an English that matches, and confirms the grammar tags (it may add or drop some; code checks
//      them against the window again). A phrase is dropped only when the checker says it failed AND gives a reason (logged). Failures are rewritten once
//      and checked again. If the check call itself fails the phrases are kept with checked:false (re-run with --recheck).
//   8. The YAML (and JSON) files are rewritten after every batch; progress per word is in the state file, so a run can be stopped and resumed.
//
// Usage (the endpoint is OpenAI compatible; hexad's gateway is http://localhost:5210/v1):
//   node scripts/build-phrase-bank.mjs --report
//   node scripts/build-phrase-bank.mjs --base-url http://localhost:5210/v1 \
//     --writer-model luna --writer-api responses --checker-model sonnet --checker-api chat --lessons 1-10
//   Options: --api-key-env NAME (default PHRASE_API_KEY), --target 3, --batch-size 20, --lookahead 0,2,4,8,16, --lessons 1-10 (lessons counted from 1),
//            --lesson-span 1 (a batch spans at most this many lessons), --band 1,2, --words lb1,lb2 (words only), --grammar ref1,ref2 (grammar only),
//            --limit N, --plan (+ --planner-model/--planner-api), --retry (targets that ended partial or failed), --recheck (phrases kept unchecked),
//            --report (per pass: words and grammar points at target, and those still without phrases), --out DIR (YAML, default curriculum/chinese/authoring/phrases),
//            --json-out DIR (default src/data/phrases), --state FILE (default build/phrase-bank/state-v2.json), --data-dir DIR, --dry-run,
//            --import-old FILE[,FILE] (convert an old-format band file or state file, keyed by word, into the YAML, then stop)
//   Environment alternatives: PHRASE_BASE_URL, PHRASE_PLANNER_MODEL, PHRASE_WRITER_MODEL, PHRASE_CHECKER_MODEL, PHRASE_*_API.
//   Re-running skips targets already done, so the command can be repeated until nothing is left.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultPhraseAuthoringDir, defaultPhraseJsonDir, isOldState, readOldBank, readOldState, readPhraseBands, writeAtomic, writePhraseBands } from './phrase-bank-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BANDS = ['1', '2', '3', '4', '5', '6']
/** Kept in step with FUNCTION_CHARACTERS in src/core/drills/content.ts (a test compares them). */
export const FUNCTION_CHARACTERS = '的了吗呢吧是不很也都和在有这那我你他她们个'
export const MAX_PHRASE_SYLLABLES = 12
export const DEFAULT_TARGET = 3
export const DEFAULT_LOOKAHEAD = [0, 2, 4, 8, 16]
/** At most this many words are listed to the models per call, newest lessons first. */
export const VOCAB_CAP = 300
const HAN = /\p{Script=Han}/u
const hanCount = text => Array.from(text).filter(char => HAN.test(char)).length

// ---------------------------------------------------------------- catalog

export function readCatalog(dataDir = join(root, 'src', 'data', 'v2')) {
  return BANDS.map(band => JSON.parse(readFileSync(join(dataDir, 'hsk-' + band + '.generated.json'), 'utf8')))
}

/**
 * The curriculum as the pipeline needs it: words in teaching order, the lesson each is introduced in, and every authored example.
 * 'index' of a word is the position of the first group that lists it, so "learned by then" is index <= the word's own.
 */
export function buildCurriculum(bands) {
  const words = new Map()
  for (const data of bands) for (const record of data.vocabulary) words.set(record.lb, { lb: record.lb, ch: record.ch, pr: record.pr, ds: record.ds, band: data.band, index: Infinity, order: 0 })
  let index = 0
  const examples = []
  const grammarRecords = new Map()
  const grammar = new Map()
  for (const data of bands) for (const record of data.grammar ?? []) { grammarRecords.set(record.lb, record); grammar.set(record.lb, { lb: record.lb, pt: record.pt, pr: record.pr, ds: record.ds, band: data.band, index: Infinity }) }
  for (const data of bands) {
    for (const group of data.groups) {
      for (const unit of group.units) {
        if (unit.kind === 'vocabulary') { const word = words.get(unit.ref); if (word && word.index === Infinity) word.index = index }
        if (unit.kind === 'grammar') { const point = grammar.get(unit.ref); if (point && point.index === Infinity) point.index = index }
      }
      for (const example of group.examples) examples.push({ ...example, index })
      index++
    }
  }
  for (const record of grammarRecords.values()) examples.push({ ...record.ex, grammar: record.ex.grammar ?? [], index: Infinity })
  const ordered = [...words.values()].sort((a, b) => a.index - b.index)
  ordered.forEach((word, order) => { word.order = order; if (word.index === Infinity) word.index = index })
  for (const example of examples) if (example.index === Infinity) example.index = Math.max(0, ...example.segments.flatMap(segment => segment.word && words.get(segment.word) ? [words.get(segment.word).index] : [0]))
  // grammar points no lesson introduces are in no window
  const grammarOrdered = [...grammar.values()].filter(point => point.index !== Infinity).sort((a, b) => a.index - b.index)
  return { words, ordered, examples, groupCount: index, grammar, grammarOrdered }
}

/** An authored example as text, or undefined when it cannot be rendered. */
export function renderExample(curriculum, example) {
  const zh = [], py = [], refs = []
  for (const segment of example.segments) {
    if (segment.punctuation !== undefined) { zh.push(segment.punctuation); py.push(segment.punctuation) } else {
      const word = curriculum.words.get(segment.word)
      if (!word) return undefined
      zh.push(word.ch); py.push(word.pr); refs.push(segment.word)
    }
  }
  return { zh: zh.join(''), py: py.join(' '), en: (example.translation ?? '').trim(), words: refs }
}

/** The authored examples that fit each word: translated, short enough, and made only of words introduced by the word's own lesson. */
export function catalogPhrases(curriculum, lookahead = 0) {
  const found = new Map()
  for (const example of curriculum.examples) {
    const rendered = renderExample(curriculum, example)
    if (!rendered || !rendered.en || hanCount(rendered.zh) > MAX_PHRASE_SYLLABLES) continue
    for (const lb of new Set(rendered.words)) {
      const word = curriculum.words.get(lb)
      if (!rendered.words.every(other => curriculum.words.get(other).index <= word.index + lookahead)) continue
      const list = found.get(lb) ?? []
      if (!list.some(item => item.zh === rendered.zh)) list.push(rendered)
      found.set(lb, list)
    }
    // the example also counts for each grammar point it is tagged with, when its words and grammar are all introduced by that point's lesson plus the look-ahead
    for (const ref of new Set(example.grammar ?? [])) {
      const point = curriculum.grammar?.get(ref)
      if (!point || point.index === Infinity) continue
      const top = point.index + lookahead
      if (!rendered.words.every(other => curriculum.words.get(other).index <= top) || !(example.grammar ?? []).every(other => (curriculum.grammar.get(other)?.index ?? 0) <= top)) continue
      const key = 'grammar:' + ref
      const list = found.get(key) ?? []
      if (!list.some(item => item.zh === rendered.zh)) list.push(rendered)
      found.set(key, list)
    }
  }
  return found
}

/** How many words have 0, 1-2 and 3+ authored phrases (those that fit by the word's point, and any that merely fit). */
export function coverageReport(curriculum) {
  const fitted = catalogPhrases(curriculum)
  const loose = new Map()
  for (const example of curriculum.examples) {
    const rendered = renderExample(curriculum, example)
    if (!rendered || !rendered.en || hanCount(rendered.zh) > MAX_PHRASE_SYLLABLES) continue
    for (const lb of new Set(rendered.words)) { const set = loose.get(lb) ?? new Set(); set.add(rendered.zh); loose.set(lb, set) }
  }
  const bucket = counts => { const out = { zero: 0, oneOrTwo: 0, threePlus: 0 }; for (const word of curriculum.ordered) { const n = counts(word.lb); if (n === 0) out.zero++; else if (n < 3) out.oneOrTwo++; else out.threePlus++ } return out }
  const perBand = {}
  for (const band of BANDS) {
    const bandWords = curriculum.ordered.filter(word => word.band === band)
    const counts = { zero: 0, oneOrTwo: 0, threePlus: 0 }
    for (const word of bandWords) { const n = fitted.get(word.lb)?.length ?? 0; if (n === 0) counts.zero++; else if (n < 3) counts.oneOrTwo++; else counts.threePlus++ }
    perBand[band] = { words: bandWords.length, ...counts }
  }
  return { words: curriculum.ordered.length, fitByLesson: bucket(lb => fitted.get(lb)?.length ?? 0), anyFit: bucket(lb => loose.get(lb)?.size ?? 0), perBand }
}

// ---------------------------------------------------------------- validation

/** Segments text into allowed forms (longest first); covers is true when every Han character is part of one. */
export function createSegmenter(forms) {
  const set = new Set([...forms].filter(form => HAN.test(form)))
  const longest = Math.max(1, ...[...set].map(form => form.length))
  const runs = text => text.match(/\p{Script=Han}+/gu) ?? []
  const covers = text => runs(text).every(run => {
    const reachable = new Array(run.length + 1).fill(false)
    reachable[0] = true
    for (let start = 0; start < run.length; start++) {
      if (!reachable[start]) continue
      for (let length = 1; length <= longest && start + length <= run.length; length++) if (set.has(run.slice(start, start + length))) reachable[start + length] = true
    }
    return reachable[run.length]
  })
  const segment = text => {
    const out = []
    for (const run of runs(text)) {
      for (let at = 0; at < run.length;) {
        let taken = 0
        for (let length = Math.min(longest, run.length - at); length >= 1; length--) if (set.has(run.slice(at, at + length))) { taken = length; break }
        if (taken) { out.push(run.slice(at, at + taken)); at += taken } else at++
      }
    }
    return out
  }
  return { covers, segment }
}

const labelCache = new WeakMap()
/** Every catalog form and the label of its first word in teaching order: the function characters 你, 吗 ... are catalog words too. */
function labelsOf(curriculum) {
  let labels = labelCache.get(curriculum)
  if (!labels) { labels = new Map(); for (const word of curriculum.ordered) if (!labels.has(word.ch)) labels.set(word.ch, word.lb); labelCache.set(curriculum, labels) }
  return labels
}

/** The forms a phrase for this word may use in a pass: every word introduced by lesson index word.index + lookahead, the word's own characters and the function characters. */
export function allowedFor(curriculum, word, lookahead = 0) {
  const forms = new Map()
  for (const other of curriculum.ordered) {
    if (other.index > word.index + lookahead) break
    if (!forms.has(other.ch)) forms.set(other.ch, other.lb)
  }
  const extra = new Set(Array.from(FUNCTION_CHARACTERS))
  for (const char of word.ch) extra.add(char)
  const grammar = new Set()
  for (const point of curriculum.grammarOrdered ?? []) { if (point.index > word.index + lookahead) break; grammar.add(point.lb) }
  return { forms, grammar, lookahead, segmenter: createSegmenter([...forms.keys(), ...extra]) }
}

/** The lesson index by which every word and grammar point of a phrase is introduced. */
export function readyAtOf(curriculum, words, grammar = []) {
  return Math.max(0, ...words.map(lb => curriculum.words.get(lb)?.index ?? 0), ...grammar.map(lb => curriculum.grammar?.get(lb)?.index ?? 0))
}

/** The phrase with these grammar tags, keeping only real grammar refs in the window (the code's check of the models' tags), and readyAt counting grammar too. */
export function applyGrammar(curriculum, phrase, tags, allowed) {
  const grammar = []
  for (const tag of Array.isArray(tags) ? tags : []) { const ref = typeof tag === 'string' ? tag.trim() : ''; if (ref && allowed.grammar?.has(ref) && !grammar.includes(ref)) grammar.push(ref) }
  return { ...phrase, grammar, readyAt: readyAtOf(curriculum, phrase.words, grammar) }
}

/** The band of a phrase: the band of the word it uses that the curriculum introduces last. */
export function bandOfWords(curriculum, words) {
  let last
  for (const lb of words) { const word = curriculum.words.get(lb); if (word && (!last || word.order > last.order)) last = word }
  return last?.band ?? '1'
}

/** The word a phrase is judged against: the one it uses that the curriculum introduces last. */
export function anchorWord(curriculum, phrase) {
  let last
  for (const lb of phrase.words) { const word = curriculum.words.get(lb); if (word && (!last || word.order > last.order)) last = word }
  return last
}

/** A phrase from the writer as a bank entry, or the reason it was refused. Code, not the model, decides what counts as allowed vocabulary. */
export function validatePhrase(curriculum, word, raw, allowed = allowedFor(curriculum, word)) {
  if (!raw || typeof raw !== 'object') return { reason: 'not an object' }
  const { zh, py, en } = raw
  if (typeof zh !== 'string' || typeof py !== 'string' || typeof en !== 'string') return { reason: 'missing zh, py or en' }
  const text = zh.trim(), pinyin = py.trim(), english = en.trim()
  if (!HAN.test(text) || !pinyin || !english) return { reason: 'empty text' }
  if (HAN.test(english) || HAN.test(pinyin)) return { reason: 'Chinese in pinyin or English' }
  if (!word.grammar && !text.includes(word.ch)) return { reason: 'does not contain the word' }
  if (hanCount(text) > MAX_PHRASE_SYLLABLES) return { reason: 'too long' }
  if (!allowed.segmenter.covers(text)) return { reason: 'uses a word not yet learned' }
  const labels = labelsOf(curriculum)
  const words = []
  // every catalog word the phrase uses: those in the window, then function characters from any lesson (the app gates on this list)
  for (const form of allowed.segmenter.segment(text)) { const lb = allowed.forms.get(form) ?? labels.get(form); if (lb && !words.includes(lb)) words.push(lb) }
  if (!word.grammar && !words.includes(word.lb)) words.unshift(word.lb)
  const phrase = applyGrammar(curriculum, { zh: text, py: pinyin, en: english, words, source: 'ai', checked: false, lookahead: allowed.lookahead ?? 0 }, raw.grammar, allowed)
  if (word.grammar && !phrase.grammar.includes(word.grammar.lb)) return { reason: 'does not use the grammar point' }
  return { phrase: { zh: phrase.zh, py: phrase.py, en: phrase.en, words: phrase.words, grammar: phrase.grammar, source: 'ai', checked: false, lookahead: phrase.lookahead, readyAt: phrase.readyAt } }
}

// ---------------------------------------------------------------- model calls

/** A model call: (system, user) => text, over an OpenAI-compatible endpoint, as chat completions or as the responses API. */
export function createCaller({ baseUrl, apiKey, model, api = 'chat', fetchImpl = globalThis.fetch, sleep = ms => new Promise(done => setTimeout(done, ms)), retries = 3 }) {
  if (!baseUrl || !model) throw new Error('A base URL and a model name are needed for each role.')
  if (api !== 'chat' && api !== 'responses') throw new Error('The API shape is chat or responses: ' + api)
  const url = baseUrl.replace(/\/+$/, '') + (api === 'chat' ? '/chat/completions' : '/responses')
  const body = (system, user) => api === 'chat'
    ? { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
    : { model, instructions: system, input: user }
  return async (system, user) => {
    let last
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}) }, body: JSON.stringify(body(system, user)) })
        if (response.status === 429 || response.status >= 500) throw new Error('HTTP ' + response.status)
        if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status + ' ' + (await response.text()).slice(0, 300)), { fatal: true })
        return replyText(await response.json())
      } catch (reason) {
        last = reason
        if (reason?.fatal || attempt === retries) break
        await sleep(1000 * 2 ** attempt)
      }
    }
    throw new Error('Model call failed (' + api + ' ' + model + '): ' + (last instanceof Error ? last.message : String(last)))
  }
}

/** The text of a reply in either shape. */
export function replyText(json) {
  const chat = json?.choices?.[0]?.message?.content
  if (typeof chat === 'string') return chat
  if (typeof json?.output_text === 'string') return json.output_text
  const parts = (json?.output ?? []).flatMap(item => item?.type === 'message' || item?.content ? (item.content ?? []) : [])
  const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').join('')
  if (text) return text
  throw new Error('The reply has no text.')
}

/** The first JSON object in a reply, tolerating code fences and prose around it. */
export function parseJSONReply(text) {
  const cleaned = text.replace(/^[\s\S]*?(?=[{[])/, '').replace(/\u0060\u0060\u0060[\s\S]*$/, '')
  for (const candidate of [text.trim(), cleaned.trim()]) { try { return JSON.parse(candidate) } catch { /* try the next */ } }
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
  throw new Error('The reply is not JSON.')
}

const SYSTEM = 'You help build practice material for an English-speaking learner of Mandarin. Use simple, natural, everyday Chinese. Pinyin has tone marks and spaces between syllables. English has no Chinese characters. Reply with JSON only.'
const gloss = word => word.ds.split(/[;；]/)[0].trim()
const wordLine = word => word.ch + ' (' + word.pr + '): ' + gloss(word)
/** What a word or grammar point is called in prompts and logs: the word's form, or the pattern. */
const formOf = word => word.grammar ? word.grammar.pt : word.ch
/** A grammar point as a target the pipeline treats like a word: its lesson is the lesson that introduces it, and its label is "grammar:" + ref (as in the state). */
export const grammarWord = point => ({ lb: 'grammar:' + point.lb, ch: '', pr: point.pr, ds: point.ds, band: point.band, index: point.index, order: -1, grammar: point })
/** Lessons are counted from 1 for people; the curriculum index counts from 0. */
const lessonNumber = index => index + 1
/** Lessons this close to the word (and every later one in the window) are listed with pinyin and meaning; older ones as bare forms. */
const DETAILED_LESSONS = 6

/**
 * The vocabulary one word may use, grouped by lesson, newest first: [{ lesson, words }]. Lessons from the word's own lesson backwards (and every look-ahead
 * lesson above it) carry pinyin and meaning; older lessons are bare forms, at most VOCAB_CAP of them. Not one capped list per batch.
 */
export function vocabularyFor(curriculum, word, lookahead = 0, { cap = VOCAB_CAP } = {}) {
  const top = word.index + lookahead
  const groups = new Map()
  for (const other of curriculum.ordered) { if (other.index > top) break; const list = groups.get(other.index) ?? []; list.push(other); groups.set(other.index, list) }
  let bare = 0
  return [...groups.entries()].sort((x, y) => y[0] - x[0]).map(([index, list]) => {
    const detailed = index > word.index - DETAILED_LESSONS
    if (detailed) return { lesson: lessonNumber(index), words: list.map(wordLine) }
    const room = Math.max(0, cap - bare)
    bare += Math.min(room, list.length)
    return { lesson: lessonNumber(index), words: list.slice(0, room).map(other => other.ch) }
  }).filter(group => group.words.length)
}

/** At most this many grammar points are listed to the models per call, newest lessons first. */
export const GRAMMAR_CAP = 120
const meaningOf = point => point.ds.split(/[.;；]/)[0].trim().slice(0, 90)
/**
 * The grammar points a phrase for this word may use, grouped by the lesson that introduces them, newest first: [{ lesson, points: [{ ref, pattern, meaning }] }].
 * Same window as the vocabulary: lessons up to the word's own plus the look-ahead.
 */
export function grammarFor(curriculum, word, lookahead = 0, { cap = GRAMMAR_CAP } = {}) {
  const top = word.index + lookahead
  const groups = new Map()
  let taken = 0
  for (const point of [...(curriculum.grammarOrdered ?? [])].filter(point => point.index <= top).reverse()) {
    if (taken >= cap) break
    taken++
    const list = groups.get(point.index) ?? []
    list.push({ ref: point.lb, pattern: point.pt, meaning: meaningOf(point) })
    groups.set(point.index, list)
  }
  return [...groups.entries()].sort((x, y) => y[0] - x[0]).map(([index, points]) => ({ lesson: lessonNumber(index), points }))
}

/** Groups items by the lesson of their word (and look-ahead), keeping their order: a batch's words share a window only with their own lesson mates. */
function groupByLesson(items, lookaheadOf) {
  const groups = new Map()
  for (const item of items) { const key = item.word.index + ':' + lookaheadOf(item); const group = groups.get(key) ?? { word: item.word, lookahead: lookaheadOf(item), items: [] }; group.items.push(item); groups.set(key, group) }
  return [...groups.values()]
}

const planPrompt = (entries, lookahead, curriculum) => 'For each word write ' + 'one short spec per phrase still needed: a different everyday situation, sentence pattern or grammar point to vary, so the word\'s phrases differ from each other and from its existing ones. A spec is a few words, e.g. "asking a question about a place". ' +
  'Return {"plans":[{"ref","specs":["..."]}]} with the ref copied from the word, and exactly "need" specs each.\n' + JSON.stringify({ words: entries.map(entry => ({ ref: entry.word.lb, form: formOf(entry.word), ...(entry.word.grammar ? { construct: entry.word.grammar.lb } : {}), pinyin: entry.word.pr, meaning: gloss(entry.word), lesson: lessonNumber(entry.word.index), need: entry.need, existing: entry.existing })) })
const writePrompt = (curriculum, entries, lookahead, avoid, extra = '') => 'Write phrases for each word, one per spec (or ' + 'one per needed slot when there is no spec). Each Chinese phrase is a short sentence or clause of at most ' + MAX_PHRASE_SYLLABLES + ' syllables that contains the word\'s form. Every Chinese word must come from the "vocabulary" of its lesson group, the word itself or the basic function characters ' + FUNCTION_CHARACTERS + '. No other words. ' +
  'Vocabulary is listed by lesson, newest first. Lean on the word\'s own lesson and the lessons near it (including the newer look-ahead lessons, when listed above the word\'s own) rather than the oldest basics such as 我/你/是/学生: the phrase should reinforce what is new. Do not repeat a phrase from "avoid" or write the same phrase for two words; a phrase that uses another word of the batch is fine, it is credited to both. ' + extra +
  'Grammar: each group also lists the grammar points of its window under "grammar", newest first, each with a ref. Prefer the newer ones, so the phrase practises what the learner has just met. Tag every phrase with "grammar": the refs, copied exactly from that list, of the grammar patterns the phrase really uses (an empty list when it uses none). Do not tag a pattern that is not in the list. ' +
  'An entry with "construct" is a grammar point (its ref is the "construct" value): write phrases that use that construct naturally, with no particular word required, and list its ref under "grammar". Do not force constructs into the phrases written for words: tag only what a phrase really uses. ' +
  'Return {"phrases":[{"ref","zh","py","en","grammar":["..."]}]} with the ref copied from the word or grammar entry.\n' + JSON.stringify({ avoid, groups: groupByLesson(entries, () => lookahead).map(group => ({ lesson: lessonNumber(group.word.index), lookahead: group.lookahead, vocabulary: vocabularyFor(curriculum, group.word, group.lookahead), grammar: grammarFor(curriculum, group.word, group.lookahead), words: group.items.map(entry => ({ ref: entry.word.lb, form: formOf(entry.word), ...(entry.word.grammar ? { construct: entry.word.grammar.lb } : {}), pinyin: entry.word.pr, meaning: gloss(entry.word), specs: entry.specs, existing: entry.existing, ...(entry.fix ? { rewrite: entry.fix } : {}) })) })) })
const checkPrompt = (curriculum, items) => 'Review each practice phrase. For each, answer natural (the Chinese is natural, correct and something a native speaker would say) and matches (the English is a faithful translation of the Chinese). Vocabulary level is checked by code, not by you: do not judge it. ' +
  'Also confirm the grammar tags: each phrase lists the grammar refs the writer tagged under "grammar", and each group lists the grammar points of its window. Return in "grammar" the refs of the patterns the phrase really uses: drop a wrong tag, add a pattern from the group\'s list that the phrase uses and the writer missed. Only refs from the group\'s list count. ' +
  'When natural or matches is false give the concrete reason in "reason"; a phrase is only rejected for a reason you state. Return {"results":[{"id","natural","matches","grammar","reason"}]}.\n' +
  JSON.stringify({ groups: groupByLesson(items, item => item.phrase.lookahead ?? 0).map(group => ({ lesson: lessonNumber(group.word.index), vocabulary: vocabularyFor(curriculum, group.word, group.lookahead), grammar: grammarFor(curriculum, group.word, group.lookahead), phrases: group.items.map(item => ({ id: item.id, zh: item.phrase.zh, en: item.phrase.en, word: formOf(item.word), grammar: item.phrase.grammar ?? [], uses: (item.phrase.words ?? []).map(lb => curriculum.words.get(lb)).filter(Boolean).map(wordLine) })) })) })

// ---------------------------------------------------------------- pipeline

const chunks = (list, size) => { const out = []; for (let at = 0; at < list.length; at += size) out.push(list.slice(at, at + size)); return out }
const idOf = (lb, zh) => lb + '|' + zh

/** Batches of at most size words whose lessons lie within span of the batch's first lesson: the same or adjacent lessons, so they share a vocabulary window. */
export function batchByLesson(entries, size, span = 1) {
  const batches = []
  let current = []
  for (const entry of entries) {
    if (current.length && (current.length >= size || entry.word.index > current[0].word.index + span)) { batches.push(current); current = [] }
    current.push(entry)
  }
  if (current.length) batches.push(current)
  return batches
}

const flag = value => value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true') ? true : value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false') ? false : undefined

/**
 * One checker row as a verdict. A phrase is rejected only when natural or matches is (explicitly) false AND the checker states a reason; a missing or
 * stringly-typed field is read as it was meant, and a missing field is not a failure. Vocabulary is code's job and is not asked of the checker.
 */
export function verdictOf(row) {
  const reason = typeof row?.reason === 'string' ? row.reason.trim().slice(0, 200) : ''
  const failed = flag(row?.natural) === false || flag(row?.matches) === false
  return failed && reason ? { ok: false, reason } : { ok: true, reason: failed ? 'flagged without a reason, kept' : reason }
}

/** Judges a batch in one call: id => { ok, reason }, each word judged with its own lesson's vocabulary. Throws when the call or its reply fails. */
async function checkBatch(io, curriculum, items) {
  const reply = parseJSONReply(await io.check(SYSTEM, checkPrompt(curriculum, items)))
  const verdicts = new Map()
  for (const row of Array.isArray(reply?.results) ? reply.results : []) if (typeof row?.id === 'string') verdicts.set(row.id, { ...verdictOf(row), ...(Array.isArray(row.grammar) ? { grammar: row.grammar } : {}) })
  return verdicts
}

/** The phrase as the checker confirmed it: its grammar tags are the checker's (checked by code against the window); a verdict without them keeps the writer's. */
const confirmed = (curriculum, item, verdict) => {
  const phrase = { ...item.phrase, checked: true }
  return verdict?.grammar ? applyGrammar(curriculum, phrase, verdict.grammar, item.entry?.allowed ?? allowedFor(curriculum, item.word, phrase.lookahead ?? 0)) : phrase
}

const logVerdict = (log, item, verdict) => log(formOf(item.word) + ': checker dropped "' + item.phrase.zh + '" (' + verdict.reason + ')')

/** One batch of words through plan, write, validate, check and one rewrite. Returns the new phrases per word and notes for the log. */
export async function processBatch({ curriculum, entries, io, options, lookahead = 0, log = () => {}, taken = new Set() }) {
  const avoid = [...new Set(entries.flatMap(entry => entry.existingZh))].slice(0, 80)
  const result = new Map(entries.map(entry => [entry.word.lb, { phrases: [], note: '' }]))
  // a phrase is stored once: not one already in hand (taken), nor one this batch has written for another word
  const seen = new Set([...taken, ...entries.flatMap(entry => entry.existingZh)])
  // plan (opt-in: a failed or skipped plan leaves the writer with its fixed prompt)
  if (io.plan && options.plan) {
    try {
      const plans = parseJSONReply(await io.plan(SYSTEM, planPrompt(entries, lookahead, curriculum))).plans
      for (const row of Array.isArray(plans) ? plans : []) { const entry = entries.find(item => item.word.lb === row?.ref); if (entry && Array.isArray(row.specs)) entry.specs = row.specs.filter(spec => typeof spec === 'string').slice(0, entry.need) }
    } catch (reason) { log('plan failed, writing without specs: ' + reason.message) }
  }
  const validate = rows => {
    const out = []
    for (const row of Array.isArray(rows) ? rows : []) {
      const entry = entries.find(item => item.word.lb === row?.ref)
      if (!entry) continue
      const checked = validatePhrase(curriculum, entry.word, row, entry.allowed)
      if (!checked.phrase) { log(formOf(entry.word) + ': ' + checked.reason + ' (' + String(row?.zh).slice(0, 20) + ')'); continue }
      if (seen.has(checked.phrase.zh)) continue
      seen.add(checked.phrase.zh)
      out.push({ entry, phrase: checked.phrase })
    }
    return out
  }
  let written
  try { written = validate(parseJSONReply(await io.write(SYSTEM, writePrompt(curriculum, entries, lookahead, avoid))).phrases) } catch (reason) {
    for (const entry of entries) result.get(entry.word.lb).note = 'write failed: ' + reason.message
    return result
  }
  // limit each word to what it needs
  const perWord = new Map()
  written = written.filter(item => { const n = perWord.get(item.entry) ?? 0; perWord.set(item.entry, n + 1); return n < item.entry.need })
  const items = written.map(item => ({ ...item, word: item.entry.word, id: idOf(item.entry.word.lb, item.phrase.zh) }))
  let verdicts
  try { verdicts = items.length ? await checkBatch(io, curriculum, items) : new Map() } catch (reason) {
    // the check itself failed: keep the phrases, unchecked, and say so
    log('check failed, keeping ' + items.length + ' phrases unchecked: ' + reason.message)
    for (const item of items) result.get(item.entry.word.lb).phrases.push({ ...item.phrase, checked: false })
    return result
  }
  const failed = []
  for (const item of items) {
    const verdict = verdicts.get(item.id)
    if (!verdict) result.get(item.entry.word.lb).phrases.push({ ...item.phrase, checked: false })
    else if (verdict.ok) result.get(item.entry.word.lb).phrases.push(confirmed(curriculum, item, verdict))
    else { logVerdict(log, item, verdict); failed.push({ ...item, reason: verdict.reason }) }
  }
  if (failed.length) {
    // rewritten once, in one batch, and checked again; whatever still fails is dropped
    const rewriteEntries = [...new Set(failed.map(item => item.entry))].map(entry => ({ ...entry, specs: failed.filter(item => item.entry === entry).map(item => 'replace "' + item.phrase.zh + '" (' + item.reason + ')'), fix: failed.filter(item => item.entry === entry).map(item => ({ zh: item.phrase.zh, problem: item.reason })), need: failed.filter(item => item.entry === entry).length }))
    try {
      const again = validate(parseJSONReply(await io.write(SYSTEM, writePrompt(curriculum, rewriteEntries, lookahead, avoid, 'Each word lists phrases that failed review under "rewrite"; write a better replacement for each. '))).phrases)
        .map(item => ({ ...item, entry: entries.find(entry => entry.word.lb === item.entry.word.lb), word: item.entry.word, id: idOf(item.entry.word.lb, item.phrase.zh) }))
      const limited = again.filter(item => !failed.some(old => old.id === item.id)).slice(0, failed.length)
      let second = new Map()
      try { second = limited.length ? await checkBatch(io, curriculum, limited) : second } catch (reason) {
        log('second check failed, keeping rewrites unchecked: ' + reason.message)
        for (const item of limited) result.get(item.entry.word.lb).phrases.push({ ...item.phrase, checked: false })
        return result
      }
      for (const item of limited) {
        const verdict = second.get(item.id)
        if (!verdict || verdict.ok) result.get(item.entry.word.lb).phrases.push(verdict ? confirmed(curriculum, item, verdict) : { ...item.phrase, checked: false })
        else logVerdict(log, item, verdict)
      }
    } catch (reason) { log('rewrite failed, dropping ' + failed.length + ' phrases: ' + reason.message) }
  }
  return result
}

/** Phrases kept unchecked, judged again in one batch per --batch-size, each against the lesson of the word it uses that the curriculum introduces last. */
export async function recheck({ curriculum, state, io, options, log = () => {}, save = () => {} }) {
  const pending = []
  for (const phrase of state.phrases) { const word = anchorWord(curriculum, phrase); if (word && !phrase.checked) pending.push({ word, phrase, id: idOf(word.lb, phrase.zh) }) }
  for (const batch of batchByLesson(pending, options.batchSize, options.lessonSpan ?? 1)) {
    try {
      const verdicts = await checkBatch(io, curriculum, batch)
      for (const item of batch) {
        const verdict = verdicts.get(item.id)
        if (!verdict) continue
        if (verdict.ok) Object.assign(item.phrase, confirmed(curriculum, item, verdict))
        else { logVerdict(log, item, verdict); state.phrases = state.phrases.filter(phrase => phrase !== item.phrase) }
      }
      save()
    } catch (reason) { log('recheck failed: ' + reason.message) }
  }
}

/**
 * The run's state. 'phrases' is the flat list of phrases (each once, with its id and band), read from and written to the band YAML files; 'lastId' is the highest id
 * given per band. 'words' is only progress per word (status, attempts, look-ahead reached), kept in the state file.
 */
export const emptyState = () => ({ version: 2, words: {}, phrases: [], lastId: {} })

/** Adds a phrase to the list with the next id of its band (the band of the word it uses that is introduced last); nothing happens when the phrase is already there. */
export function addPhrase(curriculum, state, phrase) {
  if (state.phrases.some(other => other.zh === phrase.zh)) return undefined
  const band = phrase.band ?? bandOfWords(curriculum, phrase.words)
  const high = state.lastId[band] ?? Math.max(0, ...state.phrases.filter(other => other.band === band).map(other => other.id))
  state.lastId[band] = high + 1
  const added = { ...phrase, band, id: high + 1, readyAt: phrase.readyAt ?? readyAtOf(curriculum, phrase.words, phrase.grammar) }
  state.phrases.push(added)
  return added
}

/** The phrases in hand that use the word (or are tagged with the grammar point, for a target made by grammarWord) and are ready by its lesson plus the look-ahead: what counts towards the word's total. */
export function phrasesForWord(curriculum, state, word, lookahead = 0) {
  return state.phrases.filter(phrase => (word.grammar ? (phrase.grammar ?? []).includes(word.grammar.lb) : phrase.words.includes(word.lb)) && (phrase.readyAt ?? readyAtOf(curriculum, phrase.words, phrase.grammar)) <= word.index + lookahead)
}

/** Per grammar point, how many phrases in the flat list are tagged with it; points with none are absent. */
export function grammarCounts(state) {
  const counts = new Map()
  for (const phrase of state.phrases) for (const ref of new Set(phrase.grammar ?? [])) counts.set(ref, (counts.get(ref) ?? 0) + 1)
  return counts
}

/** Per word, how many phrases in the flat list use it (derived from each phrase's words); words with none are absent. */
export function wordCounts(state) {
  const counts = new Map()
  for (const phrase of state.phrases) for (const lb of new Set(phrase.words)) counts.set(lb, (counts.get(lb) ?? 0) + 1)
  return counts
}

/** "1-10", "5" or "3-": the lesson range as { from, to } (counted from 1). */
export function parseLessons(text) {
  const match = /^\s*(\d+)\s*(?:-\s*(\d*))?\s*$/.exec(String(text))
  if (!match || Number(match[1]) < 1) throw new Error('--lessons takes a range such as 1-10 (lessons are counted from 1): ' + text)
  const from = Number(match[1]), to = match[2] === undefined ? from : match[2] === '' ? Infinity : Number(match[2])
  if (to < from) throw new Error('--lessons range is backwards: ' + text)
  return { from, to }
}

/** The look-ahead passes as numbers: "0,2,4,8,16", ascending, each a whole number of lessons. */
export function parseLookahead(text) {
  const list = String(text).split(',').map(item => item.trim()).filter(Boolean).map(Number)
  if (!list.length || list.some(value => !Number.isInteger(value) || value < 0)) throw new Error('--lookahead takes whole numbers of lessons such as 0,2,4,8,16: ' + text)
  return [...new Set(list)].sort((x, y) => x - y)
}

/** Words in scope for the options (--lessons, --band, --words), in teaching order. */
export function wordsInScope(curriculum, options) {
  if (options.grammar?.length && !options.words?.length) return []
  const bands = options.bands?.length ? new Set(options.bands) : undefined
  const only = options.words?.length ? new Set(options.words) : undefined
  const { from = 1, to = Infinity } = options.lessons ?? {}
  return curriculum.ordered.filter(word => (!bands || bands.has(word.band)) && (!only || only.has(word.lb)) && lessonNumber(word.index) >= from && lessonNumber(word.index) <= to)
}

/** The grammar points in scope (--lessons, --band, --grammar), as targets, in teaching order. --words alone leaves them out, --grammar alone leaves the words out. */
export function grammarInScope(curriculum, options) {
  if (options.words?.length && !options.grammar?.length) return []
  const bands = options.bands?.length ? new Set(options.bands) : undefined
  const only = options.grammar?.length ? new Set(options.grammar) : undefined
  const { from = 1, to = Infinity } = options.lessons ?? {}
  return (curriculum.grammarOrdered ?? []).filter(point => (!bands || bands.has(point.band)) && (!only || only.has(point.lb)) && lessonNumber(point.index) >= from && lessonNumber(point.index) <= to).map(grammarWord)
}

/** Which words need phrases in a pass, in teaching order: code decides from the catalog counts (examples that fit the pass's window) and the phrases in hand. */
export function selectWords({ curriculum, state, options, lookahead = 0 }) {
  const fitted = catalogPhrases(curriculum, lookahead)
  const only = options.words?.length
  const entries = []
  for (const word of wordsInScope(curriculum, options)) {
    const record = state.words[word.lb]
    if (record?.status === 'done') continue
    if (record && !options.retry && !only && (record.lookahead ?? 0) >= lookahead) continue
    const existing = fitted.get(word.lb) ?? []
    const mine = phrasesForWord(curriculum, state, word, lookahead)
    const need = options.target - existing.length - mine.length
    if (need <= 0) continue
    entries.push({ word, need, existing: [...existing, ...mine].slice(0, 3).map(item => item.zh), existingZh: [...existing.map(item => item.zh), ...mine.map(item => item.zh)], specs: [], allowed: allowedFor(curriculum, word, lookahead), catalogCount: existing.length })
  }
  // grammar points are targets too: same target, same windows; batches mix them with the words of the same lessons
  for (const word of grammarInScope(curriculum, options)) {
    const record = state.words[word.lb]
    if (record?.status === 'done') continue
    if (record && !options.retry && !(options.grammar?.length) && (record.lookahead ?? 0) >= lookahead) continue
    const existing = fitted.get(word.lb) ?? []
    const mine = phrasesForWord(curriculum, state, word, lookahead)
    const need = options.target - existing.length - mine.length
    if (need <= 0) continue
    entries.push({ word, need, existing: [...existing, ...mine].slice(0, 3).map(item => item.zh), existingZh: [...existing.map(item => item.zh), ...mine.map(item => item.zh)], specs: [], allowed: allowedFor(curriculum, word, lookahead), catalogCount: existing.length })
  }
  entries.sort((a, b) => a.word.index - b.word.index)
  return options.limit ? entries.slice(0, options.limit) : entries
}

/** Brings an entry up to date with the phrases in hand (written for other words since the pass began, which count for it too). */
function refreshEntry(curriculum, state, entry, lookahead, target) {
  const mine = phrasesForWord(curriculum, state, entry.word, lookahead)
  entry.need = target - entry.catalogCount - mine.length
  for (const phrase of mine) if (!entry.existingZh.includes(phrase.zh)) entry.existingZh.push(phrase.zh)
}

export async function runPipeline({ curriculum, state, io, options, log = () => {}, save = () => {} }) {
  const passes = options.lookahead?.length ? options.lookahead : [0]
  state.target = options.target
  state.passes = state.passes ?? {}
  for (const lookahead of passes) {
    const entries = selectWords({ curriculum, state, options, lookahead })
    for (const entry of entries) { const record = state.words[entry.word.lb]; if (record) record.lookahead = Math.max(record.lookahead ?? 0, lookahead) }
    const batches = batchByLesson(entries, options.batchSize, options.lessonSpan ?? 1)
    log('pass look-ahead ' + lookahead + ': ' + entries.length + ' words under target, ' + entries.length + ' to write in ' + batches.length + ' batches')
    for (const [at, batch] of batches.entries()) {
      // what was written for earlier words may already serve these: a phrase counts for every word it uses
      for (const entry of batch) refreshEntry(curriculum, state, entry, lookahead, options.target)
      const live = batch.filter(entry => entry.need > 0)
      for (const entry of batch) if (entry.need <= 0) state.words[entry.word.lb] = { ...state.words[entry.word.lb], status: 'done', attempts: state.words[entry.word.lb]?.attempts ?? 0, lookahead: Math.max(state.words[entry.word.lb]?.lookahead ?? 0, lookahead) }
      if (live.length) {
        const result = await processBatch({ curriculum, entries: live, io, options, lookahead, log, taken: new Set(state.phrases.map(phrase => phrase.zh)) })
        for (const entry of live) {
          const outcome = result.get(entry.word.lb)
          for (const phrase of outcome.phrases) addPhrase(curriculum, state, { ...phrase, lookahead })
          const record = state.words[entry.word.lb] ?? { status: 'failed', attempts: 0 }
          record.attempts += 1
          record.lookahead = Math.max(record.lookahead ?? 0, lookahead)
          const mine = phrasesForWord(curriculum, state, entry.word, lookahead)
          record.status = entry.catalogCount + mine.length >= options.target ? 'done' : mine.length ? 'partial' : 'failed'
          if (outcome.note) record.note = outcome.note; else delete record.note
          state.words[entry.word.lb] = record
        }
      }
      save()
      log('batch ' + (at + 1) + '/' + batches.length + ' saved')
    }
    state.passes[lookahead] = { at: new Date().toISOString() }
  }
  return state
}

/** Per pass how many words in scope have reached the target, and the words that still have no phrase after the last pass (from the state). */
export function passReport(curriculum, state, options) {
  const passes = options.lookahead?.length ? options.lookahead : DEFAULT_LOOKAHEAD
  const words = wordsInScope(curriculum, options)
  const points = grammarInScope(curriculum, options)
  const countsOf = (targets, lookahead) => {
    const fitted = catalogPhrases(curriculum, lookahead)
    return new Map(targets.map(target => [target.lb, (fitted.get(target.lb)?.length ?? 0) + phrasesForWord(curriculum, state, target, lookahead).length]))
  }
  let previous = 0, previousGrammar = 0
  const perPass = passes.map(lookahead => {
    const reached = [...countsOf(words, lookahead).values()].filter(count => count >= options.target).length
    const reachedGrammar = [...countsOf(points, lookahead).values()].filter(count => count >= options.target).length
    const row = { lookahead, reached, newlyReached: reached - previous, of: words.length, grammar: { reached: reachedGrammar, newlyReached: reachedGrammar - previousGrammar, of: points.length } }
    previous = reached; previousGrammar = reachedGrammar
    return row
  })
  const final = countsOf(words, passes.at(-1)), finalGrammar = countsOf(points, passes.at(-1))
  const noWords = words.filter(word => final.get(word.lb) === 0), noPoints = points.filter(point => finalGrammar.get(point.lb) === 0)
  return {
    target: options.target, words: words.length, grammarPoints: points.length, passes: perPass,
    zeroPhrase: noWords.length, zeroPhraseWords: noWords.slice(0, 100).map(word => word.ch + ' (' + word.lb + ', lesson ' + lessonNumber(word.index) + ')'),
    zeroGrammar: noPoints.length, zeroGrammarPoints: noPoints.slice(0, 100).map(point => point.grammar.pt + ' (' + point.grammar.lb + ', lesson ' + lessonNumber(point.index) + ')'),
  }
}

// ---------------------------------------------------------------- output

/** The band files: one per band, a flat list in id order (the band of a phrase is the band of the word it uses that is introduced last). */
export function buildOutputs(curriculum, state) {
  return BANDS.map(band => ({
    band, lastId: state.lastId[band] ?? 0,
    phrases: state.phrases.filter(phrase => phrase.band === band).sort((a, b) => a.id - b.id).map(({ band: _band, ...phrase }) => phrase),
  }))
}

/** Writes the authored YAML files (and the app's JSON, when jsonDir is given). */
export function writeOutputs(outDir, outputs, jsonDir) { writePhraseBands(outputs, { authoringDir: outDir, jsonDir }) }

/** The progress per word, as a file; the phrases live in the YAML files. A state file of the first format (phrases inside each word's record) is converted. */
export function loadState(file) {
  if (!existsSync(file)) return emptyState()
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (!isOldState(raw)) return { ...emptyState(), ...raw, phrases: [], lastId: {} }
  const old = readOldState(raw)
  return { ...emptyState(), words: old.words, phrases: old.phrases, ...(old.target !== undefined ? { target: old.target } : {}), ...(old.passes ? { passes: old.passes } : {}) }
}
export function saveState(file, state) { const { phrases: _phrases, lastId: _lastId, ...progress } = state; writeAtomic(file, JSON.stringify(progress, null, 1) + '\n') }

/**
 * The phrases of the band files, then any carried over from an old-format state or bank (without ids), into the state's flat list: each phrase once, an
 * existing id kept, a new one given the next number of its band.
 */
export function attachPhrases(curriculum, state, dir, carried = []) {
  const carry = [...state.phrases, ...carried]
  state.phrases = []; state.lastId = {}
  for (const file of readPhraseBands(dir)) {
    state.lastId[file.band] = file.lastId
    for (const phrase of file.phrases) state.phrases.push({ ...phrase, band: file.band, readyAt: phrase.readyAt ?? readyAtOf(curriculum, phrase.words, phrase.grammar) })
  }
  let added = 0
  for (const phrase of carry) if (addPhrase(curriculum, state, { ...phrase, band: undefined, id: undefined, readyAt: phrase.readyAt ?? readyAtOf(curriculum, phrase.words, phrase.grammar) })) added++
  return added
}

// ---------------------------------------------------------------- command line

export function parseArgs(argv, env = process.env) {
  const flags = new Map()
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (!arg.startsWith('--')) throw new Error('Unexpected argument: ' + arg)
    const [name, inline] = arg.slice(2).split(/=(.*)/s)
    const boolean = ['report', 'retry', 'recheck', 'plan', 'dry-run', 'help'].includes(name)
    flags.set(name, boolean ? true : inline ?? argv[++at])
  }
  const get = (name, envName, fallback) => flags.get(name) ?? env[envName] ?? fallback
  const list = value => value ? String(value).split(',').map(item => item.trim()).filter(Boolean) : undefined
  const model = role => get(role + '-model', 'PHRASE_' + role.toUpperCase() + '_MODEL')
  return {
    report: flags.has('report'), help: flags.has('help'), dryRun: flags.has('dry-run'), retry: flags.has('retry'), recheck: flags.has('recheck'), plan: flags.has('plan'), lookahead: parseLookahead(get('lookahead', 'PHRASE_LOOKAHEAD', DEFAULT_LOOKAHEAD.join(','))), lessons: flags.has('lessons') ? parseLessons(flags.get('lessons')) : undefined, lessonSpan: Number(get('lesson-span', 'PHRASE_LESSON_SPAN', 1)),
    baseUrl: get('base-url', 'PHRASE_BASE_URL'), apiKey: env[get('api-key-env', 'PHRASE_API_KEY_ENV', 'PHRASE_API_KEY')],
    roles: {
      planner: { model: model('planner'), api: get('planner-api', 'PHRASE_PLANNER_API', 'chat') },
      writer: { model: model('writer'), api: get('writer-api', 'PHRASE_WRITER_API', 'chat') },
      checker: { model: model('checker') ?? model('planner'), api: get('checker-api', 'PHRASE_CHECKER_API', get('planner-api', 'PHRASE_PLANNER_API', 'chat')) },
    },
    target: Number(get('target', 'PHRASE_TARGET', DEFAULT_TARGET)), batchSize: Number(get('batch-size', 'PHRASE_BATCH_SIZE', 20)),
    bands: list(flags.get('band')), words: list(flags.get('words')), grammar: list(flags.get('grammar')), importOld: list(flags.get('import-old')), limit: flags.has('limit') ? Number(flags.get('limit')) : undefined,
    out: resolve(get('out', 'PHRASE_OUT', defaultPhraseAuthoringDir)), jsonOut: resolve(get('json-out', 'PHRASE_JSON_OUT', defaultPhraseJsonDir)), state: resolve(get('state', 'PHRASE_STATE', join(root, 'build', 'phrase-bank', 'state-v2.json'))),
    dataDir: resolve(get('data-dir', 'PHRASE_DATA_DIR', join(root, 'src', 'data', 'v2'))),
  }
}

export function createIO(options, fetchImpl) {
  const make = role => createCaller({ baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.roles[role].model, api: options.roles[role].api, ...(fetchImpl ? { fetchImpl, sleep: async () => {} } : {}) })
  return { plan: !options.plan || !options.roles.planner.model ? undefined : make('planner'), write: make('writer'), check: make('checker') }
}

export async function main(argv = process.argv.slice(2), { fetchImpl, log = console.log } = {}) {
  const options = parseArgs(argv)
  if (options.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')); return }
  const curriculum = buildCurriculum(readCatalog(options.dataDir))
  const state = loadState(options.state)
  // the band YAML files are the phrases; phrases of an old-format state (no ids) are carried into them
  const carried = []
  for (const file of options.importOld ?? []) {
    const raw = JSON.parse(readFileSync(resolve(file), 'utf8'))
    if (isOldState(raw)) { const old = readOldState(raw); carried.push(...old.phrases); for (const [lb, record] of Object.entries(old.words)) state.words[lb] ??= record } else carried.push(...readOldBank(raw))
  }
  const added = attachPhrases(curriculum, state, options.out, carried)
  const save = () => { saveState(options.state, state); writeOutputs(options.out, buildOutputs(curriculum, state), options.jsonOut) }
  if (options.importOld?.length) { save(); log('imported ' + added + ' phrases from the old format into ' + options.out); return }
  if (options.report) { log(JSON.stringify({ ...coverageReport(curriculum), lookahead: passReport(curriculum, state, options) }, null, 1)); return }
  if (options.dryRun) {
    const chosen = selectWords({ curriculum, state, options, lookahead: options.lookahead[0] })
    log(chosen.length + ' words and grammar points would get phrases; first: ' + chosen.slice(0, 5).map(entry => formOf(entry.word) + ' (' + entry.need + ')').join(', '))
    return
  }
  if (!options.baseUrl || !options.roles.writer.model || !options.roles.checker.model) throw new Error('Give --base-url, --writer-model and --checker-model (or --planner-model); see the header of this script.')
  const io = createIO(options, fetchImpl)
  if (options.recheck) await recheck({ curriculum, state, io, options, log, save })
  await runPipeline({ curriculum, state, io, options, log, save })
  save()
  const counts = { done: 0, partial: 0, failed: 0 }
  for (const record of Object.values(state.words)) counts[record.status]++
  for (const row of passReport(curriculum, state, options).passes) log('look-ahead ' + row.lookahead + ': ' + row.reached + '/' + row.of + ' words and ' + row.grammar.reached + '/' + row.grammar.of + ' grammar points at target')
  log('done ' + counts.done + ', partial ' + counts.partial + ', failed ' + counts.failed + ' (re-run with --retry for the last two)')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exitCode = 1 })
