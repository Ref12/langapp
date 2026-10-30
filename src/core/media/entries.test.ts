import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { saveAIConnection } from '../assistant/store'
import { requestStructuredJSON } from '../ai/structured'
import { resetProfileStorage } from '../../test/profile-storage'
import type { Catalog } from '../study/catalog'
import { addSourceEntriesToKnowledge } from '../study/knowledge'
import { baseOf, collectTokens, entryFrequencies, linkEntries, planLinks, sourceEntryId, validateBatch } from './entries'
import type { MediaLine } from './contracts'
import { saveMedia } from './store'

vi.mock('../ai/structured', () => ({ requestStructuredJSON: vi.fn() }))
const completion = vi.mocked(requestStructuredJSON)

const vocab = (lb: string, ch: string, pr: string, ds: string) => [`vocabulary:${lb}`, { ref: `vocabulary:${lb}`, kind: 'vocabulary', band: '1', record: { lb, ch, pr, ds } }] as const
const catalog = { units: new Map([vocab('ni3', '你', 'nǐ', 'you'), vocab('ban4--half', '半', 'bàn', 'half'), vocab('ban4--partly', '半', 'bàn', 'partly')]) } as unknown as Catalog

/** One line per word, so counts and examples are easy to follow. Unknown words are 词0.. */
const unknown = (count: number) => Array.from({ length: count }, (_, i) => `词${i}`)
function build(words: string[][]) {
  const lines: MediaLine[] = words.map((line, i) => ({ start: i, end: i + 0.9, text: line.join('') + '。' }))
  const tokens = words.map((line, index) => ({ line: index, items: line.map((text, k) => ({ text, pinyin: 'x', meaning: 'g', trailing: k === line.length - 1 ? '。' : '' })) }))
  return { lines, aligned: { sentences: [], tokens, upTo: lines.length, updatedAt: 7 } }
}
async function item(words: string[][]) {
  const { lines, aligned } = build(words)
  const saved = await saveMedia({ url: 'https://example.com/v', title: 'Drama', extractor: 'x', source: 'captions', language: 'zh-Hans', lines } as never)
  await db.mediaItems.update(saved, { aligned })
  return saved
}
/** A fake model: every word it is asked about is a real word, except those in `skip`; multi-sense words take their first sense. */
function model(skip: string[] = []) {
  completion.mockImplementation((async (_connection: unknown, request: { user: string }) => ({
    results: (JSON.parse(request.user).words as { text: string; senses?: { ref: string }[]; examples: { line: number }[] }[]).map(word => skip.includes(word.text)
      ? { text: word.text, decision: 'skip', ref: '', pinyin: '', meanings: [], pos: '', example: -1 }
      : word.senses?.length ? { text: word.text, decision: 'sense', ref: word.senses[0].ref, pinyin: '', meanings: [], pos: '', example: -1 }
        : { text: word.text, decision: 'word', ref: '', pinyin: 'cí', meanings: ['word ' + word.text], pos: 'noun', example: word.examples[0].line }),
  })) as never)
}
const run = (id: string, options = {}) => linkEntries(id, new AbortController().signal, undefined, { catalog, ...options })

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  completion.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  await saveAIConnection({ baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
})
afterEach(() => vi.restoreAllMocks())

describe('distinct tokens', () => {
  it('collects Han tokens once, with occurrence counts and up to two example lines', () => {
    const { aligned } = build([['你', '词0'], ['词0', '词1'], ['词0']])
    aligned.tokens[0].items.push({ text: '123', pinyin: '', meaning: '', trailing: '' })
    const tokens = collectTokens({ aligned })
    expect(tokens.map(token => [token.text, token.count, token.lines])).toEqual([['你', 1, [0]], ['词0', 3, [0, 1]], ['词1', 1, [1]]])
  })
  it('links exact curriculum matches without the AI and sends multi-sense and unknown words to it', () => {
    const tokens = collectTokens(build([['你', '半', '词0']]))
    const plan = planLinks(tokens, catalog, new Set())
    expect([...plan.exact]).toEqual([['你', 'vocabulary:ni3']])
    expect(plan.work.map(work => [work.token.text, work.senses.map(sense => sense.ref)])).toEqual([['半', ['vocabulary:ban4--half', 'vocabulary:ban4--partly']], ['词0', []]])
  })
})

