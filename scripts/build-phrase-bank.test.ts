// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FUNCTION_CHARACTERS as APP_FUNCTION_CHARACTERS } from '../src/core/drills/content'
import {
  BANDS, FUNCTION_CHARACTERS, allowedFor, batchByLesson, buildCurriculum, buildOutputs, catalogPhrases, coverageReport, createIO, creditPhrases, emptyState, loadState, main, parseArgs, parseJSONReply,
  parseLessons, passReport, replyText, runPipeline, saveState, selectWords, validatePhrase, verdictOf, vocabularyFor, wordsInScope, writeOutputs,
} from './build-phrase-bank.mjs'

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
    expect(coverageReport(c).fitByLesson).toEqual({ zero: 1, oneOrTwo: 5, threePlus: 0 })
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
    expect(state.words.cha.phrases.map(p => p.zh)).toEqual(['我是茶。', '茶是我的。'])
    expect(state.words.cha.phrases.every(p => p.checked)).toBe(true)
    expect(state.words.cha.status).toBe('done') // 1 catalog + 2 written
    expect(state.words.he.phrases).toHaveLength(2) // limited to what the word still needed
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
    expect(state.words.cha.phrases.map(p => p.zh)).toEqual(['我是茶。']) // the failing one was rewritten badly and dropped
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
    expect(state.words.cha.phrases).toEqual([expect.objectContaining({ zh: '我是茶。', checked: false })])
    expect(log.some(line => line.includes('check failed'))).toBe(true)
  })

  it('is resumable: a word that is done is skipped, and failed words come back with --retry', async () => {
    const c = curriculum()
    const options = { ...OPTIONS(), words: undefined, bands: ['1'], batchSize: 20, retry: false }
    const state = emptyState()
    state.words.cha = { status: 'done', phrases: [], attempts: 1 }
    state.words.he = { status: 'failed', phrases: [], attempts: 1, note: 'write failed' }
    expect(selectWords({ curriculum: c, state, options }).map(entry => entry.word.lb)).not.toContain('cha')
    expect(selectWords({ curriculum: c, state, options }).map(entry => entry.word.lb)).not.toContain('he')
    expect(selectWords({ curriculum: c, state, options: { ...options, retry: true } }).map(entry => entry.word.lb)).toContain('he')
  })
})

