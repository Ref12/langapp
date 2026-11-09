// Builds the parallel Japanese and Korean lessons: for each Chinese lesson N (a v2 group of src/data/v2/hsk-1.generated.json, 87 for HSK 1; --lessons counts groups) a lesson N in each
// language that teaches what the group teaches the way a beginner course in that language would. Data only; the app UI comes later. Files: scripts/parallel-lessons-files.mjs.
//
// Per language, for each batch of --lesson-span consecutive lessons, in order:
//   1. LESSON. The writer gets the whole group (every vocabulary sense it introduces, its grammar, its authored examples and readable phrases with English; no title or goals exist, the purpose is read from them) and writes the target
//      lesson: items (words and expressions such as こんにちは) and a mapping of every Chinese sense to word | covered-by (an item that carries it) | no-equivalent (reason).
//      Items the Chinese lesson did not have but the goal needs are marked extra. Code checks the format (reading = hiragana only, Hangul only for Korean); the checker judges
//      naturalness against beginner polite style; a rejected item is rewritten with the reason (up to 2 rewrites), then dropped with a note.
//   2. MATCH. Code matches each item to an imported JLPT/TOPIK entry by form+reading, by reading alone for words JMdict says are usually written in kana, or by a shorter base
//      form (ありがとう for ありがとうございます); the checker only picks among several candidates. A miss becomes a new entry in curriculum/<language>/parallel/entries.yaml.
//   3. PHRASES AND GRAMMAR. The writer writes ordinary lines a learner says or hears in the lesson's situations, with tokens carrying word ids and grammar ids, using only items
//      taught in lessons 1..N and grammar from the catalogue or new points it defines. Duplicates are dropped; rejected lines are rewritten with the reason (up to 2 rewrites).
//   4. TOP-UP (after all batches, --target, default 2): words with fewer strict phrases than the target get more phrases under the same rules.
// A phrase in lesson N is strict when every word and grammar point it uses is taught in lessons 1..N. A lesson already in zh-lessons.yaml is skipped (--retry redoes partial ones);
// the files are written after every batch. A malformed reply is repaired or asked for again (2 times); then the batch is left for the next run and the run continues.
//
//   node scripts/build-parallel-lessons.mjs --report [--write]             (counts, strict phrases per lesson, meanings without one, writing coverage)
//   --dump-replies DIR  writes every unparseable or partial model reply in full to DIR
//   node scripts/build-parallel-lessons.mjs --dry-run --lessons 1          (prints the exact writer prompt of the first lesson to write, per language)
//   node scripts/build-parallel-lessons.mjs --base-url http://localhost:5210/v1 --writer-model gpt-6-luna --writer-api responses \
//       --checker-model DeepSeek-V4.1-Flash --checker-api chat --language both --lessons 1-3 --concurrency 8
//   node scripts/build-parallel-lessons.mjs --characters                   (writing data for every character the lessons use: missing kanji, composed syllables)
//   Options: --language ja|ko|both (default both), --lessons 1-50, --base-url URL (env PHRASE_API_BASE or PHRASE_BASE_URL), --api-key-env NAME (default PHRASE_API_KEY),
//            --writer-model/--writer-api responses|chat, --checker-model/--checker-api, --concurrency 8 (checker calls in flight; the languages run side by side),
//            --session-id ID (env PHRASE_SESSION_ID; sent as x-session-id), --lesson-span 3 (lessons per writer call), --batch-size 20 (items per checker call),
//            --max-tokens 16000 (sent as max_tokens / max_output_tokens: some chat gateways need it, e.g. claude-sonnet-5.5 via --checker-api chat), --target 2 (strict phrases per word for the top-up), --max-phrases 8 (Chinese source phrases per lesson), --rewrites 2, --no-top-up, --retry, --root DIR
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'yaml'
import { createCaller, createThrottleLog, parseJSONReply, parseLessons, runBatches } from './build-phrase-bank.mjs'
import {
  PARALLEL_SOURCE, entryIndex, hira, languageOf, loadChineseLessons, loadReferences, matchKey, readParallel, readStrokeIndex,
  refreshReadability, reportFile, root as defaultRoot, strictReport, taughtLessons, usedCharacters, writeAtomic, writeParallel, writingCoverage,
} from './parallel-lessons-files.mjs'

const DEFAULTS = { lessonSpan: 3, batchSize: 20, target: 2, maxPhrases: 8, concurrency: 8, rewrites: 2 }
const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u
const LATIN = /[A-Za-z0-9]/
const PUNCTUATION = /^[\p{P}\p{S}\s]+$/u
const clone = value => JSON.parse(JSON.stringify(value))
const gloss = text => String(text ?? '').split(/[;；|]/)[0].replace(/^\d+\.\s*/, '').trim()

// ---------------------------------------------------------------- prompts

const REGISTER = {
  ja: ' REGISTER: polite です/ます style. Do not overuse あなた: drop the subject where natural Japanese does (use the name + さん, or nothing); あなた is for when "you" must be explicit.',
  ko: ' REGISTER: 해요체 throughout (polite informal); no 반말 and no 합쇼체 unless the lesson is about it. Never use 너 in a polite sentence: "you" is normally dropped, or use the name + 씨 or 선생님.',
}
const systemFor = (code, task) => 'You build ' + languageOf(code).name + ' practice material that runs alongside a Mandarin course for an English-speaking beginner. '
  + (task === 'check' ? 'You are a strict but fair native-speaker reviewer of natural beginner ' + languageOf(code).name + ': judge naturalness, meaning, reading and tags, and never reject a good alternative only because it differs from a suggested default. '
    : 'Write the way a beginner course in ' + languageOf(code).name + ' would, not word-for-word translation. ')
  + 'Use ' + languageOf(code).style + ' by default.' + REGISTER[code] + ' Reply with JSON only.'
const ask = (instructions, input) => instructions + '\nINPUT:\n' + JSON.stringify(input)

const FORMAT_RULES = {
  ja: 'FORMAT (checked by code): "form" is the Japanese written form as normally written (words that are normally written in kana are given in kana, for example あなた, ありがとう, こんにちは); "reading" is the whole reading in hiragana only: no romaji, no spaces, no katakana, no brackets.',
  ko: 'FORMAT (checked by code): "form" is written in Hangul only (no Latin letters, digits or Hanja in the form); leave "reading" empty; give "hanja" only for a Sino-Korean word that is normally written in Hanja.',
}

const EXAMPLES = {
  ja: 'Example, for a lesson about meeting someone: はじめまして, 私は〜です, 名前, 学生, わかりません, こんにちは. 好 in 你好 is carried by the item こんにちは; 是 is carried by the grammar point です.',
  ko: 'Example, for a lesson about meeting someone: 처음 뵙겠습니다, 저는 〜예요/이에요, 이름, 학생, 모르겠어요, 안녕하세요. 好 in 你好 is carried by the item 안녕하세요; 是 is carried by the grammar point 이에요/예요.',
}
const LESSON_RULES = 'Write the target-language lesson that teaches what this Chinese lesson (group) teaches. The group has no title or goals: work out its situation and communicative purpose from its senses, grammar and the Chinese examples with their English, and write the lesson a beginner course in that language would teach for that purpose. '
  + 'Think of what a learner needs to say and understand there, not of the Chinese words one by one. '
  + 'VOCABULARY: give "items": only real lexical items (nouns, verbs, adjectives, pronouns, fixed expressions such as greetings and thanks, kind "expression"); each with a "key" (k1, k2, ...), form, reading, gloss (short English), pos, kind "word" or "expression". '
  + 'Particles, copulas, verb endings and negation are GRAMMAR, never items (Japanese: は が を か です ではありません ます ません ない; Korean: 은/는 이/가 을/를 이에요/예요 -어요/-아요 안 아니다). '
  + 'GRAMMAR: give "grammar": the grammar points the lesson teaches, each as {"key":"g1","id":"<id from grammar_catalogue when one fits, else empty>","pattern":"","english":"","note":""}; a new point (no catalogue id) needs pattern and english. '
  + 'SENSES: one row for EVERY Chinese sense of the lesson, with status "word" (an item is its natural word: give "item" = key), "covered-by" (an item carries the meaning, as the example below shows: give "item" = key), "grammar" (the sense is carried by a grammar point, for example 是 by the copula: give "grammar" = the grammar key), '
  + 'or "no-equivalent" (only when the language really lacks it, like a measure word; give a one-line "note" with the reason). Never use no-equivalent just because the Chinese sense is a particle or part of a greeting. '
  + 'ALREADY TAUGHT: "known_items" lists the items earlier lessons taught (lessons in this call are in order: an item an earlier lesson of this call lists is known to the later ones). Do not list them as items again; when a sense of this lesson is carried by one of them, give "item" = its id. A lesson introduces only what is new. '
  + 'EXTRAS: an item the Chinese lesson did not have is allowed ONLY when the lesson\'s own Chinese examples cannot be said in the language without it, at most 2 per lesson, marked "extra": true and left out of the senses. Do not add extra vocabulary, greetings or negation "because a learner might want it". '
  + 'Use plain dictionary forms for verbs and adjectives, and the polite style for expressions. Do not invent words: only everyday beginner language.'
