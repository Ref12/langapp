// Builds the shipped phrase bank (src/data/phrases/hsk-N.json): several short practice phrases per vocabulary word, written offline.
//
// Pipeline (all batched, no agent loop):
//   1. Code reads the catalog (src/data/v2) and decides which words need more phrases: fewer than --target (default 3) authored examples that
//      fit (translated, at most 12 syllables, made only of words introduced by that word's lesson).
//   2. PLAN   - a strong model gives each such word a short spec per phrase (situation, sentence pattern or grammar point to vary).
//   3. WRITE  - a cheap model writes the phrases to the specs.
//   4. CODE VALIDATES each phrase: it contains the word, has pinyin and English, is short, and uses only words introduced by that word's point in the
//      curriculum plus the function characters the app allows everywhere (FUNCTION_CHARACTERS in src/core/drills/content.ts).
//   5. CHECK  - the strong model judges natural Chinese, English that matches, only allowed words. Failures are rewritten once by the writer, then
//      checked again; what still fails is dropped. If the check call itself fails the phrases are kept with checked:false (re-run with --recheck).
//   6. Output files are rewritten from the state file after every batch, so a run can be stopped and resumed.
//
// Usage (the endpoint is OpenAI compatible; hexad's gateway is http://localhost:5210/v1):
//   node scripts/build-phrase-bank.mjs --report
//   node scripts/build-phrase-bank.mjs --base-url http://localhost:5210/v1 \
//     --planner-model sonnet --planner-api chat \
//     --writer-model luna --writer-api responses \
//     --checker-model sonnet --checker-api chat
//   Options: --api-key-env NAME (default PHRASE_API_KEY), --target 3, --batch-size 20, --band 1,2, --words lb1,lb2, --limit N, --no-plan,
//            --retry (words that ended partial or failed), --recheck (phrases kept unchecked), --out DIR, --state FILE, --data-dir DIR, --dry-run
//   Environment alternatives: PHRASE_BASE_URL, PHRASE_PLANNER_MODEL, PHRASE_WRITER_MODEL, PHRASE_CHECKER_MODEL, PHRASE_*_API.
//   Re-running skips words already done, so the command can be repeated until nothing is left.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BANDS = ['1', '2', '3', '4', '5', '6']
/** Kept in step with FUNCTION_CHARACTERS in src/core/drills/content.ts (a test compares them). */
export const FUNCTION_CHARACTERS = '的了吗呢吧是不很也都和在有这那我你他她们个'
export const MAX_PHRASE_SYLLABLES = 12
export const DEFAULT_TARGET = 3
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
  for (const data of bands) for (const record of data.grammar) grammarRecords.set(record.lb, record)
  for (const data of bands) {
    for (const group of data.groups) {
      for (const unit of group.units) if (unit.kind === 'vocabulary') { const word = words.get(unit.ref); if (word && word.index === Infinity) word.index = index }
      for (const example of group.examples) examples.push({ ...example, index })
      index++
    }
  }
  for (const record of grammarRecords.values()) examples.push({ ...record.ex, grammar: record.ex.grammar ?? [], index: Infinity })
  const ordered = [...words.values()].sort((a, b) => a.index - b.index)
  ordered.forEach((word, order) => { word.order = order; if (word.index === Infinity) word.index = index })
  for (const example of examples) if (example.index === Infinity) example.index = Math.max(0, ...example.segments.flatMap(segment => segment.word && words.get(segment.word) ? [words.get(segment.word).index] : [0]))
  return { words, ordered, examples, groupCount: index }
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
export function catalogPhrases(curriculum) {
  const found = new Map()
  for (const example of curriculum.examples) {
    const rendered = renderExample(curriculum, example)
    if (!rendered || !rendered.en || hanCount(rendered.zh) > MAX_PHRASE_SYLLABLES) continue
    for (const lb of new Set(rendered.words)) {
      const word = curriculum.words.get(lb)
      if (!rendered.words.every(other => curriculum.words.get(other).index <= word.index)) continue
      const list = found.get(lb) ?? []
      if (!list.some(item => item.zh === rendered.zh)) list.push(rendered)
      found.set(lb, list)
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

/** The forms a phrase for this word may use: every word introduced by its lesson, the word's own characters and the function characters. */
export function allowedFor(curriculum, word) {
  const forms = new Map()
  for (const other of curriculum.ordered) {
    if (other.index > word.index) break
    if (!forms.has(other.ch)) forms.set(other.ch, other.lb)
  }
  const extra = new Set(Array.from(FUNCTION_CHARACTERS))
  for (const char of word.ch) extra.add(char)
  return { forms, segmenter: createSegmenter([...forms.keys(), ...extra]) }
}

/** A phrase from the writer as a bank entry, or the reason it was refused. Code, not the model, decides what counts as allowed vocabulary. */
export function validatePhrase(curriculum, word, raw, allowed = allowedFor(curriculum, word)) {
  if (!raw || typeof raw !== 'object') return { reason: 'not an object' }
  const { zh, py, en } = raw
  if (typeof zh !== 'string' || typeof py !== 'string' || typeof en !== 'string') return { reason: 'missing zh, py or en' }
  const text = zh.trim(), pinyin = py.trim(), english = en.trim()
  if (!HAN.test(text) || !pinyin || !english) return { reason: 'empty text' }
  if (HAN.test(english) || HAN.test(pinyin)) return { reason: 'Chinese in pinyin or English' }
  if (!text.includes(word.ch)) return { reason: 'does not contain the word' }
  if (hanCount(text) > MAX_PHRASE_SYLLABLES) return { reason: 'too long' }
  if (!allowed.segmenter.covers(text)) return { reason: 'uses a word not yet learned' }
  const words = []
  for (const form of allowed.segment ? allowed.segment(text) : allowed.segmenter.segment(text)) { const lb = allowed.forms.get(form); if (lb && !words.includes(lb)) words.push(lb) }
  if (!words.includes(word.lb)) words.unshift(word.lb)
  return { phrase: { zh: text, py: pinyin, en: english, words, source: 'ai', checked: false } }
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

/** The vocabulary shown to the models for a batch: what is learned by the batch's first word, latest first, capped. */
export function allowedPrompt(curriculum, firstWord, cap = 250) {
  return curriculum.ordered.filter(word => word.index <= firstWord.index).slice(-cap).map(wordLine)
}

const planPrompt = (entries, prompt) => 'For each word write ' + 'one short spec per phrase still needed: a different everyday situation, sentence pattern or grammar point to vary, so the word\'s phrases differ from each other and from its existing ones. A spec is a few words, e.g. "asking a question about a place". ' +
  'Return {"plans":[{"ref","specs":["..."]}]} with the ref copied from the word, and exactly "need" specs each.\n' + JSON.stringify({ words: entries.map(entry => ({ ref: entry.word.lb, form: entry.word.ch, pinyin: entry.word.pr, meaning: gloss(entry.word), need: entry.need, existing: entry.existing })), vocabulary: prompt })
const writePrompt = (entries, prompt, extra = '') => 'Write phrases for each word, one per spec (or ' + 'one per needed slot when there is no spec). Each Chinese phrase is a short sentence or clause of at most ' + MAX_PHRASE_SYLLABLES + ' syllables that contains the word\'s form. Every Chinese word must come from "vocabulary", the word itself or the basic function characters ' + FUNCTION_CHARACTERS + '. No other words. ' + extra +
  'Return {"phrases":[{"ref","zh","py","en"}]} with the ref copied from the word.\n' + JSON.stringify({ words: entries.map(entry => ({ ref: entry.word.lb, form: entry.word.ch, pinyin: entry.word.pr, meaning: gloss(entry.word), specs: entry.specs, existing: entry.existing, ...(entry.fix ? { rewrite: entry.fix } : {}) })), vocabulary: prompt })
const checkPrompt = (items, prompt) => 'Review each practice phrase. For each, answer: natural (the Chinese is natural, correct and something a native speaker would say), matches (the English is a faithful translation of the Chinese), allowed (every Chinese word is in the vocabulary list, the phrase\'s own word, or the basic function characters ' + FUNCTION_CHARACTERS + '), and a short reason when any is false. ' +
  'Return {"results":[{"id","natural","matches","allowed","reason"}]}.\n' + JSON.stringify({ phrases: items.map(item => ({ id: item.id, zh: item.zh, en: item.en, word: item.form })), vocabulary: prompt })

// ---------------------------------------------------------------- pipeline

const chunks = (list, size) => { const out = []; for (let at = 0; at < list.length; at += size) out.push(list.slice(at, at + size)); return out }
const idOf = (lb, zh) => lb + '|' + zh

/** Judges a batch in one call: id => { ok, reason }. Throws when the call or its reply fails. */
async function checkBatch(io, curriculum, items) {
  const first = items.reduce((min, item) => item.word.index < min.index ? item.word : min, items[0].word)
  const reply = parseJSONReply(await io.check(SYSTEM, checkPrompt(items.map(item => ({ id: item.id, zh: item.phrase.zh, en: item.phrase.en, form: item.word.ch })), allowedPrompt(curriculum, first))))
  const verdicts = new Map()
  for (const row of Array.isArray(reply?.results) ? reply.results : []) if (typeof row?.id === 'string') verdicts.set(row.id, { ok: row.natural === true && row.matches === true && row.allowed !== false, reason: String(row.reason ?? '').slice(0, 200) || 'failed the check' })
  return verdicts
}

/** One batch of words through plan, write, validate, check and one rewrite. Returns the new phrases per word and notes for the log. */
export async function processBatch({ curriculum, entries, io, options, log = () => {} }) {
  const prompt = allowedPrompt(curriculum, entries[0].word)
  const result = new Map(entries.map(entry => [entry.word.lb, { phrases: [], note: '' }]))
  // plan (optional: a failed or skipped plan leaves the writer with its fixed prompt)
  if (io.plan && !options.noPlan) {
    try {
      const plans = parseJSONReply(await io.plan(SYSTEM, planPrompt(entries, prompt))).plans
      for (const row of Array.isArray(plans) ? plans : []) { const entry = entries.find(item => item.word.lb === row?.ref); if (entry && Array.isArray(row.specs)) entry.specs = row.specs.filter(spec => typeof spec === 'string').slice(0, entry.need) }
    } catch (reason) { log('plan failed, writing without specs: ' + reason.message) }
  }
  const validate = (rows, accept) => {
    const out = []
    for (const row of Array.isArray(rows) ? rows : []) {
      const entry = entries.find(item => item.word.lb === row?.ref)
      if (!entry) continue
      const taken = new Set([...entry.existingZh, ...result.get(entry.word.lb).phrases.map(p => p.zh), ...out.filter(o => o.entry === entry).map(o => o.phrase.zh)])
      const checked = validatePhrase(curriculum, entry.word, row, entry.allowed)
      if (!checked.phrase) { log(entry.word.ch + ': ' + checked.reason + ' (' + String(row?.zh).slice(0, 20) + ')'); continue }
      if (taken.has(checked.phrase.zh) || !accept(entry)) continue
      out.push({ entry, phrase: checked.phrase })
    }
    return out
  }
  let written
  try { written = validate(parseJSONReply(await io.write(SYSTEM, writePrompt(entries, prompt))).phrases, () => true) } catch (reason) {
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
    else if (verdict.ok) result.get(item.entry.word.lb).phrases.push({ ...item.phrase, checked: true })
    else failed.push({ ...item, reason: verdict.reason })
  }
  if (failed.length) {
    // rewritten once, in one batch, and checked again; whatever still fails is dropped
    const rewriteEntries = [...new Set(failed.map(item => item.entry))].map(entry => ({ ...entry, specs: failed.filter(item => item.entry === entry).map(item => 'replace "' + item.phrase.zh + '" (' + item.reason + ')'), fix: failed.filter(item => item.entry === entry).map(item => ({ zh: item.phrase.zh, problem: item.reason })), need: failed.filter(item => item.entry === entry).length }))
    try {
      const again = validate(parseJSONReply(await io.write(SYSTEM, writePrompt(rewriteEntries, prompt, 'Each word lists phrases that failed review under "rewrite"; write a better replacement for each. '))).phrases, () => true)
        .map(item => ({ ...item, entry: entries.find(entry => entry.word.lb === item.entry.word.lb), word: item.entry.word, id: idOf(item.entry.word.lb, item.phrase.zh) }))
      const limited = again.filter(item => !failed.some(old => old.id === item.id)).slice(0, failed.length)
      let second = new Map()
      try { second = limited.length ? await checkBatch(io, curriculum, limited) : second } catch (reason) {
        log('second check failed, keeping rewrites unchecked: ' + reason.message)
        for (const item of limited) result.get(item.entry.word.lb).phrases.push({ ...item.phrase, checked: false })
        return result
      }
      for (const item of limited) if (second.get(item.id)?.ok) result.get(item.entry.word.lb).phrases.push({ ...item.phrase, checked: true })
      else log(item.entry.word.ch + ': dropped after rewrite (' + (second.get(item.id)?.reason ?? 'no verdict') + ')')
    } catch (reason) { log('rewrite failed, dropping ' + failed.length + ' phrases: ' + reason.message) }
  }
  return result
}

/** Phrases kept unchecked, judged again in one batch per --batch-size. */
export async function recheck({ curriculum, state, io, options, log = () => {}, save = () => {} }) {
  const pending = []
  for (const [lb, record] of Object.entries(state.words)) { const word = curriculum.words.get(lb); if (word) for (const phrase of record.phrases) if (!phrase.checked) pending.push({ word, phrase, id: idOf(lb, phrase.zh) }) }
  for (const batch of chunks(pending, options.batchSize)) {
    try {
      const verdicts = await checkBatch(io, curriculum, batch)
      for (const item of batch) {
        const verdict = verdicts.get(item.id)
        if (!verdict) continue
        const record = state.words[item.word.lb]
        if (verdict.ok) item.phrase.checked = true
        else record.phrases = record.phrases.filter(phrase => phrase !== item.phrase)
      }
      save()
    } catch (reason) { log('recheck failed: ' + reason.message) }
  }
}

export const emptyState = () => ({ version: 1, words: {} })

/** Which words need phrases now, in teaching order: code decides from the catalog counts and the state. */
export function selectWords({ curriculum, state, options }) {
  const fitted = catalogPhrases(curriculum)
  const bands = options.bands?.length ? new Set(options.bands) : undefined
  const only = options.words?.length ? new Set(options.words) : undefined
  const entries = []
  for (const word of curriculum.ordered) {
    if (bands && !bands.has(word.band)) continue
    if (only && !only.has(word.lb)) continue
    const record = state.words[word.lb]
    if (record?.status === 'done') continue
    if (record && !options.retry && !only) continue
    const existing = fitted.get(word.lb) ?? []
    const have = existing.length + (record?.phrases.length ?? 0)
    const need = options.target - have
    if (need <= 0) { continue }
    entries.push({ word, need, existing: existing.slice(0, 3).map(item => item.zh), existingZh: [...existing.map(item => item.zh), ...(record?.phrases.map(p => p.zh) ?? [])], specs: [], allowed: undefined, catalogCount: existing.length })
  }
  return options.limit ? entries.slice(0, options.limit) : entries
}

export async function runPipeline({ curriculum, state, io, options, log = () => {}, save = () => {} }) {
  const chosen = selectWords({ curriculum, state, options })
  // words that already have enough (catalog) are recorded as done so a re-run skips them without recomputing
  const batches = chunks(chosen, options.batchSize)
  log(chosen.length + ' words need phrases, in ' + batches.length + ' batches')
  for (const [at, entries] of batches.entries()) {
    for (const entry of entries) entry.allowed = allowedFor(curriculum, entry.word)
    const result = await processBatch({ curriculum, entries, io, options, log })
    for (const entry of entries) {
      const outcome = result.get(entry.word.lb)
      const record = state.words[entry.word.lb] ?? { status: 'failed', phrases: [], attempts: 0 }
      record.phrases = [...record.phrases, ...outcome.phrases]
      record.attempts += 1
      const total = entry.catalogCount + record.phrases.length
      record.status = total >= options.target ? 'done' : record.phrases.length ? 'partial' : 'failed'
      if (outcome.note) record.note = outcome.note; else delete record.note
      state.words[entry.word.lb] = record
    }
    save()
    log('batch ' + (at + 1) + '/' + batches.length + ' saved')
  }
  return state
}

// ---------------------------------------------------------------- output

/** The shipped files: one per band of the word, phrases by the word's catalog label, in teaching order. */
export function buildOutputs(curriculum, state, generated = {}) {
  const outputs = {}
  for (const band of BANDS) outputs[band] = { schemaVersion: 1, band, ...generated, phrases: {} }
  for (const word of curriculum.ordered) {
    const record = state.words[word.lb]
    if (!record?.phrases.length) continue
    outputs[word.band].phrases[word.lb] = record.phrases.map(phrase => ({ zh: phrase.zh, py: phrase.py, en: phrase.en, words: phrase.words, source: phrase.source, checked: phrase.checked }))
  }
  return outputs
}

function writeAtomic(file, text) { mkdirSync(dirname(file), { recursive: true }); const temp = file + '.tmp'; writeFileSync(temp, text); renameSync(temp, file) }
export function writeOutputs(outDir, outputs) { for (const [band, data] of Object.entries(outputs)) writeAtomic(join(outDir, 'hsk-' + band + '.json'), JSON.stringify(data) + '\n') }
export function loadState(file) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : emptyState() }
export function saveState(file, state) { writeAtomic(file, JSON.stringify(state, null, 1) + '\n') }

// ---------------------------------------------------------------- command line

export function parseArgs(argv, env = process.env) {
  const flags = new Map()
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (!arg.startsWith('--')) throw new Error('Unexpected argument: ' + arg)
    const [name, inline] = arg.slice(2).split(/=(.*)/s)
    const boolean = ['report', 'retry', 'recheck', 'no-plan', 'dry-run', 'help'].includes(name)
    flags.set(name, boolean ? true : inline ?? argv[++at])
  }
  const get = (name, envName, fallback) => flags.get(name) ?? env[envName] ?? fallback
  const list = value => value ? String(value).split(',').map(item => item.trim()).filter(Boolean) : undefined
  const model = role => get(role + '-model', 'PHRASE_' + role.toUpperCase() + '_MODEL')
  return {
    report: flags.has('report'), help: flags.has('help'), dryRun: flags.has('dry-run'), retry: flags.has('retry'), recheck: flags.has('recheck'), noPlan: flags.has('no-plan'),
    baseUrl: get('base-url', 'PHRASE_BASE_URL'), apiKey: env[get('api-key-env', 'PHRASE_API_KEY_ENV', 'PHRASE_API_KEY')],
    roles: {
      planner: { model: model('planner'), api: get('planner-api', 'PHRASE_PLANNER_API', 'chat') },
      writer: { model: model('writer'), api: get('writer-api', 'PHRASE_WRITER_API', 'chat') },
      checker: { model: model('checker') ?? model('planner'), api: get('checker-api', 'PHRASE_CHECKER_API', get('planner-api', 'PHRASE_PLANNER_API', 'chat')) },
    },
    target: Number(get('target', 'PHRASE_TARGET', DEFAULT_TARGET)), batchSize: Number(get('batch-size', 'PHRASE_BATCH_SIZE', 20)),
    bands: list(flags.get('band')), words: list(flags.get('words')), limit: flags.has('limit') ? Number(flags.get('limit')) : undefined,
    out: resolve(get('out', 'PHRASE_OUT', join(root, 'src', 'data', 'phrases'))), state: resolve(get('state', 'PHRASE_STATE', join(root, 'build', 'phrase-bank', 'state.json'))),
    dataDir: resolve(get('data-dir', 'PHRASE_DATA_DIR', join(root, 'src', 'data', 'v2'))),
  }
}

export function createIO(options, fetchImpl) {
  const make = role => createCaller({ baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.roles[role].model, api: options.roles[role].api, ...(fetchImpl ? { fetchImpl, sleep: async () => {} } : {}) })
  return { plan: options.noPlan || !options.roles.planner.model ? undefined : make('planner'), write: make('writer'), check: make('checker') }
}

export async function main(argv = process.argv.slice(2), { fetchImpl, log = console.log } = {}) {
  const options = parseArgs(argv)
  if (options.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')); return }
  const curriculum = buildCurriculum(readCatalog(options.dataDir))
  if (options.report) { log(JSON.stringify(coverageReport(curriculum), null, 1)); return }
  const state = loadState(options.state)
  if (options.dryRun) {
    const chosen = selectWords({ curriculum, state, options })
    log(chosen.length + ' words would get phrases; first: ' + chosen.slice(0, 5).map(entry => entry.word.ch + ' (' + entry.need + ')').join(', '))
    return
  }
  if (!options.baseUrl || !options.roles.writer.model || !options.roles.checker.model) throw new Error('Give --base-url and the --writer-model and --planner-model (or --checker-model); see the header of this script.')
  const io = createIO(options, fetchImpl)
  const save = () => { saveState(options.state, state); writeOutputs(options.out, buildOutputs(curriculum, state, {})) }
  if (options.recheck) await recheck({ curriculum, state, io, options, log, save })
  await runPipeline({ curriculum, state, io, options, log, save })
  save()
  const counts = { done: 0, partial: 0, failed: 0 }
  for (const record of Object.values(state.words)) counts[record.status]++
  log('done ' + counts.done + ', partial ' + counts.partial + ', failed ' + counts.failed + ' (re-run with --retry for the last two)')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exitCode = 1 })