describe('pass 2 requests', () => {
  it('asks for N unknown words in ceil(N / batch) requests, never one per word', async () => {
    const words = unknown(23)
    const id = await item([['你'], ...words.map(word => [word, '你'])])
    model()
    const summary = await run(id, { batch: 5 })
    expect(completion).toHaveBeenCalledTimes(Math.ceil(23 / 5))
    expect(summary.requests).toBe(5)
    const item2 = await db.mediaItems.get(id)
    expect(item2?.entries?.complete).toBe(true)
    expect(Object.keys(item2!.entries!.links)).toHaveLength(24)
    expect(await db.sourceEntries.count()).toBe(23)
  })
  it('puts a multi-sense word in the same batch as unknown words and records the chosen sense', async () => {
    const id = await item([['半', '词0', '词1']])
    model()
    await run(id)
    expect(completion).toHaveBeenCalledTimes(1)
    const sent = JSON.parse((completion.mock.calls[0][1] as { user: string }).user).words as { text: string; senses?: unknown[] }[]
    expect(sent.map(word => word.text)).toEqual(['半', '词0', '词1'])
    expect(sent[0].senses).toHaveLength(2)
    expect((await db.mediaItems.get(id))?.entries?.links['半']).toBe('vocabulary:ban4--half')
  })
  it('sends nothing when every word links locally', async () => {
    const id = await item([['你', '你']])
    await run(id)
    expect(completion).not.toHaveBeenCalled()
    expect((await db.mediaItems.get(id))?.entries).toMatchObject({ complete: true, counts: { 'vocabulary:ni3': 2 } })
  })
})

describe('source entries', () => {
  it('creates a validated entry with the example from the source, and skips names', async () => {
    const id = await item([['词0', '词1']])
    model(['词1'])
    await run(id)
    const entry = await db.sourceEntries.get(sourceEntryId('词0'))
    expect(entry).toMatchObject({ word: '词0', pinyin: 'cí', meanings: ['word 词0'], pos: 'noun', sources: [{ mediaId: id, title: 'Drama', line: 0, text: '词0词1。' }] })
    expect(await db.sourceEntries.get(sourceEntryId('词1'))).toBeUndefined()
    expect((await db.mediaItems.get(id))?.entries?.skipped).toEqual(['词1'])
  })
  it('rejects invalid answers: a sense that was not offered, pinyin with Chinese, no meanings, and an unusable reply', () => {
    const work = [{ token: { text: '半', count: 1, lines: [0], pinyin: '', gloss: '' }, senses: [{ ref: 'vocabulary:a', pinyin: '', meaning: '' }] },
      { token: { text: '词', count: 1, lines: [0], pinyin: '', gloss: '' }, senses: [] }, { token: { text: '语', count: 1, lines: [0], pinyin: '', gloss: '' }, senses: [] }]
    const answer = validateBatch({ results: [
      { text: '半', decision: 'sense', ref: 'vocabulary:other' },
      { text: '词', decision: 'word', pinyin: '词', meanings: ['x'], pos: '', example: 0 },
      { text: '语', decision: 'skip' },
    ] }, work)
    expect(answer.unresolved).toEqual(['半', '词'])
    expect(answer.skipped).toEqual(['语'])
    expect(() => validateBatch({ results: [{ text: '词', decision: 'word', pinyin: 'cí', meanings: [], pos: '' }] }, work)).toThrow(/invalid/)
  })
  it('reuses an existing entry for the same word in another source and adds that source', async () => {
    model()
    await run(await item([['词0']]))
    const second = await saveMedia({ url: 'https://example.com/w', title: 'Other', extractor: 'x', source: 'captions', language: 'zh-Hans', lines: [{ start: 0, end: 1, text: '词0。' }] } as never)
    await db.mediaItems.update(second, { aligned: build([['词0']]).aligned })
    await run(second)
    expect(completion).toHaveBeenCalledTimes(1)
    expect((await db.sourceEntries.get(sourceEntryId('词0')))?.sources.map(source => source.title)).toEqual(['Drama', 'Other'])
  })
})