const LESSON_REPLY = ' Reply {"lessons":[{"lesson":N,"items":[{"key":"k1","form":"","reading":"","gloss":"","pos":"","kind":"word","hanja":"","extra":false}],"grammar":[{"key":"g1","id":"","pattern":"","english":"","note":""}],"senses":[{"sense":"<sense id>","status":"word|covered-by|grammar|no-equivalent","item":"k1 or a known id","grammar":"g1","note":""}]}]}.'

export const lessonPrompt = (code, lessons, feedback, context = {}) => ask('TASK lesson. ' + LESSON_RULES + ' ' + EXAMPLES[code] + ' ' + FORMAT_RULES[code] + LESSON_REPLY + (feedback ? ' Some items or senses were rejected: write only those again (same lesson number, the same item key; give corrected "senses" rows only when a row must change), fixing the reasons given.' : ''), {
  lessons: lessons.map(lesson => ({
    lesson: lesson.number,
    senses: lesson.words.map(word => ({ sense: word.id, zh: word.ch, pinyin: word.pr, english: word.ds })),
    grammar_zh: lesson.grammar.map(point => ({ zh: point.ch, meaning: point.ds })),
    zh_examples: lesson.phrases.map(phrase => ({ zh: phrase.zh, en: phrase.en })),
  })),
  known_items: context.known ?? [], grammar_catalogue: context.catalogue ?? [],
  ...(feedback ? { rejected: feedback } : {}),
})

const QUALITY = 'QUALITY: write ordinary things a learner would say or hear in the lesson\'s situations. No meta sentences about words or names (not "It\'s a name called X"), no bare fragments unless they are a natural reply, and then the English gives the context, '
  + 'for example "(Answering \'What\'s this?\') It\'s a name." No two phrases with the same text. No contrived lines made only to use a word.'
const PHRASE_RULES = 'Write the target-language version of each Chinese phrase: natural, not word for word, with the same meaning as the English. Give "text" with its "reading" (Japanese: hiragana of the whole phrase; Korean: leave empty), the English, and "tokens" '
  + 'that split the text exactly (concatenating the token texts gives the text; Korean tokens may be separated by spaces). Every token is {"t":surface,"w":word id} for a lexical item (inflected forms use the dictionary entry), {"t":surface,"g":grammar id} for every particle, copula, ending and negation (は を か です ます ません 은/는 이/가 이에요 -어요 안 아니다 ...: these are grammar, never word tokens), or a punctuation token, which is exactly {"t":"."} (the mark as "t", and NO other field, no bare string). Token texts carry no spaces. Example phrase: {"i":0,"text":"저는 학생이에요.","reading":"","en":"I am a student.","tokens":[{"t":"저","w":"ko-nikl-13297"},{"t":"는","g":"ko-topik1-g003"},{"t":"학생","w":"ko-nikl-24021"},{"t":"이에요","g":"ko-topik1-g001"},{"t":"."}],"grammar":["ko-topik1-g003","ko-topik1-g001"]}. '
  + 'Use only word ids from words (their lesson must not be later than the phrase lesson) and grammar ids from taught_grammar, from the catalogue, or new points you define in new_grammar with a "key" (refer to it as "new:<key>"; a new point is only for a pattern the catalogue lacks). '
  + 'List every grammar id the phrase uses in "grammar". Do not use any word or grammar point that is not given. ' + QUALITY + ' Reply {"lessons":[{"lesson":N,"new_grammar":[{"key":"","pattern":"","english":"","note":""}],"phrases":[{"i":<index of the Chinese phrase>,"text":"","reading":"","en":"","tokens":[],"grammar":[]}]}]}.'
export const phrasesPrompt = (code, request, feedback) => ask('TASK phrases. ' + PHRASE_RULES + ' ' + FORMAT_RULES[code].replace('"form" is', 'text is') + (feedback ? ' Some phrases were rejected: write those again, fixing the reasons given, using the same i.' : ''), { ...request, ...(feedback ? { rejected: feedback } : {}) })

const TOPUP_RULES = 'TASK top-up. For each item write up to "need" more short natural phrases that use the word with the given entry id and ONLY words from "words" and grammar from "taught_grammar": everything there is taught by the item lesson and nothing else may appear (no negation, no question form, no other word unless it is listed). '
  + 'Same token format as before: {"t":surface,"w":word id} or {"t":surface,"g":grammar id} or punctuation. Do not define new grammar. Write nothing rather than a contrived line. ' + QUALITY + ' Reply {"items":[{"entry":"<id>","phrases":[{"text":"","reading":"","en":"","tokens":[],"grammar":[]}]}]}.'
export const topUpPrompt = request => ask(TOPUP_RULES, request)

const CHECK_RULES = 'Review each item as a native teacher of beginners: is it natural beginner language in polite style, does it mean what the English says, is the reading right, are the word and grammar tags right? です/ます and 해요체 are the default and the copula is a grammar point, not a reason to reject. '
  + 'Accept good alternatives to what the Chinese suggests. REJECT, with the correction in the reason: anything ungrammatical (for example Korean 저는 안 공부해요 should be 저는 공부 안 해요), nonsensical (for example 은이에요 meaning "it is silver" as a lesson line), a sentence a learner would never say or hear, '
  + 'unnatural, wrong or mistagged items, contrived lines, meta sentences about words or names, and fragments that are not a natural reply. Also reject register errors: Korean must be 해요체 and never use 너 in a polite sentence; Japanese should not repeat あなた where natural Japanese drops the subject. '
  + 'Particles, copulas, endings and negation are grammar: reject them as vocabulary items. Format (reading script, spaces) is checked elsewhere; do not judge it. '
  + 'Reply {"verdicts":[{"i":<index>,"ok":true|false,"reason":"short reason when rejected, saying what to write instead"}]} with one verdict per item.'
export const checkPrompt = (kind, items) => ask('TASK check-' + kind + '. ' + CHECK_RULES, { items })
export const resolvePrompt = items => ask('TASK resolve. Each item is a word with candidate dictionary entries that share its spelling or reading. Pick the entry whose sense matches the gloss, or null when none does. Reply {"choices":[{"i":<index>,"id":"<entry id or null>"}]}.', { items })

// ---------------------------------------------------------------- model calls

let replyDump
/** Writes every unparseable or partial reply in full to this folder (--dump-replies). */
export const setReplyDump = dir => { replyDump = dir || undefined }
let dumped = 0
const dumpReply = (what, text, why) => { if (!replyDump) return; try { mkdirSync(replyDump, { recursive: true }); writeFileSync(join(replyDump, String(++dumped).padStart(4, '0') + '-' + String(what || 'call').replace(/[^a-z0-9]+/gi, '-') + '.txt'), why + '\n\n' + text) } catch { /* debugging aid only */ } }
let replyLog = () => {}
/** Where a reply that had to be repaired, salvaged or re-asked is reported (the run's log). */
export const setReplyLog = fn => { replyLog = fn ?? (() => {}) }

/** Escapes a double quote inside a string value that is not followed by a JSON delimiter (models quote words inside the English or the Korean without escaping them). */
function escapeInnerQuotes(text) {
  let out = '', inString = false
  for (let at = 0; at < text.length; at++) {
    const ch = text[at]
    if (!inString) { out += ch; if (ch === '"') inString = true; continue }
    if (ch === '\\') { out += ch + (text[at + 1] ?? ''); at++; continue }
    if (ch !== '"') { out += ch; continue }
    const rest = text.slice(at + 1).match(/^\s*(.)/s)?.[1]
    if (rest === undefined || ',:}]'.includes(rest)) { out += ch; inString = false } else out += '\\"'
  }
  return out
}

/**
 * Reads a reply as JSON, repairing what models commonly get wrong (fences, prose around it, trailing commas, smart quotes around keys, unescaped quotes inside a string, a cut-off tail).
 * Returns { value, salvaged }: salvaged is true when only a prefix could be read (the rest was cut off or broken), so the caller can ask again instead of trusting it. Throws when nothing reads.
 */