describe('phrase bank pipeline: files and options', () => {
  it('writes one file per band from the state, and the state round-trips', () => {
    const c = curriculum()
    const state = emptyState()
    state.words.cha = { status: 'done', attempts: 1, phrases: [{ zh: '我是茶。', py: 'wǒ shì chá', en: 'I am tea.', words: ['wo', 'shi', 'cha'], source: 'ai', checked: true }] }
    const dir = temp()
    writeOutputs(join(dir, 'out'), buildOutputs(c, state))
    for (const name of BANDS) expect(JSON.parse(readFileSync(join(dir, 'out', 'hsk-' + name + '.json'), 'utf8')).band).toBe(name)
    expect(JSON.parse(readFileSync(join(dir, 'out', 'hsk-1.json'), 'utf8')).phrases.cha).toEqual([{ zh: '我是茶。', py: 'wǒ shì chá', en: 'I am tea.', words: ['wo', 'shi', 'cha'], source: 'ai', checked: true }])
    saveState(join(dir, 'state.json'), state)
    expect(loadState(join(dir, 'state.json'))).toEqual(state)
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
    const args = ['--base-url', 'http://gateway/v1', '--planner-model', 'strong', '--plan', '--writer-model', 'cheap', '--words', 'cha', '--data-dir', join(dir, 'data'), '--out', join(dir, 'out'), '--state', join(dir, 'state.json')]
    await main(args, { fetchImpl: fetchImpl as never, log: line => log.push(line) })
    expect(JSON.parse(readFileSync(join(dir, 'out', 'hsk-1.json'), 'utf8')).phrases.cha).toHaveLength(2)
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
const curriculum2 = () => buildCurriculum(FIXTURE2)
const forms = (c: ReturnType<typeof curriculum2>, lb: string, lookahead: number) => [...allowedFor(c, c.words.get(lb), lookahead).forms.keys()]
const runOptions = (extra: object = {}) => ({ ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--lookahead', '0,1,2'], {}), batchSize: 20, ...extra })
const checkBody = (text: string) => JSON.parse(text.slice(text.lastIndexOf('{"groups"')))
const approve = (call: Call) => ({ results: [...call.text.matchAll(/"id":"([^"]+)"/g)].map(match => ({ id: match[1], natural: true, matches: true, reason: '' })) })

describe('phrase bank pipeline: look-ahead passes', () => {
  it('widens the window by lesson per pass: pass 0 is the strict rule, pass k reaches k lessons later', () => {
    const c = curriculum2()
    expect(forms(c, 'wo', 0)).toEqual(['我', '是', '学生'])
    expect(forms(c, 'wo', 1)).toEqual(['我', '是', '学生', '茶', '喝'])
    expect(forms(c, 'wo', 2)).toEqual(['我', '是', '学生', '茶', '喝', '坏'])
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
    const byZh = Object.fromEntries(state.words.wo.phrases.map(p => [p.zh, p]))
    expect(byZh['我是学生吗。']).toMatchObject({ lookahead: 0 })
    expect(byZh['我是学生吗。'].readyAt).toBeLessThanOrEqual(0)
    expect(byZh['我的茶。']).toMatchObject({ lookahead: 1, readyAt: 1 })
    expect(log.some(line => line.startsWith('pass look-ahead 0'))).toBe(true)
    expect(log.some(line => line.startsWith('pass look-ahead 1'))).toBe(true)
    // a word at target is not in a later pass
    const full = emptyState()
    full.words.xs = { status: 'done', attempts: 1, phrases: [] }
    expect(selectWords({ curriculum: c, state: full, options: { ...wo, words: ['xs'] }, lookahead: 2 })).toEqual([])
  })

  it('reports per pass how many words reached the target and the words left without phrases', () => {
    const c = curriculum2()
    const report = passReport(c, emptyState(), { ...runOptions(), lookahead: [0, 1], target: 1 })
    expect(report.passes.map(row => [row.lookahead, row.reached])).toEqual([[0, 5], [1, 5]])
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
    const kept = state.words.wo.phrases.map(p => p.zh)
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
    expect(batchByLesson(entries as never, 20, 1).map(batch => batch.map(entry => entry.word.lb))).toEqual([['wo', 'shi', 'xs', 'cha', 'he'], ['huai', 'ai']])
    expect(batchByLesson(entries as never, 2, 1).every(batch => batch.length <= 2)).toBe(true)
  })
})

describe('phrase bank pipeline: crediting a phrase to other words', () => {
  it('credits a phrase in hand to another word that needs phrases and has it in its window, not to words it cannot serve', () => {
    const c = curriculum2()
    const state = Object.assign(emptyState(), { target: 3 })
    const entries = selectWords({ curriculum: c, state, options: { ...runOptions(), words: ['he', 'wo'], target: 3 } })
    const pool = [{ zh: '我喝茶吗。', py: 'wǒ hē chá ma', en: 'Do I drink tea?', words: ['wo', 'he', 'cha'], source: 'ai', checked: true, lookahead: 0, readyAt: 1 }]
    expect(creditPhrases({ curriculum: c, state, entries, pool, lookahead: 0 })).toBe(1) // 喝 (lesson 2) can use it; 我 (lesson 1) cannot at pass 0
    expect(state.words.he.phrases.map(p => p.zh)).toEqual(['我喝茶吗。'])
    expect(state.words.wo).toBeUndefined()
    // at look-ahead 1 it serves 我 too
    const again = selectWords({ curriculum: c, state, options: { ...runOptions(), words: ['wo'], target: 3 }, lookahead: 1 })
    expect(creditPhrases({ curriculum: c, state, entries: again, pool, lookahead: 1 })).toBe(1)
    expect(state.words.wo.phrases[0]).toMatchObject({ zh: '我喝茶吗。', readyAt: 1 })
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
    expect(state.words.he.phrases.map(p => p.zh).sort()).toEqual(['你喝茶。', '我喝茶吗。'].sort())
    expect(state.words.he.status).toBe('done')
    expect(state.words.cha.status).toBe('done')
  })
})
