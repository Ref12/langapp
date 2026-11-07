// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { FUNCTION_CHARACTERS as APP_FUNCTION_CHARACTERS } from '../src/core/drills/content'
import {
  BANDS, FUNCTION_CHARACTERS, allowedFor, batchByLesson, buildCurriculum, buildOutputs, catalogPhrases, coverageReport, createIO, emptyState, loadState, main, parseArgs, parseJSONReply,
  parseLessons, passReport, replyText, runPipeline, saveState, selectWords, validatePhrase, verdictOf, vocabularyFor, wordsInScope, writeOutputs,
  phrasePinyin, repinyinFiles, addPhrase, lessonKeys, phraseKey, applyGrammar, attachPhrases, grammarCounts, grammarFor, grammarInScope, grammarWord, phrasesForWord, wordCounts,
} from './build-phrase-bank.mjs'
import { phraseKey as appPhraseKey } from '../src/core/phrases/key'
import { phraseIndex, phraseIndexText } from './phrase-bank-files.mjs'
import { isOldState, parsePhraseYaml, phraseBankOutputs, phraseJsonText, readOldBank, readOldState, readPhraseBand, readPhraseBands, stringifyPhraseYaml, writePhraseBands } from './phrase-bank-files.mjs'

const word = (lb: string, ch: string, pr: string, ds: string) => ({ id: lb, ch, pr, ds, lb })
const band = (name: string, vocabulary: ReturnType<typeof word>[], groups: unknown[]) => ({ schemaVersion: 1, band: name, alignment: 'hsk-' + name, vocabulary, grammar: [], groups })
const unit = (ref: string) => ({ kind: 'vocabulary', ref })
const example = (id: string, words: string[], translation: string) => ({ id, segments: [...words.map(ref => ({ word: ref })), { punctuation: '。' }], translation, grammar: [] })
const FIXTURE = [
  band('1', [word('wo', '我', 'wǒ', 'I; me'), word('shi', '是', 'shì', 'to be'), word('xs', '学生', 'xué sheng', 'student'), word('cha', '茶', 'chá', 'tea'), word('he', '喝', 'hē', 'to drink'), word('huai', '坏', 'huài', 'bad')], [
    { id: 'g1', units: [unit('wo'), unit('shi'), unit('xs'), unit('huai')], examples: [example('e1', ['wo', 'shi', 'xs'], 'I am a student.')] },
    { id: 'g2', units: [unit('cha'), unit('he')], examples: [example('e2', ['wo', 'he', 'cha'], 'I drink tea.')] },
  ]),
  ...['2', '3', '4', '5', '6'].map(name => band(name, [], [])),
]
// the function characters are catalog words too: taught in lesson 1 with three one-word examples each, so no pipeline test has to write phrases for them
const FUNCTION_PINYIN: Record<string, string> = {"的":"de","了":"le","吗":"ma","呢":"ne","吧":"ba","是":"shì","不":"bù","很":"hěn","也":"yě","都":"dōu","和":"hé","在":"zài","有":"yǒu","这":"zhè","那":"nà","我":"wǒ","你":"nǐ","他":"tā","她":"tā","们":"men","个":"gè"}
function withFunctionWords(bands: ReturnType<typeof band>[], lesson = 0, only?: string[]) {
  const first = bands[0], have = new Set(first.vocabulary.map(record => record.ch))
  const extra = Object.entries(FUNCTION_PINYIN).filter(([ch]) => !have.has(ch) && (!only || only.includes(ch))).map(([ch, pr]) => word('f-' + ch, ch, pr, 'function'))
  first.vocabulary.push(...extra)
  const g1 = (lesson < first.groups.length ? first.groups[lesson] : (first.groups.push({ id: 'g-function', units: [], examples: [] }), first.groups[first.groups.length - 1])) as { units: unknown[]; examples: unknown[] }
  g1.units.push(...extra.map(record => unit(record.lb)))
  for (const record of extra) for (const n of [1, 2, 3]) g1.examples.push({ id: 'f-' + record.ch + n, segments: Array.from({ length: n }, () => ({ word: record.lb })), translation: 'function ' + n, grammar: [] })
  return bands
}
withFunctionWords(FIXTURE)
const curriculum = () => buildCurriculum(FIXTURE)

type Call = { url: string; model: string; body: Record<string, unknown>; text: string }
/** A mocked OpenAI-compatible endpoint: replies per role (by model name) with the shape that role's API calls for. */
function endpoint(replies: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    const text = body.messages ? body.messages.map((m: { content: string }) => m.content).join('\n') : body.instructions + '\n' + body.input
    const call = { url, model: body.model, body, text }
    calls.push(call)
    const reply = replies[body.model]?.(call)
    if (reply instanceof Error) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }
    const content = JSON.stringify(reply)
    const json = body.messages ? { choices: [{ message: { content } }] } : { output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
    return { ok: true, status: 200, text: async () => content, json: async () => json }
  }
  return { calls, fetchImpl }
}
const OPTIONS = (extra: object = {}) => parseArgs(['--base-url', 'http://gateway/v1', '--planner-model', 'strong', '--writer-model', 'cheap', '--checker-model', 'strong', '--planner-api', 'chat', '--writer-api', 'responses', '--checker-api', 'chat', '--target', '3', '--plan', '--lookahead', '0', ...Object.entries(extra).flatMap(([key, value]) => [key, String(value)])], {})
const sentence = (ref: string, zh: string, py: string, en: string) => ({ ref, zh, py, en })
const ALL_GOOD = (call: Call) => call.model === 'strong' && call.text.includes('"phrases"') && call.text.includes('natural')
  ? { results: [...call.text.matchAll(/"id":"([^"]+)"/g)].map(match => ({ id: match[1], natural: true, matches: true, allowed: true, reason: '' })) } : undefined

/** The Chinese of every phrase in the flat list that uses the word. */
const zhOf = (state: { phrases: { zh: string; words: string[] }[] }, lb: string) => state.phrases.filter(phrase => phrase.words.includes(lb)).map(phrase => phrase.zh)
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'phrase-bank-')); dirs.push(dir); return dir }