export function repairJSON(text) {
  const plain = String(text).replace(/,\s*"(?:[^"\\]|\\.)*"\s*\}/g, '}').replace(/,\s*([}\]])/g, '$1')
  const attempts = [text, plain, escapeInnerQuotes(plain), String(text).replace(/[\u201c\u201d]/g, '"').replace(/,\s*([}\]])/g, '$1')]
  for (const candidate of attempts) { try { return { value: parseJSONReply(candidate), salvaged: false } } catch { /* next */ } }
  // a reply cut off or broken in the middle: close what is open at the last complete value
  for (const source of [plain, escapeInnerQuotes(plain)]) {
    const body = source.replace(/^[\s\S]*?(?=[{[])/, '')
    for (let end = body.length; end > 1; end = body.lastIndexOf('}', end - 2) + 1) {
      const head = body.slice(0, end).replace(/,\s*$/, '')
      const closers = []
      let inString = false, escaped = false
      for (const ch of head) {
        if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue }
        if (ch === '"') inString = true; else if (ch === '{') closers.push('}'); else if (ch === '[') closers.push(']'); else if (ch === '}' || ch === ']') closers.pop()
      }
      if (inString) continue
      try { return { value: JSON.parse(head + closers.reverse().join('')), salvaged: true } } catch { /* shorter */ }
    }
  }
  throw new Error('The reply is not JSON.')
}

/**
 * A call that must return JSON: repaired when possible; a reply that can only be salvaged in part (or not at all) is asked again up to "again" times with the error named;
 * the best salvage is used when every try was partial (what is missing then goes through the rewrite rounds); with nothing readable the batch is left to the next run (badReply).
 */
export async function callJSON(call, system, prompt, again = 2, what = '') {
  let last, best
  for (let attempt = 0; attempt <= again; attempt++) {
    // a failed call (endpoint down, HTTP error) is not a bad reply: it propagates
    const text = await call(system, attempt === 0 || !last ? prompt : prompt.replace('\nINPUT:\n', ' (Your previous reply was not valid JSON: ' + (last instanceof Error ? last.message : last) + ' Reply with one complete, valid JSON object only; escape any double quote inside a string.)\nINPUT:\n'))
    try {
      const result = repairJSON(text)
      if (!result.salvaged) { if (attempt) replyLog('reply to ' + (what || 'a call') + ' was read on try ' + (attempt + 1)); return result.value }
      best = result.value
      last = 'the reply was cut off or broken after ' + String(JSON.stringify(result.value).length) + ' characters.'
      dumpReply(what, text, 'partial: only the start could be read')
      replyLog('partial reply to ' + (what || 'a call') + ' (' + text.length + ' characters, only the start could be read): ' + text.slice(0, 160).replace(/\s+/g, ' '))
    } catch (reason) { last = reason; dumpReply(what, text, 'unreadable: ' + reason.message); replyLog('unreadable reply to ' + (what || 'a call') + ' (' + text.length + ' characters): ' + text.slice(0, 160).replace(/\s+/g, ' ')) }
  }
  if (best) return best
  throw Object.assign(new Error('No JSON reply: ' + (last instanceof Error ? last.message : last)), { badReply: true })
}

/** Items in chunks, up to concurrency chunk calls in flight (the phrase bank's runBatches); results come back in item order. */
export async function mapChunks(items, size, concurrency, run) {
  const chunks = []
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size).map((item, offset) => ({ item, word: { index: at + offset } })))
  const results = new Array(chunks.length)
  await runBatches({ batches: chunks, concurrency, span: 0, dispatch: chunk => run(chunk.map(entry => entry.item)), merge: (chunk, value, error) => { if (error) throw error; results[chunks.indexOf(chunk)] = value } })
  return results.flat()
}

/** Verdicts for items by the checker: {ok, reason}, or {unchecked:true} when the check call fails (the item is then kept, as the phrase bank keeps unchecked phrases). */
export async function checkItems({ io, code, kind, items, options }) {
  return mapChunks(items, options.batchSize, options.concurrency, async chunk => {
    try {
      const reply = await callJSON(io.check, systemFor(code, 'check'), checkPrompt(kind, chunk.map((item, i) => ({ i, ...item }))))
      const byIndex = new Map((reply.verdicts ?? []).map(verdict => [Number(verdict.i), verdict]))
      return chunk.map((_item, i) => byIndex.has(i) ? { ok: byIndex.get(i).ok === true, reason: String(byIndex.get(i).reason ?? '') } : { unchecked: true, ok: true })
    } catch { return chunk.map(() => ({ unchecked: true, ok: true })) }
  })
}

// ---------------------------------------------------------------- items (words and expressions)

/** Particles, copulas, verb endings and negation: grammar, not vocabulary. */
const GRAMMAR_FORMS = {
  ja: new Set('は が を に へ で と も の か や から まで より ね よ です でした ではありません じゃありません ます ました ません ませんでした ない なかった だ でしょう ましょう たい て た'.split(' ')),
  ko: new Set('은 는 이 가 을 를 에 에서 도 의 와 과 하고 이에요 예요 입니다 이다 이에요/예요 이/가 은/는 을/를 어요 아요 해요 어요/아요 -어요 -아요 -어요/아요 -ㅂ니다 -습니다 안 못 아니다 아니에요 이/가 아니에요 요 ㅂ니다 습니다'.split(' ')),
}
export const isGrammarForm = (code, form) => GRAMMAR_FORMS[code].has(String(form ?? '').replace(/[〜~\-\s]/g, ''))
const MAX_EXTRAS = 2

/** Moves items that are grammar (は, です, ませんでした, 은/는, 이에요, 안, 아니다 ...) out of the vocabulary into the lesson's grammar points, and drops extras beyond the cap. */
function tidyRecord(code, record) {
  for (const [key, item] of [...record.items]) {
    if (!isGrammarForm(code, item.form)) continue
    record.items.delete(key)
    const bare = String(item.form).replace(/[〜~\-\s]/g, '')
    const own = [...record.grammar.values()].find(point => String(point.pattern ?? '').replace(/[〜~\-\s]/g, '').includes(bare) || bare.includes(String(point.pattern ?? '').replace(/[〜~\-\s]/g, '')) && point.pattern)
    const gkey = own?.key ?? 'auto-' + key
    if (!own) record.grammar.set(gkey, { key: gkey, id: '', pattern: item.form, english: item.gloss, note: '' })
    for (const [id, sense] of record.senses) if (sense.item === key) record.senses.set(id, { status: 'grammar', item: '', grammar: gkey, note: sense.note })
  }
  const extras = [...record.items.values()].filter(item => item.extra)
  for (const item of extras.slice(MAX_EXTRAS)) record.items.delete(item.key)
}

/** Shape and script rules an item must meet before the checker sees it: code, not model judgement. */
export function itemProblem(code, item) {
  const form = String(item.form ?? '').trim()
  if (!form || !languageOf(code).script.test(form)) return 'form must be written in ' + languageOf(code).name + ' (' + (code === 'ja' ? 'kanji and kana' : 'Hangul') + ')'
  if (LATIN.test(form)) return 'form must not contain Latin letters or digits'
  if (/\s/.test(form) && code === 'ja') return 'form must not contain spaces'
  if (!String(item.gloss ?? '').trim()) return 'gloss (short English) is missing'
  if (code === 'ja') {
    const reading = String(item.reading ?? '').trim()
    if (!reading && !KANA.test(form)) return 'reading is missing: give the whole reading in hiragana'
    if (reading && !/^[\u3041-\u3096ー]+$/u.test(reading)) return 'reading must be hiragana only, without romaji, spaces, katakana or brackets'
  }
  return ''
}

export function normaliseItem(code, row) {
  const form = String(row?.form ?? '').trim()
  const reading = code === 'ja' ? (String(row?.reading ?? '').trim() || (/^[\u3041-\u3096ー]+$/u.test(form) ? form : '')) : ''
  return {
    key: String(row?.key ?? ''), form, reading, gloss: String(row?.gloss ?? '').trim(), pos: String(row?.pos ?? '').trim(), kind: row?.kind === 'expression' ? 'expression' : 'word',
    ...(code === 'ko' && row?.hanja ? { hanja: String(row.hanja).trim() } : {}), ...(row?.extra === true ? { extra: true } : {}),
  }
}

/** Candidate base forms of an expression the reference lists only in a shorter form (ありがとうございます -> ありがとう). */
const baseForms = (code, form) => code === 'ja' ? [form.replace(/(ございます|ございました)$/, '')].filter(base => base && base !== form) : []

/**
 * Code-first match against the references. A tie on form+reading is ambiguous (the checker picks); no hit on form+reading falls back, for Japanese, to the reading alone
 * when the reference says the word is usually written in kana (貴方 = あなた), then to a shorter base form of an expression; no hit at all is new.
 */
export function matchWord(code, references, row) {
  const pick = ids => !ids?.length ? undefined : ids.length === 1 ? { kind: 'match', id: ids[0] } : { kind: 'ambiguous', candidates: ids }
  const direct = pick(references.byKey.get(matchKey(code, row.form, row.reading)))
  if (direct) return direct
  if (code === 'ja') {
    const reading = hira(row.reading || row.form)
    const kana = pick(references.byKana?.get(reading))
    if (kana && /^[\u3041-\u3096ー]+$/u.test(row.form) ) return kana
    for (const base of baseForms(code, row.form)) {
      const found = pick(references.byKey.get(matchKey(code, base, hira(row.reading).replace(/(ございます|ございました)$/, '')))) ?? pick(references.byKana?.get(hira(base)))
      if (found) return found
    }
  }
  return { kind: 'new' }
}

