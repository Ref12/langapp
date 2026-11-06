// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FUNCTION_CHARACTERS as APP_FUNCTION_CHARACTERS } from '../src/core/drills/content'
import {
  BANDS, FUNCTION_CHARACTERS, buildCurriculum, buildOutputs, catalogPhrases, coverageReport, createIO, emptyState, loadState, main, parseArgs, parseJSONReply, replyText,
  runPipeline, saveState, selectWords, validatePhrase, writeOutputs,
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
const OPTIONS = (extra: object = {}) => parseArgs(['--base-url', 'http://gateway/v1', '--planner-model', 'strong', '--writer-model', 'cheap', '--checker-model', 'strong', '--planner-api', 'chat', '--writer-api', 'responses', '--checker-api', 'chat', '--target', '3', ...Object.entries(extra).flatMap(([key, value]) => [key, String(value)])], {})
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
    const run = { ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--no-plan', '--target', '4'], {}), words: ['cha'], batchSize: 20 }
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
    const run = { ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'cheap', '--checker-model', 'strong', '--no-plan'], {}), words: ['cha'], batchSize: 20 }
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
    const args = ['--base-url', 'http://gateway/v1', '--planner-model', 'strong', '--writer-model', 'cheap', '--words', 'cha', '--data-dir', join(dir, 'data'), '--out', join(dir, 'out'), '--state', join(dir, 'state.json')]
    await main(args, { fetchImpl: fetchImpl as never, log: line => log.push(line) })
    expect(JSON.parse(readFileSync(join(dir, 'out', 'hsk-1.json'), 'utf8')).phrases.cha).toHaveLength(2)
    expect(log.at(-1)).toContain('done 1')
    const before = log.length
    await main(args, { fetchImpl: (async () => { throw new Error('no calls expected on a re-run') }) as never, log: line => log.push(line) })
    expect(log.slice(before).join('\n')).toContain('0 words need phrases')
  })
})