describe('phrase bank pipeline: catalog and validation', () => {
  it('keeps FUNCTION_CHARACTERS in step with the app', () => { expect(FUNCTION_CHARACTERS).toBe(APP_FUNCTION_CHARACTERS) })
  it('counts the authored phrases that fit each word by that word\'s lesson, and reports 0, 1-2 and 3+', () => {
    const c = curriculum()
    const found = catalogPhrases(c)
    expect(found.get('xs')?.map(item => item.zh)).toEqual(['我是学生。'])
    // 我 is learned in lesson 1, so the lesson-2 example (喝茶) does not count for it
    expect(found.get('wo')?.map(item => item.zh)).toEqual(['我是学生。'])
    expect(found.get('cha')?.map(item => item.zh)).toEqual(['我喝茶。'])
    expect(coverageReport(c).fitByLesson).toEqual({ zero: 1, oneOrTwo: 5, threePlus: 19 })
  })
  it('validates in code: the word, only words learned by then, short, plain English', () => {
    const c = curriculum()
    const tea = c.words.get('cha')
    const ok = validatePhrase(c, tea, sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.'))
    expect(ok.phrase).toMatchObject({ zh: '我是茶。', source: 'ai', checked: false })
    expect(ok.phrase?.words).toEqual(['wo', 'shi', 'cha'].filter(lb => lb !== 'cha').concat('cha').sort((a, b) => ['wo', 'shi', 'cha'].indexOf(a) - ['wo', 'shi', 'cha'].indexOf(b)))
    // 喝 is learned in the same lesson as 茶, so it is allowed; a word from no lesson is not
    expect(validatePhrase(c, tea, sentence('cha', '我喝茶。', 'wǒ hē chá', 'I drink tea.')).phrase).toBeDefined()
    expect(validatePhrase(c, tea, sentence('cha', '我喝茶吗。', 'wǒ hē chá ma', 'x')).phrase).toBeDefined() // 吗 is a function character
    expect(validatePhrase(c, tea, sentence('cha', '我爱茶。', 'wǒ ài chá', 'I love tea.')).reason).toMatch(/not yet learned/)
    expect(validatePhrase(c, c.words.get('wo'), sentence('wo', '我喝茶。', 'wǒ hē chá', 'I drink tea.')).reason).toMatch(/not yet learned/)
    expect(validatePhrase(c, tea, sentence('cha', '我是学生。', 'wǒ shì xué sheng', 'I am a student.')).reason).toMatch(/does not contain/)
    expect(validatePhrase(c, tea, sentence('cha', '茶茶茶茶茶茶茶茶茶茶茶茶茶', 'chá', 'tea')).reason).toBe('too long')
    expect(validatePhrase(c, tea, sentence('cha', '我是茶。', 'wǒ shì chá', 'I am 茶.')).reason).toMatch(/Chinese in/)
  })
})

describe('phrase bank pipeline: batched model calls', () => {
  it('plans, writes and checks in one call each per batch, over the shape each role asks for', async () => {
    const c = curriculum()
    const { calls, fetchImpl } = endpoint({
      strong: call => ALL_GOOD(call) ?? (call.text.includes('"plans"') ? { plans: [{ ref: 'cha', specs: ['ordering tea', 'asking for tea'] }, { ref: 'he', specs: ['at lunch', 'with a friend'] }] } : { results: [] }),
      cheap: () => ({ phrases: [
        sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.'), sentence('cha', '茶是我的。', 'chá shì wǒ de', 'The tea is mine.'),
        sentence('he', '我喝。', 'wǒ hē', 'I drink.'), sentence('he', '你喝吗。', 'nǐ hē ma', 'Do you drink?'), sentence('he', '我不喝。', 'wǒ bù hē', 'I do not drink.'),
      ] }),
    })
    const options = OPTIONS({ '--batch-size': 20 })
    const state = emptyState()
    await runPipeline({ curriculum: c, state, io: createIO(options, fetchImpl as never), options: { ...options, batchSize: 20, bands: ['1'], words: ['cha', 'he'] } })
    // plan (chat), write (responses), check (chat): one call each for the two words
    expect(calls.map(call => [call.model, call.url])).toEqual([['strong', 'http://gateway/v1/chat/completions'], ['cheap', 'http://gateway/v1/responses'], ['strong', 'http://gateway/v1/chat/completions']])
    expect(calls[0].body).toHaveProperty('messages')
    expect(calls[1].body).toHaveProperty('input')
    expect(calls[1].text).toContain('ordering tea')
    expect(zhOf(state, 'cha')).toEqual(['我是茶。', '茶是我的。'])
    expect(state.phrases.filter(p => p.words.includes('cha')).every(p => p.checked)).toBe(true)
    expect(state.words.cha.status).toBe('done') // 1 catalog + 2 written
    expect(zhOf(state, 'he')).toHaveLength(2) // limited to what the word still needed
  })

  it('rewrites a failing phrase once in one batch and drops it when the rewrite fails too', async () => {
    const c = curriculum()
    let writes = 0
    const { calls, fetchImpl } = endpoint({
      strong: call => call.text.includes('"plans"') ? { plans: [] } : { results: [...call.text.matchAll(/"id":"([^"]+)","zh":"([^"]+)"/g)].map(match => ({ id: match[1], natural: !match[2].includes('坏'), matches: true, allowed: true, reason: 'unnatural' })) },
      cheap: () => ({ phrases: ++writes === 1
        ? [sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.'), sentence('cha', '坏茶。', 'huài chá', 'bad tea')]
        : [sentence('cha', '坏茶吗。', 'huài chá ma', 'bad tea?')] }),
    })
    const run = { ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--lookahead', '0', '--target', '4'], {}), words: ['cha'], batchSize: 20 }
    const state = emptyState()
    await runPipeline({ curriculum: c, state, io: createIO(run, fetchImpl as never), options: run })
    const writeCalls = calls.filter(call => call.model === 'cheap')
    expect(writeCalls).toHaveLength(2) // the write and one rewrite batch
    expect(writeCalls[1].text).toContain('rewrite')
    expect(zhOf(state, 'cha')).toEqual(['我是茶。']) // the failing one was rewritten badly and dropped
    expect(calls.filter(call => call.model === 'strong')).toHaveLength(2) // check, check of the rewrite
  })

  it('keeps phrases unchecked, and carries on, when the check call itself fails', async () => {
    const c = curriculum()
    const { fetchImpl } = endpoint({
      strong: () => new Error('down'),
      cheap: () => ({ phrases: [sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.')] }),
    })
    const run = { ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--lookahead', '0'], {}), words: ['cha'], batchSize: 20 }
    const state = emptyState()
    const log: string[] = []
    await runPipeline({ curriculum: c, state, io: createIO(run, fetchImpl as never), options: run, log: line => log.push(line) })
    expect(state.phrases).toEqual([expect.objectContaining({ id: 1, zh: '我是茶。', checked: false })])
    expect(log.some(line => line.includes('check failed'))).toBe(true)
  })

  it('is resumable: a word that is done is skipped, and failed words come back with --retry', async () => {
    const c = curriculum()
    const options = { ...OPTIONS(), words: undefined, bands: ['1'], batchSize: 20, retry: false }
    const state = emptyState()
    state.words.cha = { status: 'done', attempts: 1 }
    state.words.he = { status: 'failed', attempts: 1, note: 'write failed' }
    expect(selectWords({ curriculum: c, state, options }).map(entry => entry.word.lb)).not.toContain('cha')
    expect(selectWords({ curriculum: c, state, options }).map(entry => entry.word.lb)).not.toContain('he')
    expect(selectWords({ curriculum: c, state, options: { ...options, retry: true } }).map(entry => entry.word.lb)).toContain('he')
  })
})

describe('phrase bank pipeline: files and options', () => {
  it('writes one YAML file per band (a flat list, ids from 1), the app JSON beside it, and the state keeps only progress', () => {
    const c = curriculum()
    const state = emptyState()
    state.words.cha = { status: 'done', attempts: 1 }
    addPhrase(c, state, { zh: '我是茶。', py: 'wǒ shì chá', en: 'I am tea.', words: ['wo', 'shi', 'cha'], source: 'ai', checked: true })
    addPhrase(c, state, { zh: '茶是我的。', py: 'chá shì wǒ de', en: 'The tea is mine.', words: ['cha', 'wo'], grammar: [], source: 'ai', checked: false })
    const dir = temp()
    writeOutputs(join(dir, 'out'), buildOutputs(c, state), join(dir, 'json'))
    for (const name of BANDS) {
      expect(readPhraseBand(join(dir, 'out'), name).band).toBe(name)
      expect(JSON.parse(readFileSync(join(dir, 'json', 'hsk-' + name + '.json'), 'utf8'))).toMatchObject({ schemaVersion: 2, band: name })
    }
    const file = readPhraseBand(join(dir, 'out'), '1')
    expect(file.phrases.map(p => [p.id, p.zh])).toEqual([[1, '我是茶。'], [2, '茶是我的。']]) // one list, not keyed by word; 'band' is not stored
    expect(file.phrases[0]).not.toHaveProperty('band')
    expect(JSON.parse(readFileSync(join(dir, 'json', 'hsk-1.json'), 'utf8')).phrases).toHaveLength(2)
    saveState(join(dir, 'state.json'), state)
    const saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
    expect(saved).not.toHaveProperty('phrases')
    expect(loadState(join(dir, 'state.json')).words).toEqual(state.words)
    expect(loadState(join(dir, 'missing.json'))).toEqual(emptyState())
  })
  it('takes the endpoint and a model and API shape per role from flags or the environment, and reads either reply shape', () => {
    const options = parseArgs(['--writer-model', 'luna', '--writer-api=responses'], { PHRASE_BASE_URL: 'http://localhost:5210/v1', PHRASE_PLANNER_MODEL: 'sonnet', PHRASE_API_KEY: 'k' })
    expect(options.baseUrl).toBe('http://localhost:5210/v1')
    expect(options.roles).toEqual({ planner: { model: 'sonnet', api: 'chat' }, writer: { model: 'luna', api: 'responses' }, checker: { model: 'sonnet', api: 'chat' } })
    expect(options.apiKey).toBe('k')
    expect(replyText({ choices: [{ message: { content: 'a' } }] })).toBe('a')
    expect(replyText({ output_text: 'b' })).toBe('b')
    expect(replyText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'c' }] }] })).toBe('c')
    expect(parseJSONReply('Here you go:\n' + '\u0060\u0060\u0060json\n{"a":1}\n\u0060\u0060\u0060')).toEqual({ a: 1 })
  })
  it('runs end to end from the command line against a mocked endpoint on a fixture catalog', async () => {
    const dir = temp()
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'data'))
    FIXTURE.forEach(data => writeFileSync(join(dir, 'data', 'hsk-' + data.band + '.generated.json'), JSON.stringify(data)))
    const { fetchImpl } = endpoint({
      strong: call => ALL_GOOD(call) ?? { plans: [] },
      cheap: () => ({ phrases: [sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.'), sentence('cha', '茶是我的。', 'chá shì wǒ de', 'The tea is mine.')] }),
    })
    const log: string[] = []
    const args = ['--base-url', 'http://gateway/v1', '--planner-model', 'strong', '--plan', '--writer-model', 'cheap', '--words', 'cha', '--data-dir', join(dir, 'data'), '--out', join(dir, 'out'), '--json-out', join(dir, 'json'), '--state', join(dir, 'state.json')]
    await main(args, { fetchImpl: fetchImpl as never, log: line => log.push(line) })
    const yaml = parse(readFileSync(join(dir, 'out', 'hsk-1.yaml'), 'utf8'))
    expect(yaml.phrases.filter((p: { words: string[] }) => p.words.includes('cha'))).toHaveLength(2)
    expect(yaml.phrases.map((p: { id: number }) => p.id)).toEqual([1, 2])
    expect(JSON.parse(readFileSync(join(dir, 'json', 'hsk-1.json'), 'utf8')).phrases).toHaveLength(2)
    expect(log.at(-1)).toContain('done 1')
    const before = log.length
    await main(args, { fetchImpl: (async () => { throw new Error('no calls expected on a re-run') }) as never, log: line => log.push(line) })
    expect(log.slice(before).join('\n')).toContain('0 to write in 0 batches')
  })
})

// ---------------------------------------------------------------- look-ahead, vocabulary per word, verdicts, lessons, crediting

const FIXTURE2 = [
  band('1', [word('wo', '我', 'wǒ', 'I; me'), word('shi', '是', 'shì', 'to be'), word('xs', '学生', 'xué sheng', 'student'), word('cha', '茶', 'chá', 'tea'), word('he', '喝', 'hē', 'to drink'), word('huai', '坏', 'huài', 'bad'), word('ai', '爱', 'ài', 'to love')], [
    { id: 'g1', units: [unit('wo'), unit('shi'), unit('xs')], examples: [example('e1', ['wo', 'shi', 'xs'], 'I am a student.')] },
    { id: 'g2', units: [unit('cha'), unit('he')], examples: [example('e2', ['wo', 'he', 'cha'], 'I drink tea.')] },
    { id: 'g3', units: [unit('huai')], examples: [] },
    { id: 'g4', units: [unit('ai')], examples: [] },
  ]),
  ...['2', '3', '4', '5', '6'].map(name => band(name, [], [])),
]
// the few function characters these fixtures use, taught in lesson 1 like the real catalog does
withFunctionWords(FIXTURE2, 0, ['吗', '你', '的', '不'])
const curriculum2 = () => buildCurriculum(FIXTURE2)
const forms = (c: ReturnType<typeof curriculum2>, lb: string, lookahead: number) => [...allowedFor(c, c.words.get(lb), lookahead).forms.keys()]
const runOptions = (extra: object = {}) => ({ ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--lookahead', '0,1,2'], {}), batchSize: 20, ...extra })
const checkBody = (text: string) => JSON.parse(text.slice(text.lastIndexOf('{"groups"')))
const approve = (call: Call) => ({ results: [...call.text.matchAll(/"id":"([^"]+)"/g)].map(match => ({ id: match[1], natural: true, matches: true, reason: '' })) })

describe('phrase bank pipeline: look-ahead passes', () => {
  it('widens the window by lesson per pass: pass 0 is the strict rule, pass k reaches k lessons later', () => {
    const c = curriculum2()
    expect(forms(c, 'wo', 0)).toEqual(['我', '是', '学生', '的', '吗', '不', '你']) // the function characters are lesson 1 words
    expect(forms(c, 'wo', 1)).toEqual(['我', '是', '学生', '的', '吗', '不', '你', '茶', '喝'])
    expect(forms(c, 'wo', 2)).toEqual(['我', '是', '学生', '的', '吗', '不', '你', '茶', '喝', '坏'])
    // code validates each pass's window
    const wo = c.words.get('wo')
    const phrase = { ref: 'wo', zh: '我喝茶。', py: 'wǒ hē chá', en: 'I drink tea.' }
    const love = { ref: 'wo', zh: '我爱学生。', py: 'wǒ ài xué sheng', en: 'I love students.' }
    expect(validatePhrase(c, wo, phrase, allowedFor(c, wo, 0)).reason).toMatch(/not yet learned/)
    expect(validatePhrase(c, wo, phrase, allowedFor(c, wo, 1)).phrase).toBeDefined()
    expect(validatePhrase(c, wo, love, allowedFor(c, wo, 2)).reason).toMatch(/not yet learned/)
    expect(validatePhrase(c, wo, love, allowedFor(c, wo, 3)).phrase).toBeDefined()
  })

  it('records lookahead and readyAt on every phrase; pass-0 phrases are ready by their own lesson', () => {
    const c = curriculum2()
    const wo = c.words.get('wo'), cha = c.words.get('cha')
    const strict = validatePhrase(c, wo, { ref: 'wo', zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.' }, allowedFor(c, wo, 0)).phrase
    expect(strict).toMatchObject({ lookahead: 0, readyAt: 0 })
    expect(strict!.readyAt).toBeLessThanOrEqual(wo.index)
    const ahead = validatePhrase(c, wo, { ref: 'wo', zh: '我喝茶。', py: 'wǒ hē chá', en: 'I drink tea.' }, allowedFor(c, wo, 1)).phrase
    expect(ahead).toMatchObject({ lookahead: 1, readyAt: 1, words: ['wo', 'he', 'cha'] })
    expect(validatePhrase(c, cha, { ref: 'cha', zh: '我喝茶。', py: 'wǒ hē chá', en: 'I drink tea.' }, allowedFor(c, cha, 0)).phrase).toMatchObject({ lookahead: 0, readyAt: 1 })
  })

  it('lists every catalog word a phrase uses in words, function characters included', () => {
    const base = band('1', [word('ni', '你', 'nǐ', 'you'), word('ma', '吗', 'ma', 'question'), word('xx', '学习', 'xué xí', 'study')], [{ id: 'g1', units: [unit('ni'), unit('xx')], examples: [] }, { id: 'g2', units: [unit('ma')], examples: [] }])
    const c = buildCurriculum([base, ...['2', '3', '4', '5', '6'].map(name => band(name, [], []))])
    const study = c.words.get('xx')
    // 吗 is introduced one lesson later, but it is a function character, so it is allowed at pass 0 and still listed
    const phrase = validatePhrase(c, study, { ref: 'xx', zh: '你学习吗？', py: 'nǐ xué xí ma', en: 'Do you study?' }, allowedFor(c, study, 0)).phrase
    expect(phrase?.words).toEqual(['ni', 'xx', 'ma'])
    expect(phrase?.readyAt).toBe(1)
  })

  it('runs the passes in order and only puts words still under target into a later pass', async () => {
    const c = curriculum2()
    const wo = { ...runOptions(), words: ['wo'], target: 4 }
    const state = emptyState()
    const log: string[] = []
    const { calls, fetchImpl } = endpoint({
      strong: approve,
      cheap: call => ({ phrases: call.text.includes('"lookahead":0')
        ? [sentence('wo', '我是学生吗。', 'wǒ shì xué sheng ma', 'Am I a student?')]
        : [sentence('wo', '我的茶。', 'wǒ de chá', 'My tea.'), sentence('wo', '我喝茶吗。', 'wǒ hē chá ma', 'Do I drink tea?')] }),
    })
    await runPipeline({ curriculum: c, state, io: createIO(wo, fetchImpl as never), options: wo, log: line => log.push(line) })
    const writes = calls.filter(call => call.model === 'cheap')
    expect(writes[0].text).toContain('"lookahead":0')
    expect(writes[0].text).not.toContain('"lesson":2') // pass 0 shows only the word's own lesson
    expect(writes[1].text).toContain('"lookahead":1')
    expect(writes[1].text).toContain('"lesson":2')
    const byZh = Object.fromEntries(state.phrases.filter(p => p.words.includes('wo')).map(p => [p.zh, p]))
    expect(byZh['我是学生吗。']).toMatchObject({ lookahead: 0 })
    expect(byZh['我是学生吗。'].readyAt).toBeLessThanOrEqual(0)
    expect(byZh['我的茶。']).toMatchObject({ lookahead: 1, readyAt: 1 })
    expect(log.some(line => line.startsWith('pass look-ahead 0'))).toBe(true)
    expect(log.some(line => line.startsWith('pass look-ahead 1'))).toBe(true)
    // a word at target is not in a later pass
    const full = emptyState()
    full.words.xs = { status: 'done', attempts: 1 }
    expect(selectWords({ curriculum: c, state: full, options: { ...wo, words: ['xs'] }, lookahead: 2 })).toEqual([])
  })

  it('reports per pass how many words reached the target and the words left without phrases', () => {
    const c = curriculum2()
    const report = passReport(c, emptyState(), { ...runOptions(), lookahead: [0, 1], target: 1 })
    expect(report.passes.map(row => [row.lookahead, row.reached])).toEqual([[0, 9], [1, 9]])
    expect(report.zeroPhrase).toBe(2) // 坏 and 爱 have no authored example
  })
})

describe('phrase bank pipeline: per-word vocabulary', () => {
  it('groups the vocabulary by lesson, newest first, per word', () => {
    const c = curriculum2()
    const groups = vocabularyFor(c, c.words.get('cha'), 0)
    expect(groups.map(group => group.lesson)).toEqual([2, 1])
    expect(groups[0].words.join(' ')).toContain('茶 (chá)')
    expect(vocabularyFor(c, c.words.get('wo'), 1).map(group => group.lesson)).toEqual([2, 1])
  })

  it('judges each word against its own lesson\'s vocabulary in the check prompt, not the first word\'s', async () => {
    const c = curriculum2()
    const { calls, fetchImpl } = endpoint({
      strong: approve,
      cheap: () => ({ phrases: [sentence('wo', '我是学生吗。', 'wǒ shì xué sheng ma', 'Am I a student?'), sentence('cha', '我喝茶吗。', 'wǒ hē chá ma', 'Do I drink tea?')] }),
    })
    const options = { ...runOptions({ lookahead: [0], target: 3 }), words: ['wo', 'cha'], lessonSpan: 1 }
    await runPipeline({ curriculum: c, state: emptyState(), io: createIO(options, fetchImpl as never), options })
    const check = calls.find(call => call.model === 'strong')!
    const groups = checkBody(check.text).groups as { vocabulary: { lesson: number; words: string[] }[]; phrases: { word: string }[] }[]
    const woGroup = groups.find(group => group.phrases.some(p => p.word === '我'))!
    const chaGroup = groups.find(group => group.phrases.some(p => p.word === '茶'))!
    expect(woGroup.vocabulary.flatMap(g => g.words).join(' ')).not.toContain('茶')
    expect(chaGroup.vocabulary.flatMap(g => g.words).join(' ')).toContain('茶')
    expect(chaGroup.vocabulary[0].lesson).toBe(2)
  })
})

describe('phrase bank pipeline: the checker verdict', () => {
  it('keeps a reason-less or malformed verdict and drops a phrase only for a stated reason', () => {
    expect(verdictOf({ natural: true, matches: true })).toMatchObject({ ok: true })
    expect(verdictOf({ natural: 'true', matches: 'true', reason: 'fine' })).toMatchObject({ ok: true })
    expect(verdictOf({ natural: 'false' })).toMatchObject({ ok: true }) // false but no reason
    expect(verdictOf({ matches: undefined })).toMatchObject({ ok: true }) // a missing field is not a failure
    expect(verdictOf({ natural: true, matches: true, allowed: false, reason: 'x' })).toMatchObject({ ok: true }) // vocabulary is code's job
    expect(verdictOf({ natural: false, reason: 'sounds stilted' })).toEqual({ ok: false, reason: 'sounds stilted' })
    expect(verdictOf({ natural: 'false', matches: true, reason: ' English is wrong ' })).toEqual({ ok: false, reason: 'English is wrong' })
  })

  it('logs the stated reason when it drops a phrase, and keeps phrases that fail without one', async () => {
    const c = curriculum2()
    const { fetchImpl } = endpoint({
      strong: call => ({ results: [...call.text.matchAll(/"id":"([^"]+)","zh":"([^"]+)"/g)].map(match => match[2].includes('坏')
        ? { id: match[1], natural: false, matches: true, reason: 'not something a person says' }
        : match[2].includes('爱') ? { id: match[1], natural: false, matches: true } : { id: match[1], natural: 'true', matches: true }) }),
      cheap: () => ({ phrases: [sentence('wo', '我是学生吗。', 'wǒ shì xué sheng ma', 'Am I a student?'), sentence('wo', '我是坏学生。', 'wǒ shì huài xué sheng', 'I am a bad student.'), sentence('wo', '我爱学生。', 'wǒ ài xué sheng', 'I love students.')] }),
    })
    const options = { ...runOptions({ lookahead: [3], target: 5 }), words: ['wo'] }
    const state = emptyState(), log: string[] = []
    await runPipeline({ curriculum: c, state, io: createIO(options, fetchImpl as never), options, log: line => log.push(line) })
    const kept = zhOf(state, 'wo')
    expect(kept).toContain('我是学生吗。') // the string "true" is fine
    expect(kept).toContain('我爱学生。') // failed with no reason: kept
    expect(kept).not.toContain('我是坏学生。') // stated reason: dropped, and the reason is logged
    expect(log.some(line => line.includes('我是坏学生。') && line.includes('not something a person says'))).toBe(true)
  })
})

describe('phrase bank pipeline: lessons and batches', () => {
  it('selects the words introduced in --lessons, counted from 1, across bands, in curriculum order', () => {
    const c = curriculum2()
    expect(parseLessons('1-2')).toEqual({ from: 1, to: 2 })
    expect(parseLessons('3')).toEqual({ from: 3, to: 3 })
    expect(() => parseLessons('0-3')).toThrow(/lessons/)
    expect(() => parseLessons('5-2')).toThrow(/backwards/)
    const options = parseArgs(['--lessons', '2-3'], {})
    expect(options.lessons).toEqual({ from: 2, to: 3 })
    expect(wordsInScope(c, options).map(w => w.lb)).toEqual(['cha', 'he', 'huai'])
    const picked = selectWords({ curriculum: c, state: emptyState(), options: { ...options, target: 3 } })
    expect(picked.map(entry => entry.word.lb)).toEqual(['cha', 'he', 'huai'])
    expect(wordsInScope(c, parseArgs(['--lessons', '1-4', '--words', 'wo,ai'], {})).map(w => w.lb)).toEqual(['wo', 'ai'])
    expect(wordsInScope(c, parseArgs(['--lessons', '1-4', '--band', '2'], {}))).toEqual([])
  })

  it('batches words from the same or adjacent lessons only', () => {
    const c = curriculum2()
    const entries = c.ordered.map(w => ({ word: w }))
    expect(batchByLesson(entries as never, 20, 1).map(batch => batch.map(entry => entry.word.lb))).toEqual([['wo', 'shi', 'xs', 'f-的', 'f-吗', 'f-不', 'f-你', 'cha', 'he'], ['huai', 'ai']])
    expect(batchByLesson(entries as never, 2, 1).every(batch => batch.length <= 2)).toBe(true)
  })
})

describe('phrase bank pipeline: crediting a phrase to other words', () => {
  it('counts a phrase in hand for every word it uses that has it in its window, and not for words it cannot serve', () => {
    const c = curriculum2()
    const state = emptyState()
    const phrase = addPhrase(c, state, { zh: '我喝茶吗。', py: 'wǒ hē chá ma', en: 'Do I drink tea?', words: ['wo', 'he', 'cha'], source: 'ai', checked: true, lookahead: 0 })!
    expect(phrase).toMatchObject({ id: 1, band: '1', readyAt: 1 })
    const entries = (words: string[], lookahead: number) => selectWords({ curriculum: c, state, options: { ...runOptions(), words, target: 5 }, lookahead })
    expect(entries(['he'], 0)[0]).toMatchObject({ need: 3, existingZh: expect.arrayContaining(['我喝茶吗。']) }) // 1 catalog + the phrase in hand
    expect(entries(['wo'], 0)[0].existingZh).not.toContain('我喝茶吗。') // 我 (lesson 1) cannot use it at pass 0
    expect(entries(['wo'], 1)[0].existingZh).toContain('我喝茶吗。') // at look-ahead 1 it counts for 我 too
    expect(phrasesForWord(c, state, c.words.get('wo'), 0)).toEqual([])
    expect(phrasesForWord(c, state, c.words.get('wo'), 1)).toHaveLength(1)
  })

  it('derives the counts per word from the flat list: a phrase is one entry that counts for each word it lists', () => {
    const c = curriculum2()
    const state = emptyState()
    addPhrase(c, state, { zh: '我喝茶吗。', py: 'wǒ hē chá ma', en: 'Do I drink tea?', words: ['wo', 'he', 'cha'], source: 'ai', checked: true })
    addPhrase(c, state, { zh: '我是学生吗。', py: 'wǒ shì xué sheng ma', en: 'Am I a student?', words: ['wo', 'shi', 'xs'], source: 'ai', checked: true })
    expect(state.phrases).toHaveLength(2)
    expect(Object.fromEntries(wordCounts(state))).toEqual({ wo: 2, he: 1, cha: 1, shi: 1, xs: 1 })
    expect(addPhrase(c, state, { zh: '我是学生吗。', py: 'x', en: 'x', words: ['wo'], source: 'ai', checked: true })).toBeUndefined() // each phrase appears once
  })

  it('does not write again what is already in hand for another word, and tells the writer what the batch has', async () => {
    const c = curriculum2()
    const { calls, fetchImpl } = endpoint({
      strong: approve,
      cheap: () => ({ phrases: [sentence('cha', '我喝茶吗。', 'wǒ hē chá ma', 'Do I drink tea?'), sentence('cha', '你喝茶。', 'nǐ hē chá', 'You drink tea.')] }),
    })
    const options = { ...runOptions({ lookahead: [0], target: 3 }), words: ['cha', 'he'] }
    const state = emptyState()
    await runPipeline({ curriculum: c, state, io: createIO(options, fetchImpl as never), options })
    expect(calls.filter(call => call.model === 'cheap')).toHaveLength(1) // one write for both words
    expect(calls.find(call => call.model === 'cheap')!.text).toContain('我喝茶。') // the catalog phrase is in "avoid"
    expect(state.phrases.map(p => p.zh).sort()).toEqual(['你喝茶。', '我喝茶吗。'].sort()) // stored once, though two words use them
    expect(zhOf(state, 'he').sort()).toEqual(['你喝茶。', '我喝茶吗。'].sort())
    expect(state.words.he.status).toBe('done')
    expect(state.words.cha.status).toBe('done')
  })
})


// ---------------------------------------------------------------- grammar, ids, files

const point = (lb: string, pt: string, ds: string) => ({ id: lb, lb, pt, pr: pt, ds, ex: { segments: [{ word: 'wo' }], translation: '', grammar: [lb] } })
const gunit = (ref: string) => ({ kind: 'grammar', ref })
const FIXTURE3 = [
  { ...band('1', [word('wo', '我', 'wǒ', 'I; me'), word('shi', '是', 'shì', 'to be'), word('xs', '学生', 'xué sheng', 'student'), word('cha', '茶', 'chá', 'tea'), word('he', '喝', 'hē', 'to drink')], [
    { id: 'g1', units: [unit('wo'), unit('shi'), unit('xs'), gunit('g-shi')], examples: [] },
    { id: 'g2', units: [unit('cha'), unit('he'), gunit('g-ma')], examples: [] },
    { id: 'g3', units: [gunit('g-late')], examples: [] },
  ]), grammar: [point('g-shi', 'S + 是 + N', 'Identity.'), point('g-ma', 'S + V + 吗', 'Yes/no question.'), point('g-late', 'late pattern', 'Later.')] },
  ...['2', '3', '4', '5', '6'].map(name => band(name, [], [])),
]
const curriculum3 = () => buildCurriculum(FIXTURE3)
const mine = (zh: string, words: string[], grammar: string[] = [], extra: object = {}) => ({ zh, py: 'x', en: 'x', words, grammar, source: 'ai', checked: true, ...extra })

describe('phrase bank pipeline: grammar tags', () => {
  it('lists the grammar of the window to the writer, newest lesson first, and only what the lesson window reaches', () => {
    const c = curriculum3()
    expect(c.grammarOrdered.map((p: { lb: string }) => p.lb)).toEqual(['g-shi', 'g-ma', 'g-late'])
    expect(grammarFor(c, c.words.get('cha'), 0).map((g: { lesson: number; points: { ref: string }[] }) => [g.lesson, g.points.map(p => p.ref)])).toEqual([[2, ['g-ma']], [1, ['g-shi']]])
    expect(grammarFor(c, c.words.get('wo'), 0).map((g: { lesson: number }) => g.lesson)).toEqual([1])
    expect(grammarFor(c, c.words.get('wo'), 2).map((g: { lesson: number }) => g.lesson)).toEqual([3, 2, 1])
  })

  it('keeps only real grammar refs in the window: others are dropped by code, whoever tagged them', () => {
    const c = curriculum3()
    const wo = c.words.get('wo')
    const raw = { ref: 'wo', zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.', grammar: ['g-shi', 'g-ma', 'made-up', 'g-shi', 7] }
    expect(validatePhrase(c, wo, raw, allowedFor(c, wo, 0)).phrase?.grammar).toEqual(['g-shi']) // g-ma is lesson 2, outside window 0
    expect(validatePhrase(c, wo, raw, allowedFor(c, wo, 1)).phrase?.grammar).toEqual(['g-shi', 'g-ma'])
    expect(validatePhrase(c, wo, { ...raw, grammar: undefined }, allowedFor(c, wo, 0)).phrase?.grammar).toEqual([])
    const phrase = validatePhrase(c, wo, raw, allowedFor(c, wo, 1)).phrase
    expect(applyGrammar(c, phrase, ['g-ma', 'g-late'], allowedFor(c, wo, 1)).grammar).toEqual(['g-ma']) // g-late is lesson 3
  })

  it('counts grammar in readyAt: ready by the lesson of the last of its words and its grammar points', () => {
    const c = curriculum3()
    const wo = c.words.get('wo')
    const plain = validatePhrase(c, wo, { ref: 'wo', zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.', grammar: ['g-shi'] }, allowedFor(c, wo, 1)).phrase
    expect(plain.readyAt).toBe(0) // words and grammar are all lesson 1
    const later = validatePhrase(c, wo, { ref: 'wo', zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.', grammar: ['g-shi', 'g-ma'] }, allowedFor(c, wo, 1)).phrase
    expect(later.readyAt).toBe(1) // the words are lesson 1 but g-ma comes in lesson 2
  })

  it('has the writer tag phrases and the checker confirm, add or drop tags, with code checking both against the window', async () => {
    const c = curriculum3()
    const { calls, fetchImpl } = endpoint({
      strong: call => ({ results: [...call.text.matchAll(/"id":"([^"]+)"/g)].map(match => ({ id: match[1], natural: true, matches: true, reason: '', grammar: match[1].includes('是') ? [] : ['g-ma', 'not-real', 'g-late'] })) }),
      cheap: () => ({ phrases: [{ ...sentence('cha', '我喝茶。', 'wǒ hē chá', 'I drink tea.'), grammar: ['g-shi'] }, { ...sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.'), grammar: ['g-shi'] }] }),
    })
    const options = { ...runOptions({ lookahead: [0], target: 2 }), words: ['cha'] }
    const state = emptyState()
    await runPipeline({ curriculum: c, state, io: createIO(options, fetchImpl as never), options })
    const writer = calls.find(call => call.model === 'cheap')!
    expect(writer.text).toContain('"grammar":[{"lesson":2')
    expect(writer.text).toContain('g-shi')
    expect(state.phrases.find(p => p.zh === '我是茶。')).toMatchObject({ grammar: [], readyAt: 1 }) // the checker dropped the tag; 茶 is a lesson 2 word
    expect(state.phrases.find(p => p.zh === '我喝茶。')).toMatchObject({ grammar: ['g-ma'], readyAt: 1 }) // added g-ma, ignored not-real and g-late (outside the window)
  })
})

describe('phrase bank pipeline: grammar points are targets', () => {
  it('selects grammar points under the target like words, by the lesson that introduces them, mixed into the words\' order', () => {
    const c = curriculum3()
    const entries = selectWords({ curriculum: c, state: emptyState(), options: { ...runOptions(), target: 3 }, lookahead: 0 })
    expect(entries.map(entry => entry.word.lb)).toEqual(['wo', 'shi', 'xs', 'grammar:g-shi', 'cha', 'he', 'grammar:g-ma', 'grammar:g-late'])
    expect(entries.find(entry => entry.word.lb === 'grammar:g-ma')).toMatchObject({ need: 3, word: { index: 1 } })
    expect(grammarInScope(c, { lessons: { from: 2, to: 2 } }).map((word: { lb: string }) => word.lb)).toEqual(['grammar:g-ma'])
    expect(grammarInScope(c, { words: ['wo'] })).toEqual([]) // --words alone leaves grammar out
    expect(wordsInScope(c, { grammar: ['g-ma'] })).toEqual([]) // --grammar alone leaves words out
    expect(grammarInScope(c, { grammar: ['g-ma'] })).toHaveLength(1)
    expect(batchByLesson(entries, 20, 1).map(batch => batch.map(entry => entry.word.lb))).toEqual([['wo', 'shi', 'xs', 'grammar:g-shi', 'cha', 'he', 'grammar:g-ma'], ['grammar:g-late']])
  })

  it('credits phrases in hand to every grammar point they are tagged with, before anything is written', () => {
    const c = curriculum3()
    const state = emptyState()
    addPhrase(c, state, mine('我是学生。', ['wo', 'shi', 'xs'], ['g-shi']))
    addPhrase(c, state, mine('我是我。', ['wo', 'shi'], ['g-shi']))
    addPhrase(c, state, mine('学生是我。', ['xs', 'shi', 'wo'], ['g-shi']))
    expect(Object.fromEntries(grammarCounts(state))).toEqual({ 'g-shi': 3 })
    const options = { ...runOptions(), target: 3 }
    const entries = selectWords({ curriculum: c, state, options, lookahead: 0 })
    expect(entries.map(entry => entry.word.lb)).not.toContain('grammar:g-shi') // reached its target from phrases in hand
    expect(phrasesForWord(c, state, grammarWord(c.grammar.get('g-shi')), 0)).toHaveLength(3)
    expect(entries.find(entry => entry.word.lb === 'xs')).toMatchObject({ need: 1 }) // and they count for the words they use
    // a tagged phrase counts only once its window reaches it: g-ma is lesson 2, a phrase tagged with it is not ready for g-shi's lesson
    addPhrase(c, state, mine('我喝茶吗。', ['wo', 'he', 'cha'], ['g-ma']))
    expect(phrasesForWord(c, state, grammarWord(c.grammar.get('g-ma')), 0)).toHaveLength(1)
    expect(phrasesForWord(c, state, grammarWord(c.grammar.get('g-shi')), 0)).toHaveLength(3)
  })

  it('writes for an under-target grammar point: the construct is asked for, tagged, and the phrase also counts for the words it uses', async () => {
    const c = curriculum3()
    const { calls, fetchImpl } = endpoint({
      strong: approve,
      cheap: () => ({ phrases: [
        { ...sentence('grammar:g-shi', '老师是学生。', 'lǎo shī shì xué sheng', 'The teacher is a student.'), grammar: ['g-shi'] },
        { ...sentence('grammar:g-shi', '我是学生。', 'wǒ shì xué sheng', 'I am a student.'), grammar: [] }, // does not use the construct as tagged: refused for the point
        { ...sentence('grammar:g-shi', '我是我。', 'wǒ shì wǒ', 'I am me.'), grammar: ['g-shi'] },
      ] }),
    })
    const options = { ...runOptions({ lookahead: [0], target: 2 }), grammar: ['g-shi'] }
    const state = emptyState()
    const log: string[] = []
    await runPipeline({ curriculum: c, state, io: createIO(options, fetchImpl as never), options, log: line => log.push(line) })
    const writer = calls.find(call => call.model === 'cheap')!
    expect(writer.text).toContain('"construct":"g-shi"')
    expect(writer.text).toContain('use that construct naturally')
    expect(state.phrases.map(p => p.zh)).toEqual(['我是我。']) // 老师 is not in the vocabulary of lesson 1, 我是学生。 is not tagged
    expect(log.join('\n')).toContain('uses a word not yet learned')
    expect(log.join('\n')).toContain('does not use the grammar point')
    expect(state.phrases[0]).toMatchObject({ id: 1, band: '1', grammar: ['g-shi'], words: ['wo', 'shi'] })
    expect(state.words['grammar:g-shi']).toMatchObject({ status: 'partial' })
    expect(zhOf(state, 'shi')).toEqual(['我是我。']) // credited to the words it uses
  })

  it('reports grammar coverage next to the words, per pass, and the grammar points still without phrases', () => {
    const c = curriculum3()
    const state = emptyState()
    addPhrase(c, state, mine('我是学生。', ['wo', 'shi', 'xs'], ['g-shi'], { lookahead: 0 }))
    const report = passReport(c, state, { ...runOptions(), lookahead: [0, 2], target: 1 })
    expect(report).toMatchObject({ words: 5, grammarPoints: 3 })
    expect(report.passes).toEqual([
      { lookahead: 0, reached: 3, newlyReached: 3, of: 5, grammar: { reached: 1, newlyReached: 1, of: 3 } },
      { lookahead: 2, reached: 3, newlyReached: 0, of: 5, grammar: { reached: 1, newlyReached: 0, of: 3 } },
    ])
    expect(report.zeroGrammar).toBe(2)
    expect(report.zeroGrammarPoints).toEqual(['S + V + 吗 (g-ma, lesson 2)', 'late pattern (g-late, lesson 3)'])
    expect(report.zeroPhraseWords).toEqual(['茶 (cha, lesson 2)', '喝 (he, lesson 2)'])
  })
})

describe('phrase bank pipeline: ids and the YAML files', () => {
  it('gives ids from 1 in each band, the next number after the highest, never changes one and never reuses a dropped one', () => {
    const c = curriculum3()
    const dir = temp()
    const state = emptyState()
    addPhrase(c, state, mine('我是学生。', ['wo', 'shi', 'xs']))
    addPhrase(c, state, mine('我是我。', ['wo', 'shi']))
    addPhrase(c, state, mine('我喝茶。', ['wo', 'he', 'cha']))
    expect(state.phrases.map(p => [p.zh, p.id, p.band])).toEqual([['我是学生。', 1, '1'], ['我是我。', 2, '1'], ['我喝茶。', 3, '1']])
    writeOutputs(dir, buildOutputs(c, state))
    // a re-run that drops the last phrase (checker or a person) and adds one: the dropped id stays retired
    const second = emptyState()
    attachPhrases(c, second, dir)
    expect(second.phrases.map(p => p.id)).toEqual([1, 2, 3])
    second.phrases = second.phrases.filter(p => p.zh !== '我喝茶。')
    writeOutputs(dir, buildOutputs(c, second))
    expect(readPhraseBand(dir, '1')).toMatchObject({ lastId: 3, phrases: [{ id: 1 }, { id: 2 }] })
    const third = emptyState()
    attachPhrases(c, third, dir)
    addPhrase(c, third, mine('你喝茶。', ['ni', 'he', 'cha']))
    addPhrase(c, third, mine('茶是我的。', ['cha', 'wo']))
    expect(third.phrases.map(p => [p.zh, p.id])).toEqual([['我是学生。', 1], ['我是我。', 2], ['你喝茶。', 4], ['茶是我的。', 5]])
    // a phrase dropped by hand from the YAML (lastId stays in the file) does not free its id either; an existing id never changes
    const edited = readFileSync(join(dir, 'hsk-1.yaml'), 'utf8')
    expect(edited).toContain('lastId: 3')
    expect(readPhraseBands(dir)[0].phrases.map(p => p.id)).toEqual([1, 2])
  })

  it('runs a pipeline that adds phrases to a band file that already has some, keeping their ids', async () => {
    const c = curriculum2()
    const dir = temp()
    mkdirSync(join(dir, 'data'))
    FIXTURE2.forEach(data => writeFileSync(join(dir, 'data', 'hsk-' + data.band + '.generated.json'), JSON.stringify(data)))
    const args = (words: string) => ['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--lookahead', '0', '--target', '3', '--words', words, '--data-dir', join(dir, 'data'), '--out', join(dir, 'yaml'), '--json-out', join(dir, 'json'), '--state', join(dir, 'state.json')]
    const first = endpoint({ strong: approve, cheap: () => ({ phrases: [sentence('cha', '我是茶。', 'wǒ shì chá', 'I am tea.'), sentence('cha', '茶是我的。', 'chá shì wǒ de', 'The tea is mine.')] }) })
    await main(args('cha'), { fetchImpl: first.fetchImpl as never, log: () => {} })
    expect(readPhraseBand(join(dir, 'yaml'), '1').phrases.map(p => [p.id, p.zh])).toEqual([[1, '我是茶。'], [2, '茶是我的。']])
    // the person drops id 1 by hand, then more words are run
    const text = readFileSync(join(dir, 'yaml', 'hsk-1.yaml'), 'utf8')
    const file = parsePhraseYaml(text, '1')
    writeFileSync(join(dir, 'yaml', 'hsk-1.yaml'), stringifyPhraseYaml({ ...file, phrases: file.phrases.filter(p => p.id !== 1) }))
    const second = endpoint({ strong: approve, cheap: () => ({ phrases: [sentence('he', '我喝茶吗。', 'wǒ hē chá ma', 'Do I drink tea?'), sentence('he', '你喝茶。', 'nǐ hē chá', 'You drink tea.')] }) })
    await main(args('he'), { fetchImpl: second.fetchImpl as never, log: () => {} })
    const ids = readPhraseBand(join(dir, 'yaml'), '1').phrases.map(p => [p.id, p.zh])
    expect(ids.find(([, zh]) => zh === '茶是我的。')).toEqual([2, '茶是我的。']) // existing id kept
    expect(ids.map(([id]) => id)).toEqual([2, 3, 4]) // 1 stays retired
    expect(c.words.size).toBeGreaterThan(0)
  })

  it('round-trips through YAML: one block per phrase, Chinese unescaped, words and grammar as flow lists, book and media sources with a ref', () => {
    const phrases = [
      { id: 1, zh: '他不是学生。', py: 'tā bú shì xué sheng', en: 'He is not a student.', words: ['ta1--he', 'bu4--not'], grammar: ['s-shi4-n--identity'], source: 'ai', checked: true, lookahead: 0, readyAt: 43 },
      { id: 2, zh: '你好吗？', py: 'nǐ hǎo ma?', en: 'How are you? (a: b)', words: ['ni3--you'], source: 'ai', checked: false },
      { id: 7, zh: '请坐。', py: 'qǐng zuò', en: 'Please sit.', words: ['qing3--please'], source: 'book', ref: { title: '汉语 Reader', chapter: 3, page: 12 }, checked: false },
      { id: 8, zh: '谢谢你。', py: 'xiè xie nǐ', en: 'Thank you.', words: ['xie4--thank'], source: 'media', ref: { title: 'Episode', timestamp: '00:12:30' }, checked: true },
    ]
    const text = stringifyPhraseYaml({ band: '1', lastId: 9, phrases })
    expect(text).toContain('zh: 他不是学生。')
    expect(text).not.toMatch(/\\u/)
    expect(text).toMatch(/words: \[ta1--he, bu4--not\]/)
    expect(text).toMatch(/grammar: \[s-shi4-n--identity\]/)
    expect(text.match(/^ {2}- id: /gm)).toHaveLength(4)
    const back = parsePhraseYaml(text, '1')
    expect(back).toEqual({ band: '1', lastId: 9, phrases })
    expect(stringifyPhraseYaml(back)).toBe(text) // stable
    expect(() => parsePhraseYaml(text, '2')).toThrow(/band 1/)
    expect(() => parsePhraseYaml(text.replace('id: 2', 'id: 1'), '1')).toThrow(/Duplicate phrase id/)
    expect(() => parsePhraseYaml(text.replace('source: media', 'source: tweet'), '1')).toThrow(/Invalid phrase file/)
  })

  it('generates the app JSON from the YAML: the same phrases in id order, per band; the checked-in JSON matches the checked-in YAML', () => {
    const dir = temp()
    const phrases = [{ id: 2, zh: '我是茶。', py: 'wǒ shì chá', en: 'I am tea.', words: ['wo', 'shi', 'cha'], grammar: ['g-shi'], source: 'ai', checked: true, readyAt: 1 }, { id: 1, zh: '我是我。', py: 'wǒ shì wǒ', en: 'I am me.', words: ['wo', 'shi'], source: 'ai', checked: false }]
    writePhraseBands([{ band: '1', lastId: 2, phrases }], { authoringDir: join(dir, 'yaml') })
    const outputs = phraseBankOutputs(join(dir, 'yaml'), join(dir, 'json'))
    expect(outputs.map(([path]) => path.split(/[\\/]/).pop())).toEqual(['hsk-1.json', 'hsk-2.json', 'hsk-3.json', 'hsk-4.json', 'hsk-5.json', 'hsk-6.json', 'index.json'])
    const one = JSON.parse(outputs[0][1].toString())
    expect(one).toEqual({ schemaVersion: 2, band: '1', phrases: [phrases[1], phrases[0]] })
    expect(outputs[1][1].toString()).toBe(JSON.stringify({ schemaVersion: 2, band: '2', phrases: [] }) + '\n')
    expect(outputs[0][1].toString()).toBe(phraseJsonText({ band: '1', phrases }))
    // the repository's own files
    for (const [path, expected] of phraseBankOutputs()) expect(readFileSync(path, 'utf8')).toBe(expected.toString())
  })

  it('refuses a phrase listed in two bands', () => {
    const dir = temp()
    const one = { id: 1, zh: '我是我。', py: 'x', en: 'x', words: ['wo'], source: 'ai', checked: true }
    writePhraseBands([{ band: '1', lastId: 1, phrases: [one] }, { band: '2', lastId: 1, phrases: [one] }], { authoringDir: dir })
    expect(() => readPhraseBands(dir)).toThrow(/each phrase appears once/)
  })
})

describe('phrase bank pipeline: the old format', () => {
  const OLD_BANK = { schemaVersion: 1, band: '1', phrases: { cha: [{ zh: '我是茶。', py: 'wǒ shì chá', en: 'I am tea.', words: ['wo', 'shi', 'cha'], source: 'ai', checked: true, lookahead: 0, readyAt: 1 }], he: [{ zh: '我是茶。', py: 'wǒ shì chá', en: 'I am tea.', words: ['wo', 'shi', 'cha'], source: 'ai', checked: true }, { zh: '我喝茶吗。', py: 'wǒ hē chá', en: 'I drink tea.', words: ['wo', 'he', 'cha'], source: 'ai', checked: false }] } }
  const OLD_STATE = { version: 1, target: 3, words: { cha: { status: 'done', attempts: 1, lookahead: 0, phrases: OLD_BANK.phrases.cha }, he: { status: 'partial', attempts: 2, phrases: OLD_BANK.phrases.he } } }

  it('reads an old band file or state file, keyed by word, as one flat list in which each phrase comes once', () => {
    expect(readOldBank(OLD_BANK).map(p => p.zh)).toEqual(['我是茶。', '我喝茶吗。'])
    expect(isOldState(OLD_STATE)).toBe(true)
    expect(isOldState({ version: 2, words: {} })).toBe(false)
    const old = readOldState(OLD_STATE)
    expect(old.phrases.map(p => p.zh)).toEqual(['我是茶。', '我喝茶吗。'])
    expect(old.words).toEqual({ cha: { status: 'done', attempts: 1, lookahead: 0 }, he: { status: 'partial', attempts: 2 } })
  })

  it('converts an old state file on load, and imports an old bank file into the YAML with ids', async () => {
    const dir = temp()
    saveStateRaw(join(dir, 'old-state.json'), OLD_STATE)
    const loaded = loadState(join(dir, 'old-state.json'))
    expect(loaded.phrases.map((p: { zh: string }) => p.zh)).toEqual(['我是茶。', '我喝茶吗。'])
    expect(loaded.words.he).toEqual({ status: 'partial', attempts: 2 })
    mkdirSync(join(dir, 'data'))
    FIXTURE2.forEach(data => writeFileSync(join(dir, 'data', 'hsk-' + data.band + '.generated.json'), JSON.stringify(data)))
    writeFileSync(join(dir, 'old-bank.json'), JSON.stringify(OLD_BANK))
    const log: string[] = []
    await main(['--import-old', join(dir, 'old-bank.json'), '--data-dir', join(dir, 'data'), '--out', join(dir, 'yaml'), '--json-out', join(dir, 'json'), '--state', join(dir, 'state.json')], { log: line => log.push(line) })
    expect(log[0]).toContain('imported 2 phrases')
    expect(readPhraseBand(join(dir, 'yaml'), '1').phrases).toEqual([
      expect.objectContaining({ id: 1, zh: '我是茶。', readyAt: 1 }), expect.objectContaining({ id: 2, zh: '我喝茶吗。', readyAt: 1 }),
    ])
    expect(JSON.parse(readFileSync(join(dir, 'json', 'hsk-1.json'), 'utf8')).phrases).toHaveLength(2)
  })
})

const saveStateRaw = (file: string, state: unknown) => writeFileSync(file, JSON.stringify(state))

const PY_WORDS = [word('xx', '谢谢', 'xiè xie', 'thanks'), word('xs', '学生', 'xué sheng', 'student'), word('gx', '没关系', 'méi guān xi', 'never mind'), word('bu', '不', 'bù', 'not'),
  word('kq', '客气', 'kè qi', 'polite'), word('yi', '一', 'yī', 'one'), word('dr', '点儿', 'diǎn r', 'a bit'), word('you', '有', 'yǒu', 'to have'), word('leng', '冷', 'lěng', 'cold'),
  word('ni', '你', 'nǐ', 'you'), word('nm', '你们', 'nǐ men', 'you all'), word('ge', '个', 'gè', 'measure'), word('ren', '人', 'rén', 'person')]
const PY_BANDS = [band('1', PY_WORDS, [{ id: 'g1', units: PY_WORDS.map(w => unit(w.lb)), examples: [] }]), ...['2', '3', '4', '5', '6'].map(name => band(name, [], []))]
const pyCurriculum = () => buildCurriculum(PY_BANDS)

describe('pinyin set by code', () => {
  it('keeps the neutral tones of catalog words', () => {
    const c = pyCurriculum()
    expect(phrasePinyin('谢谢你们。', c)).toBe('xiè xie nǐ men')
    expect(phrasePinyin('学生', c)).toBe('xué sheng')
    expect(phrasePinyin('没关系，', c)).toBe('méi guān xi')
  })

  it('applies 一 and 不 tone changes across word boundaries, joins 儿, drops punctuation', () => {
    const c = pyCurriculum()
    expect(phrasePinyin('不客气！', c)).toBe('bú kè qi')
    expect(phrasePinyin('你有一点儿冷。', c)).toBe('nǐ yǒu yì diǎnr lěng')
    expect(phrasePinyin('一个人', c)).toBe('yí gè rén')
    expect(phrasePinyin('不冷', c)).toBe('bù lěng')
    expect(phrasePinyin('一', c)).toBe('yī')
    expect(phrasePinyin('学生，没关系。有？', c)).not.toMatch(/[，。,.?!？！]/)
    expect(phrasePinyin('有点儿', c)).toBe('yǒu diǎnr')
    expect(phrasePinyin('女儿', buildCurriculum([band('1', [word('nv', '女儿', 'nǚ ér', 'daughter'), ...PY_WORDS], []), ...['2', '3', '4', '5', '6'].map(name => band(name, [], []))]))).toBe('nǚ ér')
  })

  it('refuses a phrase the catalog words do not cover, and every syllable is from the catalog', () => {
    const c = pyCurriculum()
    expect(() => phrasePinyin('谢谢汉语', c)).toThrow('not covered by catalog words: 汉 语')
    expect(phrasePinyin('不好'.replace('好', '有'), c)).toBe('bù yǒu')
    expect(phrasePinyin('不冷', c)).toBe('bù lěng')
    expect(validatePhrase(curriculum(), curriculum().words.get('wo'), { ref: 'wo', zh: '我喝酒。', en: 'I drink.' }, allowedFor(curriculum(), curriculum().words.get('wo'), 0)).reason).toBeTruthy()
  })

  it('validates a writer phrase without pinyin, and ignores pinyin it gives', () => {
    const c = curriculum(), wo = c.words.get('wo')
    const ok = validatePhrase(c, wo, { ref: 'wo', zh: '我是学生。', en: 'I am a student.' }, allowedFor(c, wo, 0)).phrase
    expect(ok).toMatchObject({ zh: '我是学生。', py: 'wǒ shì xué sheng' })
    expect(validatePhrase(c, wo, { ref: 'wo', zh: '我是学生。', py: 'bad, 。', en: 'I am a student.' }, allowedFor(c, wo, 0)).phrase?.py).toBe(ok?.py)
  })

  it('--repinyin resets every phrase of a fixture and stops', async () => {
    const dir = temp(), yaml = join(dir, 'yaml'), json = join(dir, 'json')
    mkdirSync(join(dir, 'data'))
    PY_BANDS.forEach(data => writeFileSync(join(dir, 'data', 'hsk-' + data.band + '.generated.json'), JSON.stringify(data)))
    const phrase = { id: 1, zh: '不客气！', py: 'bù kè qi!', en: 'x', words: ['bu'], source: 'ai' as const, checked: true }
    const other = { id: 2, zh: '你有一点儿冷。', py: 'nǐ yǒu yī diǎn r lěng.', en: 'y', words: ['you'], source: 'ai' as const, checked: true }
    writePhraseBands([{ band: '1', lastId: 5, phrases: [phrase, other] }], { authoringDir: yaml })
    const log: string[] = []
    await main(['--repinyin', '--out', yaml, '--json-out', json, '--data-dir', join(dir, 'data'), '--state', join(dir, 'state.json')], { log: line => log.push(line) })
    expect(log).toEqual(['pinyin reset in 2 phrases of 1 band files'])
    const result = readPhraseBand(yaml, '1')
    expect(result.lastId).toBe(5)
    expect(result.phrases.map((p: { py: string }) => p.py)).toEqual(['bú kè qi', 'nǐ yǒu yì diǎnr lěng'])
    expect(JSON.parse(readFileSync(join(json, 'hsk-1.json'), 'utf8')).phrases[1].py).toBe('nǐ yǒu yì diǎnr lěng')
    expect(repinyinFiles([result], pyCurriculum())).toEqual([])
  })

  it('--repinyin reports an uncovered phrase and fails without writing', async () => {
    const dir = temp(), yaml = join(dir, 'yaml')
    mkdirSync(join(dir, 'data'))
    PY_BANDS.forEach(data => writeFileSync(join(dir, 'data', 'hsk-' + data.band + '.generated.json'), JSON.stringify(data)))
    const good = { id: 1, zh: '不客气！', py: 'old', en: 'x', words: ['bu'], source: 'ai' as const, checked: true }
    const bad = { id: 2, zh: '谢谢汉语。', py: 'old', en: 'y', words: ['xx'], source: 'ai' as const, checked: true }
    writePhraseBands([{ band: '1', lastId: 5, phrases: [good, bad] }], { authoringDir: yaml })
    await expect(main(['--repinyin', '--out', yaml, '--json-out', join(dir, 'json'), '--data-dir', join(dir, 'data'), '--state', join(dir, 'state.json')], { log: () => {} })).rejects.toThrow(/hsk-1 phrase 2 谢谢汉语。: not covered by catalog words: 汉 语/)
    expect(readPhraseBand(yaml, '1').phrases[0].py).toBe('old')
  })
})

describe('phrase index', () => {
  it('matches the shipped band files', () => {
    const bands = ['1', '2', '3', '4', '5', '6'].map(name => JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'phrases', 'hsk-' + name + '.json'), 'utf8')))
    const index = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'phrases', 'index.json'), 'utf8'))
    expect(Object.keys(index.bands)).toEqual(bands.map(file => file.band))
    for (const file of bands) {
      const words: Record<string, number> = {}
      for (const phrase of file.phrases) for (const word of new Set<string>(phrase.words)) words[word] = (words[word] ?? 0) + 1
      expect(index.bands[file.band].count).toBe(file.phrases.length)
      expect(index.bands[file.band].words).toEqual(words)
    }
    expect(phraseIndexText(bands)).toBe(readFileSync(join(__dirname, '..', 'src', 'data', 'phrases', 'index.json'), 'utf8'))
    expect(phraseIndex([{ band: '1', phrases: [{ words: ['a', 'a', 'b'] }, { words: ['a'] }] }]).bands['1']).toEqual({ count: 2, words: { a: 2, b: 1 } })
  })
})

describe('phrase bank pipeline: one sentence once', () => {
  it('refuses a phrase that repeats another or a lesson example apart from punctuation and spaces', () => {
    const c = curriculum()
    const state = emptyState()
    const base = { py: 'x', en: 'x', words: ['wo', 'shi', 'xs'], source: 'ai', checked: true }
    expect(addPhrase(c, state, { ...base, zh: '\u6211\u662f\u8336\u3002' })).toBeTruthy()
    expect(addPhrase(c, state, { ...base, zh: '\u6211\u662f \u8336\uff01' })).toBeUndefined()
    const lesson = [...lessonKeys(c)][0]
    expect(addPhrase(c, state, { ...base, zh: lesson + '\uff01' })).toBeUndefined()
    expect(state.phrases).toHaveLength(1)
  })
  it('compares the same key as the app', () => {
    for (const zh of ['\u73b0\u5728\u592a\u665a\u4e86\uff01', 'a \u4f60\u597d, \u4e16\u754c.', '']) expect(phraseKey(zh)).toBe(appPhraseKey(zh))
  })
})