async function resolveAmbiguous({ io, code, references, pending, options }) {
  return mapChunks(pending, options.batchSize, options.concurrency, async chunk => {
    try {
      const reply = await callJSON(io.check, systemFor(code, 'check'), resolvePrompt(chunk.map((entry, i) => ({ i, form: entry.item.form, reading: entry.item.reading, gloss: entry.item.gloss, candidates: entry.candidates.map(id => ({ id, english: references.vocabulary.get(id)?.english, pos: references.vocabulary.get(id)?.pos })) }))))
      const byIndex = new Map((reply.choices ?? []).map(choice => [Number(choice.i), choice.id]))
      return chunk.map((entry, i) => entry.candidates.includes(byIndex.get(i)) ? byIndex.get(i) : null)
    } catch { return chunk.map(() => null) }
  })
}

// ---------------------------------------------------------------- the lesson: items, senses, rewrites

/**
 * The target lesson for a batch of Chinese lessons. Returns { number: { items, senses } }: items matched ({entry} set when a reference entry matches), senses mapped to an item key.
 * Rejected items go back to the writer with the reason, up to options.rewrites times, then are dropped with a note.
 */
export async function produceLessons({ code, lessons, io, references, options, notes, known = [], catalogue = [] }) {
  const knownIds = new Set(known.map(item => item.id))
  const context = { known, catalogue }
  const state = new Map(lessons.map(lesson => [lesson.number, { items: new Map(), senses: new Map(), grammar: new Map() }]))
  const sensesOf = new Map(lessons.flatMap(lesson => lesson.words.map(word => [word.id, { lesson: lesson.number, word }])))
  const take = (reply, only) => {
    for (const entry of reply.lessons ?? []) {
      const record = state.get(Number(entry.lesson))
      if (!record) continue
      for (const row of entry.items ?? []) { const item = normaliseItem(code, row); if (item.key && (!only || only.has(entry.lesson + ':' + item.key) || !record.items.has(item.key))) record.items.set(item.key, item) }
      for (const row of entry.grammar ?? []) if (row?.key && (row.id || row.pattern)) record.grammar.set(String(row.key), { key: String(row.key), id: String(row.id ?? ''), pattern: String(row.pattern ?? '').trim(), english: String(row.english ?? '').trim(), note: String(row.note ?? '').trim() })
      for (const row of entry.senses ?? []) if (sensesOf.get(row?.sense)?.lesson === Number(entry.lesson) && (!only || only.has(entry.lesson + ':' + row.item) || only.has('sense:' + row.sense) || !record.senses.has(row.sense))) record.senses.set(row.sense, { status: String(row.status ?? ''), item: row.item ? String(row.item) : '', ...(row.grammar ? { grammar: String(row.grammar) } : {}), note: String(row.note ?? '').trim() })
    }
    for (const record of state.values()) tidyRecord(code, record)
  }
  take(await callJSON(io.write, systemFor(code, 'write'), lessonPrompt(code, lessons, undefined, context), 2, 'the lesson call'))
  const view = (lesson, item) => ({ lesson: lesson.number, form: item.form, reading: item.reading || undefined, gloss: item.gloss, pos: item.pos, kind: item.kind, carries: [...state.get(lesson.number).senses].filter(([, sense]) => sense.item === item.key).map(([id]) => sensesOf.get(id).word.ch + ' (' + sensesOf.get(id).word.ds + ')') })
  const judge = async keys => {
    const bad = new Map()
    const live = []
    for (const key of keys) { const [number, itemKey] = key.split(':'); const item = state.get(Number(number)).items.get(itemKey); const problem = itemProblem(code, item); if (problem) bad.set(key, problem); else live.push(key) }
    const verdicts = await checkItems({ io, code, kind: 'items', items: live.map(key => { const [number, itemKey] = key.split(':'); return view(lessons.find(l => l.number === Number(number)), state.get(Number(number)).items.get(itemKey)) }), options })
    live.forEach((key, at) => { if (!verdicts[at].ok) bad.set(key, verdicts[at].reason || 'rejected by the checker') })
    return bad
  }
  const allKeys = () => [...state].flatMap(([number, record]) => [...record.items.keys()].map(key => number + ':' + key))
  let bad = await judge(allKeys())
  for (let round = 0; round < options.rewrites && bad.size; round++) {
    const feedback = [...bad].map(([key, reason]) => { const [number, itemKey] = key.split(':'); const item = state.get(Number(number)).items.get(itemKey); return { lesson: Number(number), key: itemKey, previous: item.form + (item.reading ? ' (' + item.reading + ')' : ''), reason, carries: view(lessons.find(l => l.number === Number(number)), item).carries } })
    let again
    try { again = await callJSON(io.write, systemFor(code, 'write'), lessonPrompt(code, lessons.filter(lesson => feedback.some(row => row.lesson === lesson.number)), feedback, context), 2, 'a lesson rewrite') } catch (reason) { notes.push('(rewrite call failed: ' + reason.message + ')'); break }
    take(again, new Set([...bad.keys()]))
    bad = await judge([...bad.keys()].filter(key => { const [number, itemKey] = key.split(':'); return state.get(Number(number)).items.has(itemKey) }))
  }
  for (const [key, reason] of bad) {
    const [number, itemKey] = key.split(':')
    const record = state.get(Number(number))
    const item = record.items.get(itemKey)
    record.items.delete(itemKey)
    notes.push('item ' + item.form + ' (lesson ' + number + ') dropped after ' + options.rewrites + ' rewrites: ' + reason)
    for (const [id, sense] of record.senses) if (sense.item === itemKey) record.senses.set(id, { status: 'no-equivalent', item: '', note: 'its item was dropped: ' + reason })
  }
  // every sense gets a row; a mapping to an item or grammar point that does not exist is no-equivalent with a note
  for (const [id, { lesson }] of sensesOf) {
    const record = state.get(lesson)
    const row = record.senses.get(id)
    const validItem = row && (record.items.has(row.item) || knownIds.has(row.item))
    if (!row) record.senses.set(id, { status: 'no-equivalent', item: '', note: 'the writer gave no mapping for this sense' })
    else if (row.status === 'grammar') { if (!record.grammar.has(row.grammar)) record.senses.set(id, { status: 'no-equivalent', item: '', note: 'the writer named no valid grammar point for this sense' }) }
    else if (row.status !== 'no-equivalent' && !validItem) record.senses.set(id, { status: 'no-equivalent', item: '', note: row.note || 'the writer named no valid item for this sense' })
    else if (!['word', 'covered-by', 'no-equivalent'].includes(row.status)) record.senses.set(id, { ...row, status: 'word' })
    else if (row.status === 'no-equivalent' && !row.note) record.senses.set(id, { ...row, note: 'no reason given' })
  }
  // match: code first, the checker only for ties
  const pending = []
  for (const record of state.values()) for (const item of record.items.values()) {
    const found = matchWord(code, references, item)
    if (found.kind === 'match') item.entry = found.id
    else if (found.kind === 'ambiguous') pending.push({ item, candidates: found.candidates })
  }
  const choices = pending.length ? await resolveAmbiguous({ io, code, references, pending, options }) : []
  pending.forEach((entry, at) => { if (choices[at]) entry.item.entry = choices[at] })
  return Object.fromEntries([...state].map(([number, record]) => [number, { items: [...record.items.values()], grammar: [...record.grammar.values()], senses: lessons.find(lesson => lesson.number === Number(number)).words.map(word => ({ zh: word.id, ...record.senses.get(word.id) })) }]))
}

// ---------------------------------------------------------------- the book: entries and lessons in memory

export function createBook(code, { base = defaultRoot, references = loadReferences(code, base) } = {}) {
  const { entries, lessons } = readParallel(code, base)
  const book = { code, base, references, entries, lessons, notes: [] }
  book.index = () => entryIndex(references, book.entries)
  book.record = number => book.lessons.lessons.find(record => record.number === number)
  return book
}

const nextId = (book, kind) => {
  const prefix = languageOf(book.code).prefix + (kind === 'grammar' ? '-g' : '-')
  const used = (kind === 'grammar' ? book.entries.grammar : book.entries.vocabulary).map(entry => Number(entry.id.slice(prefix.length))).filter(Number.isFinite)
  return prefix + String(Math.max(0, ...used) + 1).padStart(kind === 'grammar' ? 3 : 5, '0')
}

/**
 * Gives each kept item its entry (the matched reference entry, an existing parallel entry for the same form+reading, or a new parallel-authored one) and returns the lesson's
 * words (one per entry, carrying the Chinese senses it covers) and senses (each mapped to an entry). Words that are normally written in kana are shown in kana.
 */