describe('persistence and resume', () => {
  it('keeps finished batches when a later one fails, then asks only for the rest', async () => {
    const id = await item([unknown(6)])
    model()
    const good = completion.getMockImplementation()!
    let calls = 0
    completion.mockImplementation(((...args: unknown[]) => ++calls === 1 ? (good as (...a: unknown[]) => unknown)(...args) : Promise.reject(new Error('boom'))) as never)
    await expect(run(id, { batch: 3, concurrency: 1 })).rejects.toThrow(/failed/)
    const partial = await db.mediaItems.get(id)
    expect(Object.keys(partial!.entries!.links)).toHaveLength(3)
    expect(partial!.entries!.complete).toBe(false)
    completion.mockReset(); model()
    await run(id, { batch: 3 })
    expect(completion).toHaveBeenCalledTimes(1)
    expect((await db.mediaItems.get(id))?.entries?.complete).toBe(true)
  })
  it('counts occurrences per entry and answers span queries from the stored links', async () => {
    const id = await item([['你', '词0'], ['词0', '词0'], ['你']])
    model()
    await run(id)
    const saved = (await db.mediaItems.get(id))!
    const ref = `source:${sourceEntryId('词0')}`
    expect(saved.entries?.counts).toEqual({ 'vocabulary:ni3': 2, [ref]: 3 })
    expect(Object.fromEntries(entryFrequencies(saved, { from: 1, to: 2 }))).toEqual({ [ref]: 2, 'vocabulary:ni3': 1 })
  })
})

describe('knowledge set', () => {
  it('adds a source entry as a knowledge entry with a card, and is idempotent', async () => {
    model()
    await run(await item([['词0']]))
    const ref = `source:${sourceEntryId('词0')}`
    expect(await addSourceEntriesToKnowledge([ref])).toEqual([ref])
    expect(await addSourceEntriesToKnowledge([ref])).toEqual([])
    expect(await db.knowledge.get(ref)).toMatchObject({ kind: 'source', source: 'dictionary' })
    expect(await db.studyCards.get(`${ref}:reading`)).toMatchObject({ state: 'new' })
  })
})

describe('unresolved words, base words and the prompt', () => {
  beforeEach(() => completion.mockReset())
  it('ends complete with a warning when a word stays unresolved, after one final small retry', async () => {
    const id = await item([['词0', '词1', '词2']])
    completion.mockImplementation((async (_connection: unknown, request: { user: string }) => ({
      results: (JSON.parse(request.user).words as { text: string; examples: { line: number }[] }[]).filter(word => word.text !== '词1').map(word => (
        { text: word.text, decision: 'word', ref: '', pinyin: 'cí', meanings: ['w'], pos: 'noun', example: word.examples[0].line })),
    })) as never)
    const summary = await run(id)
    expect(summary.unresolved).toBe(1)
    expect(completion).toHaveBeenCalledTimes(2) // the batch, then one final batch with just the left-over word
    expect(JSON.parse((completion.mock.calls[1][1] as { user: string }).user).words.map((word: { text: string }) => word.text)).toEqual(['词1'])
    const saved = (await db.mediaItems.get(id))!.entries!
    expect(saved.complete).toBe(true)
    expect(saved.unresolved).toEqual(['词1'])
  })
  it('links a word with a trailing particle to its known base instead of asking for an entry', () => {
    const known = (text: string) => text === '你' || text === '半'
    expect(baseOf('你的', known)).toBe('你')
    expect(baseOf('词了', known)).toBeUndefined()
    expect(baseOf('的', known)).toBeUndefined()
    const { aligned } = build([['你的', '半了', '词0']])
    const plan = planLinks(collectTokens({ aligned } as never), catalog, new Set())
    expect(plan.exact.get('你的')).toBe('vocabulary:ni3')
    expect(plan.work.find(entry => entry.token.text === '半了')!.senses).toHaveLength(2) // the base's senses
    expect(plan.work.find(entry => entry.token.text === '词0')!.senses).toEqual([])
  })
  it('rejects a source entry for a particle-suffixed word whose base is known', () => {
    const batch = [{ token: { text: '你的', count: 1, lines: [0], pinyin: 'nǐ de', gloss: 'your' }, senses: [] }]
    const answer = { results: [{ text: '你的', decision: 'word', ref: '', pinyin: 'nǐ de', meanings: ['your'], pos: 'pronoun', example: 0 }] }
    const checked = validateBatch(answer, batch, text => text === '你')
    expect(checked.words.size).toBe(0)
    expect(checked.skipped).toEqual(['你的'])
    expect(validateBatch(answer, batch).words.has('你的')).toBe(true) // without a known base it is a word
  })
  it('sends the pass-1 gloss with each word and tells the model near-duplicate senses are equivalent', async () => {
    const id = await item([['半', '词0']])
    model()
    await run(id)
    const request = completion.mock.calls[0][1] as { user: string; system: string }
    expect(JSON.parse(request.user).words.find((word: { text: string }) => word.text === '半').gloss).toBe('g')
    expect(request.system).toMatch(/Near-duplicate senses/)
    expect(request.system).toMatch(/Never make an entry for a verb or noun plus a particle/)
  })
})