export function assignEntries(book, made, number = Infinity) {
  const earlier = new Set(book.lessons.lessons.filter(record => record.number < number).flatMap(record => record.words.map(word => word.entry)))
  const entryOf = new Map(), words = [], entryByKey = new Map()
  for (const item of made.items) {
    let entry = item.entry
    if (!entry) {
      const key = matchKey(book.code, item.form, item.reading)
      entry = book.entries.vocabulary.find(known => matchKey(book.code, known.target, known.reading) === key)?.id
      if (!entry) {
        const created = { id: nextId(book, 'vocabulary'), target: item.form, ...(item.reading ? { reading: item.reading } : {}), english: item.gloss, ...(item.pos ? { part_of_speech: item.pos } : {}), ...(item.hanja ? { hanja: item.hanja } : {}), source: PARALLEL_SOURCE }
        book.entries.vocabulary.push(created)
        entry = created.id
      }
    }
    entryByKey.set(item.key, entry)
    // a lesson introduces only what is new: an item an earlier lesson taught is just used (it keeps its first lesson)
    if (earlier.has(entry) || entryOf.has(entry)) continue
    entryOf.set(entry, words.length)
    const isNew = book.entries.vocabulary.some(known => known.id === entry)
    words.push({ entry, ...(isNew ? { new: true } : {}), status: item.kind, form: item.form, ...(item.reading ? { reading: item.reading } : {}), gloss: item.gloss, ...(item.pos ? { pos: item.pos } : {}), ...(item.hanja ? { hanja: item.hanja } : {}), ...(item.extra ? { extra: true } : {}), zh: [] })
  }
  // grammar points: a catalogue id, an entry with the same pattern, or a new parallel-authored entry
  const grammarByKey = new Map(), intro = []
  for (const point of made.grammar ?? []) {
    let id = point.id && book.index().grammar.has(point.id) ? point.id : ''
    if (!id && point.pattern) id = [...book.index().grammar.values()].find(entry => normPattern(entry.pattern) === normPattern(point.pattern))?.id ?? ''
    if (!id && point.pattern) {
      const entry = { id: nextId(book, 'grammar'), pattern: point.pattern, english: point.english, ...(point.note ? { note: point.note } : {}), source: PARALLEL_SOURCE }
      book.entries.grammar.push(entry)
      id = entry.id
    }
    if (id) { grammarByKey.set(point.key, id); if (!intro.includes(id)) intro.push(id) }
  }
  const taughtId = id => book.lessons.lessons.some(record => record.number < number && record.grammar_intro?.includes(id))
  const senses = made.senses.map(sense => {
    if (sense.status === 'no-equivalent') return { zh: sense.zh, status: 'no-equivalent', note: sense.note }
    if (sense.status === 'grammar') {
      const id = grammarByKey.get(sense.grammar)
      return id ? { zh: sense.zh, status: 'grammar', entry: null, grammar: id } : { zh: sense.zh, status: 'no-equivalent', note: 'the grammar point for this sense could not be resolved' }
    }
    const entry = entryByKey.get(sense.item) ?? sense.item
    const word = words[entryOf.get(entry)]
    if (word && !word.zh.includes(sense.zh)) word.zh.push(sense.zh)
    return { zh: sense.zh, status: sense.status, entry }
  })
  for (const word of words) if (!word.zh.length) delete word.zh
  return { words, senses, grammar_intro: intro.filter(id => !taughtId(id)) }
}

// ---------------------------------------------------------------- phrases

/** The text without spacing, and with full-width marks as plain ones: tokens and text are compared on this, so Korean word spacing and 。/. never matter. */
const flat = text => String(text ?? '').normalize('NFKC').replace(/。/g, '.').replace(/、/g, ',').replace(/\s+/g, '')

/**
 * Checks one candidate phrase. pool: { wordLesson: Map id -> lesson, grammarLesson: Map id -> lesson (taught before), catalogue: Set of grammar ids that exist, newKeys: Set }
 * limit: the lesson the phrase belongs to; words and taught grammar must be taught by then. Returns { problem } or { phrase }.
 */
/** Japanese is written with full-width marks: a writer's ASCII . ? ! , becomes 。？！、 in the text and its tokens. */
const JA_MARKS = { '.': '。', '?': '？', '!': '！', ',': '、' }
export const japaneseMarks = value => String(value ?? '').replace(/[.?!,]/g, mark => JA_MARKS[mark])
/** The key phrases are deduplicated on: spacing, full-width/half-width and punctuation never make two phrases different. */
export const sameTextKey = text => flat(text).replace(/[.?!,…~]/g, '')

export function validateCandidate(code, raw, limit, pool, { allowNew = true } = {}) {
  if (code === 'ja' && raw && typeof raw === 'object') raw = { ...raw, text: japaneseMarks(raw.text), tokens: Array.isArray(raw.tokens) ? raw.tokens.map(token => token && typeof token === 'object' ? { ...token, t: japaneseMarks(token.t) } : token) : raw.tokens }
  const text = String(raw?.text ?? '').trim()
  if (!text) return { problem: 'no text' }
  if (!languageOf(code).script.test(text)) return { problem: 'text is not written in ' + languageOf(code).name }
  if (LATIN.test(text)) return { problem: 'text contains Latin letters or digits' }
  if (!String(raw?.en ?? '').trim()) return { problem: 'no English' }
  if (!Array.isArray(raw.tokens) || !raw.tokens.length) return { problem: 'no tokens' }
  if (flat(raw.tokens.map(token => token?.t ?? '').join('')) !== flat(text)) return { problem: 'tokens do not add up to the text' }
  const tokens = [], words = new Set(), grammar = new Set()
  for (const token of raw.tokens) {
    const surface = String(token?.t ?? '').trim()
    if (!surface) { if (String(token?.t ?? '')) continue; return { problem: 'empty token' } }
    if (token.w && isGrammarForm(code, surface)) return { problem: 'token ' + surface + ' is grammar: tag it with a grammar id (g), not a word' }
    if (token.w) {
      const taught = pool.wordLesson.get(token.w)
      if (taught === undefined) return { problem: 'unknown word id ' + token.w }
      if (taught > limit) return { problem: 'word ' + token.w + ' is taught in lesson ' + taught + ', after lesson ' + limit }
      words.add(token.w); tokens.push({ t: surface, w: token.w })
    } else if (token.g) {
      const id = String(token.g)
      const problem = grammarProblem(id, limit, pool, allowNew)
      if (problem) return { problem }
      grammar.add(id); tokens.push({ t: surface, g: id })
    } else if (PUNCTUATION.test(surface)) tokens.push({ t: surface })
    else return { problem: 'token ' + surface + ' has no word or grammar id' }
  }
  for (const id of raw.grammar ?? []) {
    const problem = grammarProblem(String(id), limit, pool, allowNew)
    if (problem) return { problem }
    grammar.add(String(id))
  }
  if (!words.size) return { problem: 'uses no word entry' }
  const reading = code === 'ja' ? String(raw.reading ?? '').trim() : ''
  if (code === 'ja' && (!reading || !KANA.test(flat(reading).replace(/[\p{P}\p{S}]/gu, '')))) return { problem: 'reading must be hiragana' }
  return { phrase: { text, ...(reading ? { reading } : {}), en: String(raw.en).trim(), tokens, words: [...words], grammar: [...grammar] } }
}

function grammarProblem(id, limit, pool, allowNew) {
  if (id.startsWith('new:')) return allowNew && pool.newKeys.has(id.slice(4)) ? '' : 'unknown new grammar ' + id
  if (!pool.catalogue.has(id)) return 'unknown grammar id ' + id
  const taught = pool.grammarLesson.get(id)
  if (!allowNew && (taught === undefined || taught > limit)) return 'grammar ' + id + ' is not taught by lesson ' + limit
  return ''
}

/** Words taught by lesson limit (the committed records) and grammar taught up to it, for the prompt and the checks. */
function poolFor(book, limit) {
  const taught = taughtLessons(book.lessons.lessons.filter(record => record.number <= limit))
  return { wordLesson: taught.words, grammarLesson: taught.grammar, catalogue: new Set(book.index().grammar.keys()), newKeys: new Set() }
}

const catalogueOf = book => [...book.index().grammar.values()].map(entry => entry.id + ' ' + entry.pattern + ' — ' + entry.english)
const wordsOf = (book, wordLesson) => { const index = book.index().vocabulary; return [...wordLesson].map(([id, lesson]) => ({ id, form: index.get(id)?.target, reading: index.get(id)?.reading || undefined, english: gloss(index.get(id)?.english), lesson })) }
const taughtGrammarOf = (book, grammarLesson, limit) => { const index = book.index().grammar; return [...grammarLesson].filter(([, lesson]) => lesson <= limit).map(([id, lesson]) => ({ id, pattern: index.get(id)?.pattern, english: index.get(id)?.english, lesson })) }
const phraseView = (grammarIndex, phrase, source) => ({ zh: source?.zh, english: phrase.en, target: phrase.text, reading: phrase.reading, tokens: phrase.tokens.map(token => token.t + (token.w ? '=' + token.w : token.g ? '=' + token.g : '')).join(' '), grammar: phrase.grammar.map(id => id + ' ' + (grammarIndex.get(id)?.pattern ?? id)) })

const normPattern = text => String(text ?? '').replace(/[\s\u3000＋+]/g, '').toLowerCase()

/** Replaces new:<key> by a grammar id: an existing entry with the same pattern, or a new parallel-authored one. */
function finishPhrase(book, phrase, scope, extra) {
  const map = new Map()
  const resolve = id => {
    if (!id.startsWith('new:')) return id
    if (map.has(id)) return map.get(id)
    const point = scope.get(id.slice(4))
    const known = [...book.index().grammar.values()].find(entry => normPattern(entry.pattern) === normPattern(point.pattern))
    let result = known?.id
    if (!result) {
      const entry = { id: nextId(book, 'grammar'), pattern: String(point.pattern).trim(), english: String(point.english ?? '').trim(), ...(point.note ? { note: String(point.note).trim() } : {}), source: PARALLEL_SOURCE }
      book.entries.grammar.push(entry)
      result = entry.id
    }
    map.set(id, result)
    return result
  }
  return {
    text: phrase.text, ...(phrase.reading ? { reading: phrase.reading } : {}), en: phrase.en, ...(extra.zh ? { zh: extra.zh } : {}), ...(extra.zh_ref ? { zh_ref: extra.zh_ref } : {}),
    tokens: phrase.tokens.map(token => token.g ? { t: token.t, g: resolve(token.g) } : token), words: phrase.words, grammar: [...new Set(phrase.grammar.map(resolve))],
    source: 'ai', checked: extra.unchecked ? false : true,
  }
}

/**
 * Phrases for a batch of lessons (their words already in the book): written, validated, deduplicated by text, checked, rewritten with the reasons (up to options.rewrites
 * times), minted. Returns { number: [phrase] }; what is still rejected after the rewrites is dropped with a note.
 */
export async function producePhrases({ book, lessons, io, options, notes }) {
  const code = book.code
  const last = Math.max(...lessons.map(lesson => lesson.number))
  const base = poolFor(book, last)
  const before = poolFor(book, Math.min(...lessons.map(lesson => lesson.number)) - 1)
  const request = {
    words: wordsOf(book, base.wordLesson), taught_grammar: taughtGrammarOf(book, before.grammarLesson, Infinity), catalogue: catalogueOf(book),
    lessons: lessons.map(lesson => ({ lesson: lesson.number, new_words: book.record(lesson.number).words.map(word => word.entry), zh_phrases: lesson.phrases.map((phrase, i) => ({ i, zh: phrase.zh, en: phrase.en })), grammar_points_zh: lesson.grammar.map(point => ({ zh: point.ch, meaning: point.ds })) })),
  }
  const candidates = new Map()   // 'n:i' -> { raw, scope }
  const intake = (data, only) => {
    for (const entry of data.lessons ?? []) {
      const lesson = lessons.find(item => item.number === Number(entry.lesson))
      if (!lesson) continue
      const scope = new Map((entry.new_grammar ?? []).filter(point => point?.key && point.pattern).map(point => [String(point.key), point]))
      for (const raw of entry.phrases ?? []) {
        const i = Number(raw?.i)
        const key = lesson.number + ':' + i
        if (!Number.isInteger(i) || i < 0 || i >= lesson.phrases.length || (only && !only.has(key))) continue
        candidates.set(key, { raw, scope })
      }
    }
  }
  const sources = lessons.flatMap(lesson => lesson.phrases.map((source, i) => ({ key: lesson.number + ':' + i, lesson, source, i })))
  const validated = new Map()   // key -> { phrase, scope, unchecked } or { problem }
  const grammarIndex = book.index().grammar
  const seenText = new Set(book.lessons.lessons.filter(record => !lessons.some(lesson => lesson.number === record.number)).flatMap(record => record.phrases.map(phrase => sameTextKey(phrase.text))))
  const validate = keys => {
    for (const key of keys) {
      const entry = candidates.get(key)
      if (!entry) { validated.set(key, { problem: 'no phrase was written for it' }); continue }
      const result = validateCandidate(code, entry.raw, Number(key.split(':')[0]), { ...base, newKeys: new Set(entry.scope.keys()) })
      validated.set(key, result.phrase ? { phrase: result.phrase, scope: entry.scope } : { problem: result.problem })
    }
  }
  const judge = async keys => {
    const rejected = new Map()
    const live = keys.filter(key => validated.get(key)?.phrase)
    for (const key of keys) if (validated.get(key)?.problem) rejected.set(key, validated.get(key).problem)
    const items = live.map(key => { const entry = sources.find(item => item.key === key); const scope = validated.get(key).scope; const view = { get: id => id.startsWith('new:') ? { pattern: scope.get(id.slice(4))?.pattern ?? id } : (grammarIndex.get(id) ?? { pattern: id }) }; return phraseView(view, validated.get(key).phrase, entry.source) })
    const verdicts = await checkItems({ io, code, kind: 'phrases', items, options })
    live.forEach((key, at) => { if (!verdicts[at].ok) rejected.set(key, verdicts[at].reason || 'rejected by the checker'); else validated.get(key).unchecked = verdicts[at].unchecked === true })
    return rejected
  }
  intake(await callJSON(io.write, systemFor(code, 'write'), phrasesPrompt(code, request)))
  let todo = sources.map(item => item.key)
  validate(todo)
  let rejected = await judge(todo)
  for (let round = 0; round < options.rewrites && rejected.size; round++) {
    const feedback = [...rejected].map(([key, reason]) => { const item = sources.find(entry => entry.key === key); return { lesson: item.lesson.number, i: item.i, zh: item.source.zh, previous: candidates.get(key)?.raw?.text, reason } })
    const retry = new Set(rejected.keys())
    let again
    try { again = await callJSON(io.write, systemFor(code, 'write'), phrasesPrompt(code, { ...request, lessons: request.lessons.map(lesson => ({ ...lesson, zh_phrases: lesson.zh_phrases.filter(phrase => retry.has(lesson.lesson + ':' + phrase.i)) })).filter(lesson => lesson.zh_phrases.length) }, feedback)) } catch { break }
    for (const key of retry) { candidates.delete(key); validated.delete(key) }
    intake(again, retry)
    validate([...retry])
    rejected = await judge([...retry])
  }
  for (const [key, reason] of rejected) { validated.delete(key); const item = sources.find(entry => entry.key === key); notes.push('phrase ' + item.source.ref + ' (lesson ' + item.lesson.number + ') dropped after ' + options.rewrites + ' rewrites: ' + reason) }
  // mint, deduplicating by text across the book and the batch
  const out = {}
  for (const lesson of lessons) {
    out[lesson.number] = []
    for (const item of sources.filter(entry => entry.lesson === lesson)) {
      const entry = validated.get(item.key)
      if (!entry?.phrase) continue
      const text = sameTextKey(entry.phrase.text)
      if (seenText.has(text)) { notes.push('phrase ' + item.source.ref + ' (lesson ' + lesson.number + ') is a duplicate of ' + entry.phrase.text + ' and was dropped'); continue }
      seenText.add(text)
      out[lesson.number].push(finishPhrase(book, entry.phrase, entry.scope, { zh: item.source.zh, zh_ref: item.source.ref, unchecked: entry.unchecked }))
    }
  }
  return out
}

// ---------------------------------------------------------------- one language

const sourceLessons = (chinese, options) => chinese.lessons.filter(lesson => !options.lessons || (lesson.number >= options.lessons.from && lesson.number <= options.lessons.to))

/** Commits a batch: items and senses, then phrases, as one step; an error leaves the book as it was. */
/** Phase 1 for a batch: the target lessons' items and sense mapping (needs the earlier lessons' items, so batches run in order). */
export async function processItems({ book, lessons, io, options, log = () => {} }) {
  const snapshot = clone({ entries: book.entries, lessons: book.lessons })
  const notes = []
  try {
    const first = Math.min(...lessons.map(lesson => lesson.number))
    const index = book.index()
    const known = book.lessons.lessons.filter(record => record.number < first).flatMap(record => record.words.map(word => ({ id: word.entry, form: word.form, reading: word.reading || undefined, gloss: word.gloss, lesson: record.number })))
    const catalogue = [...index.grammar.values()].map(entry => ({ id: entry.id, pattern: entry.pattern, english: entry.english }))
    const made = await produceLessons({ code: book.code, lessons, io, references: book.references, options, notes, known, catalogue })
    for (const lesson of lessons) {
      const { words, senses, grammar_intro } = assignEntries(book, made[lesson.number], lesson.number)
      book.lessons.lessons = book.lessons.lessons.filter(record => record.number !== lesson.number)
      book.lessons.lessons.push({ number: lesson.number, lesson: lesson.id, status: 'partial', words, senses, grammar_intro, grammar_taught: [], phrases: [], ...(notes.some(note => note.includes('(lesson ' + lesson.number + ')')) ? { item_notes: notes.filter(note => note.includes('(lesson ' + lesson.number + ')')) } : {}) })
    }
    book.lessons.lessons.sort((a, b) => a.number - b.number)
    book.notes.push(...notes)
    log('items ' + lessons.map(lesson => lesson.number).join(',') + ' (' + book.code + '): ' + lessons.map(lesson => book.record(lesson.number).words.length).join('+') + ' new items')
  } catch (reason) {
    book.entries = snapshot.entries; book.lessons = snapshot.lessons
    throw reason
  }
}

/** Phase 2 for a batch: phrases (every lesson's items exist by then, so batches can run concurrently). */
export async function processPhrases({ book, lessons, io, options, log = () => {} }) {
  const notes = []
  const phrases = await producePhrases({ book, lessons, io, options, notes })
  for (const lesson of lessons) book.record(lesson.number).phrases = phrases[lesson.number].map(phrase => ({ id: ++book.lessons.last_phrase_id, ...phrase }))
  refreshReadability(book.lessons.lessons)
  for (const lesson of lessons) {
    const record = book.record(lesson.number)
    const mine = [...(record.item_notes ?? []), ...notes.filter(note => note.includes('(lesson ' + lesson.number + ')'))]
    delete record.item_notes
    record.status = mine.length || !record.phrases.length ? 'partial' : 'done'
    if (mine.length) record.notes = mine; else delete record.notes
  }
  book.notes.push(...notes)
  log('lessons ' + lessons.map(lesson => lesson.number).join(',') + ' (' + book.code + '): ' + lessons.map(lesson => book.record(lesson.number).phrases.length).join('+') + ' phrases' + (notes.length ? ', ' + notes.length + ' dropped' : ''))
}

/** Both phases for one batch, in order (kept for callers and tests that process a single batch). */
export async function processBatch({ book, lessons, io, options, log = () => {} }) {
  await processItems({ book, lessons, io, options, log })
  await processPhrases({ book, lessons, io, options, log })
}

/** Extra strict phrases for the words that have fewer than options.target (their lesson's pool only), under the same quality rules. */
export async function topUp({ book, io, options, log = () => {} }) {
  const code = book.code
  const taught = refreshReadability(book.lessons.lessons)
  const report = strictReport(book.lessons.lessons, taught)
  const index = book.index().vocabulary
  const items = []
  for (const record of book.lessons.lessons) for (const word of record.words) {
    if (taught.words.get(word.entry) !== record.number || items.some(item => item.entry === word.entry)) continue
    const have = report.perWord.get(word.entry) ?? 0
    if (have < options.target) items.push({ entry: word.entry, lesson: record.number, need: options.target - have, form: index.get(word.entry)?.target, english: gloss(index.get(word.entry)?.english) })
  }
  if (!items.length) return 0
  let added = 0
  const seenText = new Set(book.lessons.lessons.flatMap(record => record.phrases.map(phrase => sameTextKey(phrase.text))))
  const chunks = []
  for (const lessonNumber of [...new Set(items.map(item => item.lesson))].sort((a, b) => a - b)) {
    const mine = items.filter(item => item.lesson === lessonNumber)
    for (let at = 0; at < mine.length; at += options.batchSize) chunks.push(mine.slice(at, at + options.batchSize))
  }
  for (const chunk of chunks) {
    const limit = chunk[0].lesson
    const pool = poolFor(book, limit)
    const request = { words: wordsOf(book, pool.wordLesson), taught_grammar: taughtGrammarOf(book, pool.grammarLesson, limit), items: chunk }
    let reply
    try { reply = await callJSON(io.write, systemFor(code, 'write'), topUpPrompt(request)) } catch (reason) { log('top-up call failed, left for the next run: ' + reason.message); continue }
    const found = []
    for (const answer of reply.items ?? []) {
      const item = chunk.find(entry => entry.entry === answer?.entry)
      if (!item) continue
      for (const raw of (answer.phrases ?? []).slice(0, item.need)) {
        const result = validateCandidate(code, raw, item.lesson, poolFor(book, item.lesson), { allowNew: false })
        if (result.phrase && result.phrase.words.includes(item.entry) && !seenText.has(sameTextKey(result.phrase.text))) { seenText.add(sameTextKey(result.phrase.text)); found.push({ item, phrase: result.phrase }) }
      }
    }
    const verdicts = await checkItems({ io, code, kind: 'phrases', items: found.map(entry => phraseView(book.index().grammar, entry.phrase)), options })
    found.forEach((entry, position) => {
      if (!verdicts[position].ok) return
      book.record(entry.item.lesson).phrases.push({ id: ++book.lessons.last_phrase_id, ...finishPhrase(book, entry.phrase, new Map(), { unchecked: verdicts[position].unchecked }), top_up: true })
      added++
    })
  }
  refreshReadability(book.lessons.lessons)
  return added
}

/** Writes the lessons not yet in the book. A batch whose replies stay malformed is left for the next run and the run goes on. */
export async function runLanguage({ code, chinese, io, options, log = () => {}, book = createBook(code, { base: options.root }), save = () => {} }) {
  const todo = sourceLessons(chinese, options).filter(lesson => {
    const record = book.record(lesson.number)
    return !record || (options.retry && record.status === 'partial' && !record.phrases?.length)
  })
  const skipped = []
  const batches = []
  for (let at = 0; at < todo.length;) {
    const batch = [todo[at]]
    while (at + batch.length < todo.length && batch.length < options.lessonSpan && todo[at + batch.length].number === batch[batch.length - 1].number + 1) batch.push(todo[at + batch.length])
    batches.push(batch)
    at += batch.length
  }
  const leave = (batch, reason) => { skipped.push(...batch.map(lesson => lesson.number)); log(code + ': lessons ' + batch.map(lesson => lesson.number).join(',') + ' left for --retry (' + reason.message + ')') }
  // Phase 1, in lesson order: each batch's items depend on the earlier lessons' items.
  const ready = []
  for (const batch of batches) {
    try { await processItems({ book, lessons: batch, io, options, log }); save(book); ready.push(batch) } catch (reason) { if (!reason?.badReply) throw reason; leave(batch, reason) }
  }
  // Phase 2, concurrently: phrases for a lesson only need items up to that lesson, which all exist now.
  let next = 0
  const lanes = Math.max(1, Math.min(ready.length, options.phraseLanes ?? 6))
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (next < ready.length) {
      const batch = ready[next++]
      try { await processPhrases({ book, lessons: batch, io, options, log }); save(book) } catch (reason) { if (!reason?.badReply) throw reason; leave(batch, reason) }
    }
  }))
  if (options.topUp && book.lessons.lessons.length) { const added = await topUp({ book, io, options, log }); if (added) log(code + ': ' + added + ' top-up phrases'); save(book) }
  book.skipped = skipped
  return book
}

// ---------------------------------------------------------------- report

/** Counts, strict phrases per lesson, meanings without a strict phrase and the writing coverage of a language's data. */
export function parallelReport(code, book, strokes = readStrokeIndex(code, book.base)) {
  const lessons = book.lessons.lessons
  const taught = refreshReadability(lessons)
  const strict = strictReport(lessons, taught)
  const index = book.index()
  const wordIds = new Set(lessons.flatMap(lesson => lesson.words.map(word => word.entry)))
  const grammarIds = new Set(lessons.flatMap(lesson => lesson.phrases.flatMap(phrase => phrase.grammar ?? [])))
  const isNew = (map, id) => map.get(id)?.isNew === true
  const phrases = lessons.reduce((sum, lesson) => sum + lesson.phrases.length, 0)
  const strictCount = lessons.reduce((sum, lesson) => sum + lesson.phrases.filter(phrase => phrase.strict).length, 0)
  const coverage = writingCoverage(code, lessons, index, strokes)
  const senses = lessons.flatMap(lesson => lesson.senses ?? [])
  return {
    language: code, lessons: lessons.length,
    words: { senses: senses.length, covered: senses.filter(sense => sense.status === 'covered-by').length, entries: wordIds.size, matched: [...wordIds].filter(id => !isNew(index.vocabulary, id)).length, new: [...wordIds].filter(id => isNew(index.vocabulary, id)).length, noEquivalent: strict.noEquivalent.length },
    grammar: { total: grammarIds.size, matched: [...grammarIds].filter(id => !isNew(index.grammar, id)).length, new: [...grammarIds].filter(id => isNew(index.grammar, id)).length },
    phrases: { total: phrases, strict: strictCount },
    perLesson: strict.perLesson, meaningsWithoutStrictPhrase: strict.noStrict, noEquivalent: strict.noEquivalent,
    characters: { used: coverage.used, covered: coverage.covered, uncovered: coverage.missing },
  }
}

export function reportYaml(report) { return '# Strict-readability and writing-coverage report; regenerate with: node scripts/build-parallel-lessons.mjs --report --write\n' + stringify(report, { lineWidth: 0 }) }

// ---------------------------------------------------------------- writing data for the lessons' characters

/** Adds the kanji the Japanese lessons use to the app selection (they exist in curriculum/japanese/characters), then composes Korean syllables. Returns what is still missing. */
export function ensureCharacters(code, book, { run = spawnSync } = {}) {
  const base = book.base
  const used = usedCharacters(code, book.lessons.lessons, book.index())
  if (code === 'ja') {
    const file = join(base, 'curriculum', 'japanese', 'characters', 'app-selection.yaml')
    const text = readFileSync(file, 'utf8')
    const selection = parse(text)
    const have = new Set([...selection.kanji.n5, ...selection.kanji.n4, ...(selection.kanji.parallel ?? '')])
    const strokes = readStrokeIndex('ja', base)
    const missing = [...used].filter(ch => /\p{Script=Han}/u.test(ch) && !have.has(ch) && !strokes.has(ch))
    const prepared = new Set()
    for (const ch of missing) {
      const page = join(base, 'curriculum', 'japanese', 'characters', 'u' + (ch.codePointAt(0) >>> 8).toString(16).padStart(4, '0') + '.yaml')
      if (existsSync(page) && parse(readFileSync(page, 'utf8'))?.[ch]) prepared.add(ch)
    }
    if (prepared.size) {
      const merged = [...new Set([...(selection.kanji.parallel ?? ''), ...prepared])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('')
      const next = /^ {2}parallel: /m.test(text) ? text.replace(/^ {2}parallel: .*$/m, '  parallel: ' + merged) : text.replace(/\s*$/, '\n') + '  parallel: ' + merged + '\n'
      writeFileSync(file, next)
    }
  } else {
    const result = run(process.platform === 'win32' ? 'python' : 'python3', [join(base, 'scripts', 'korean_parallel_syllables.py')], { cwd: base, encoding: 'utf8' })
    if (result.status !== 0) throw new Error('Composing Korean syllables failed: ' + (result.stderr || result.error?.message))
  }
  const generated = run(process.execPath, [join(base, 'scripts', 'generate-app-writing-ja-ko.mjs')], { cwd: base, encoding: 'utf8' })
  if (generated.status !== 0) throw new Error('Writing data failed: ' + (generated.stderr || generated.stdout))
  return writingCoverage(code, book.lessons.lessons, book.index(), readStrokeIndex(code, base))
}

// ---------------------------------------------------------------- command line

export function parseArgs(argv, env = process.env) {
  const flags = new Map()
  const booleans = ['report', 'write', 'dry-run', 'retry', 'characters', 'no-top-up', 'help']
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (!arg.startsWith('--')) throw new Error('Unexpected argument: ' + arg)
    const [name, inline] = arg.slice(2).split(/=(.*)/s)
    flags.set(name, booleans.includes(name) ? true : inline ?? argv[++at])
  }
  const get = (name, envName, fallback) => flags.get(name) ?? (envName ? env[envName] : undefined) ?? fallback
  const language = get('language', 'PARALLEL_LANGUAGE', 'both')
  if (!['ja', 'ko', 'both'].includes(language)) throw new Error('--language takes ja, ko or both: ' + language)
  const number = (name, envName, fallback) => Math.max(0, Math.floor(Number(get(name, envName, fallback))) || 0)
  return {
    dumpReplies: flags.get('dump-replies') === true ? undefined : flags.get('dump-replies'), help: flags.has('help'), report: flags.has('report'), write: flags.has('write'), dryRun: flags.has('dry-run'), retry: flags.has('retry'), characters: flags.has('characters'), topUp: !flags.has('no-top-up'),
    languages: language === 'both' ? ['ja', 'ko'] : [language],
    lessons: flags.has('lessons') ? parseLessons(flags.get('lessons')) : undefined,
    baseUrl: get('base-url', 'PHRASE_API_BASE') ?? env.PHRASE_BASE_URL, apiKey: env[get('api-key-env', 'PHRASE_API_KEY_ENV', 'PHRASE_API_KEY')],
    sessionId: get('session-id', 'PHRASE_SESSION_ID', 'parallel-lessons-' + new Date().toISOString().slice(0, 19)),
    roles: { writer: { model: get('writer-model', 'PHRASE_WRITER_MODEL'), api: get('writer-api', 'PHRASE_WRITER_API', 'chat') }, checker: { model: get('checker-model', 'PHRASE_CHECKER_MODEL'), api: get('checker-api', 'PHRASE_CHECKER_API', 'chat') } },
    concurrency: Math.max(1, number('concurrency', 'PHRASE_CONCURRENCY', DEFAULTS.concurrency)), lessonSpan: Math.max(1, number('lesson-span', 'PHRASE_LESSON_SPAN', DEFAULTS.lessonSpan)),
    batchSize: Math.max(1, number('batch-size', 'PHRASE_BATCH_SIZE', DEFAULTS.batchSize)), target: number('target', 'PHRASE_TARGET', DEFAULTS.target), maxPhrases: Math.max(1, number('max-phrases', undefined, DEFAULTS.maxPhrases)),
    rewrites: number('rewrites', undefined, DEFAULTS.rewrites), maxTokens: number('max-tokens', 'PHRASE_MAX_TOKENS', 16000),
    root: resolve(get('root', undefined, defaultRoot)),
  }
}

export function createIO(options, fetchImpl, log = () => {}) {
  const throttle = createThrottleLog(log)
  const make = role => createCaller({ onRetry: throttle.note, headers: { ...(options.sessionId ? { 'x-session-id': options.sessionId } : {}), 'x-hexad-client': 'parallel-lessons' }, baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.roles[role].model, api: options.roles[role].api, maxTokens: options.maxTokens, timeoutMs: 300000, ...(fetchImpl ? { fetchImpl, sleep: async () => {} } : {}) })
  return { write: make('writer'), check: make('checker'), flushThrottle: throttle.flush }
}

export async function main(argv = process.argv.slice(2), { fetchImpl, log = console.log, io: given } = {}) {
  const options = parseArgs(argv)
  if (options.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n')); return }
  const chinese = loadChineseLessons({ base: options.root, maxPhrases: options.maxPhrases })
  const books = new Map(options.languages.map(code => [code, createBook(code, { base: options.root })]))
  const save = book => writeParallel(book.code, book, options.root)
  if (options.report || options.characters) {
    for (const [code, book] of books) {
      if (options.characters) log(code + ' writing data: ' + JSON.stringify(ensureCharacters(code, book)))
      const report = parallelReport(code, book)
      log(JSON.stringify(report, null, 1))
      if (options.write) writeAtomic(reportFile(code, options.root), reportYaml(report))
    }
    return
  }
  if (options.dryRun) {
    for (const [code, book] of books) {
      const todo = sourceLessons(chinese, options).filter(lesson => !book.record(lesson.number) || (options.retry && book.record(lesson.number).status === 'partial'))
      log(code + ': ' + todo.length + ' lessons to write, ' + todo.reduce((sum, lesson) => sum + lesson.words.length, 0) + ' senses, ' + todo.reduce((sum, lesson) => sum + lesson.phrases.length, 0) + ' source phrases, ' + Math.ceil(todo.length / options.lessonSpan) + ' writer calls for lessons and as many for phrases')
      if (todo.length) log('--- ' + code + ' writer prompt for lesson ' + todo[0].number + ' (system: ' + systemFor(code, 'write') + ') ---\n' + lessonPrompt(code, [todo[0]]))
    }
    return
  }
  if (!given && (!options.baseUrl || !options.roles.writer.model || !options.roles.checker.model)) throw new Error('Give --base-url (or PHRASE_API_BASE), --writer-model and --checker-model; see the header of this script.')
  log('session id: ' + options.sessionId)
  setReplyLog(line => log('  ' + line))
  setReplyDump(options.dumpReplies)
  const io = given ?? createIO(options, fetchImpl, log)
  const stop = () => { try { for (const book of books.values()) save(book) } finally { process.exit(130) } }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  // the languages run side by side; a language that fails does not stop the other
  const outcomes = await Promise.allSettled([...books].map(([code, book]) => runLanguage({ code, chinese, io, options, log, book, save })))
  process.off('SIGINT', stop); process.off('SIGTERM', stop)
  io.flushThrottle?.()
  for (const [code, book] of books) { save(book); const report = parallelReport(code, book); log(code + ': ' + report.phrases.total + ' phrases, ' + report.phrases.strict + ' strict; words ' + report.words.matched + ' matched, ' + report.words.new + ' new' + (book.skipped?.length ? '; lessons ' + book.skipped.join(',') + ' left for --retry' : '')) }
  const failed = outcomes.find(outcome => outcome.status === 'rejected')
  if (failed) throw failed.reason
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(reason => { console.error(reason instanceof Error ? reason.message : reason); process.exitCode = 1 })
