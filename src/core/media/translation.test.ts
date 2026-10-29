import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { saveAIConnection } from '../assistant/store'
import { requestStructuredJSON } from '../ai/structured'
import { resetProfileStorage } from '../../test/profile-storage'
import { lineView, type Aligned, type MediaLine } from './contracts'
import { saveMedia } from './store'
import { planChunk, translateMedia, validateChunk } from './translation'

vi.mock('../ai/structured', () => ({ requestStructuredJSON: vi.fn() }))
const completion = vi.mocked(requestStructuredJSON)

const lines: MediaLine[] = Array.from({ length: 130 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `第${i}句。` }))
const tokens = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => ({ line: from + k, items: [{ text: `第${from + k}句`, pinyin: 'dì jù', meaning: 'sentence', trailing: '。' }] }))
/** A fake AI reply covering plan.from..end, one sentence per two lines. */
function reply(from: number, end: number) {
  const sentences = []
  for (let first = from; first < end; first += 2) {
    const last = Math.min(first + 1, end - 1)
    sentences.push({ lines: [first, last], translation: `Sentence ${first}`, fragments: last > first ? [{ line: first, text: `S${first}a` }, { line: last, text: `S${first}b` }] : [{ line: first, text: `S${first}` }] })
  }
  return { sentences, tokens: tokens(from, end) }
}

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  completion.mockReset()
  await saveAIConnection({ baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
})
afterEach(() => vi.restoreAllMocks())

async function item() {
  return saveMedia({ url: 'https://example.com/v', title: 'T', extractor: 'x', source: 'captions', language: 'zh-Hans', lines } as never)
}

describe('chunk planning', () => {
  it('windows a chunk with read-only context before and look-ahead after', () => {
    expect(planChunk(130, 0)).toEqual({ from: 0, coreEnd: 60, beforeFrom: 0, windowEnd: 66 })
    expect(planChunk(130, 60)).toEqual({ from: 60, coreEnd: 120, beforeFrom: 56, windowEnd: 126 })
    expect(planChunk(130, 124)).toEqual({ from: 124, coreEnd: 130, beforeFrom: 120, windowEnd: 130 })
  })
})

describe('chunk validation', () => {
  const plan = planChunk(130, 0)
  it('accepts a reply that covers the core, may end past it, and rebuilds every line', () => {
    const out = validateChunk(reply(0, 62), lines, plan)
    expect(out.upTo).toBe(62)
    expect(out.sentences[0].lines).toEqual([0, 1])
  })
  it('rejects tokens that do not reproduce the line exactly', () => {
    const bad = reply(0, 60)
    bad.tokens[3].items[0].text = '错'
    expect(() => validateChunk(bad, lines, plan)).toThrow(/invalid or incomplete/)
  })
  it('rejects fragments outside their sentence, out of order, or not starting on its first line', () => {
    for (const mutate of [
      (r: ReturnType<typeof reply>) => { r.sentences[0].fragments[1].line = 2 },
      (r: ReturnType<typeof reply>) => { r.sentences[0].fragments.reverse() },
      (r: ReturnType<typeof reply>) => { r.sentences[0].fragments = [{ line: 1, text: 'x' }] },
    ]) {
      const bad = reply(0, 60)
      mutate(bad)
      expect(() => validateChunk(bad, lines, plan)).toThrow(/invalid or incomplete/)
    }
  })
  it('rejects gaps, overlaps with the previous chunk, short coverage and look-ahead overruns', () => {
    const gap = reply(0, 60); gap.sentences[1].lines = [3, 3]
    expect(() => validateChunk(gap, lines, plan)).toThrow()
    expect(() => validateChunk(reply(0, 40), lines, plan)).toThrow()
    expect(() => validateChunk(reply(0, 70), lines, plan)).toThrow()
    expect(() => validateChunk({ sentences: [], tokens: [] }, lines, plan)).toThrow()
  })
})

describe('translateMedia', () => {
  it('chunks the item, de-duplicates the overlap, and saves a chunk at a time', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const body = JSON.parse(request.user) as { lines: { line: number }[]; lookahead: { line: number }[] }
      const first = body.lines[0].line
      return reply(first, first + body.lines.length + (first === 0 ? 2 : 0))
    })
    const progress = vi.fn()
    await translateMedia(id, new AbortController().signal, progress)
    const saved = (await db.mediaItems.get(id))!.aligned!
    expect(saved.upTo).toBe(130)
    expect(saved.tokens.map(entry => entry.line)).toEqual(lines.map((_, i) => i))
    const covered = saved.sentences.flatMap(sentence => Array.from({ length: sentence.lines[1] - sentence.lines[0] + 1 }, (_, k) => sentence.lines[0] + k))
    expect(covered).toEqual(lines.map((_, i) => i))
    const sent = completion.mock.calls.map(call => JSON.parse(call[1].user) as { context: { line: number }[]; lines: { line: number }[]; lookahead: { line: number }[] })
    expect(sent[1].lines[0].line).toBe(62)
    expect(sent[1].context.map(entry => entry.line)).toEqual([58, 59, 60, 61])
    expect(sent[0].lookahead.length).toBe(6)
    expect(progress).toHaveBeenLastCalledWith(130, 130)
  })

  it('keeps finished chunks when cancelled or failed, then resumes from where it stopped', async () => {
    const id = await item()
    let calls = 0
    completion.mockImplementation(async (_connection, request) => {
      const body = JSON.parse(request.user) as { lines: { line: number }[] }
      const first = body.lines[0].line
      if (++calls === 2) throw new Error('network down')
      return reply(first, first + body.lines.length)
    })
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow('network down')
    expect((await db.mediaItems.get(id))!.aligned!.upTo).toBe(60)
    completion.mockClear()
    await translateMedia(id, new AbortController().signal)
    expect(completion).toHaveBeenCalledTimes(2)
    expect(JSON.parse(completion.mock.calls[0][1].user).lines[0].line).toBe(60)
    expect((await db.mediaItems.get(id))!.aligned!.upTo).toBe(130)
  })

  it('stops on abort and refuses without an AI connection', async () => {
    const id = await item()
    const controller = new AbortController()
    controller.abort()
    await expect(translateMedia(id, controller.signal)).rejects.toThrow()
    expect(completion).not.toHaveBeenCalled()
    await db.aiConnections.clear()
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow(/AI connection/)
  })
})

describe('lineView', () => {
  const aligned: Aligned = {
    sentences: [{ lines: [0, 2], translation: 'Whole sentence', fragments: [{ line: 0, text: 'Whole' }, { line: 2, text: 'sentence' }] }, { lines: [3, 4], translation: 'Another', fragments: [{ line: 3, text: 'Another' }] }],
    tokens: [{ line: 0, items: [{ text: '你', pinyin: 'nǐ', meaning: 'you', trailing: '' }] }], upTo: 5, updatedAt: 1,
  }
  it('gives a fragment, the whole sentence, and marks lines that share it', () => {
    expect(lineView(aligned, 0).translation).toEqual({ fragment: 'Whole', sentence: 'Whole sentence', shared: false })
    expect(lineView(aligned, 1).translation).toEqual({ fragment: 'Whole sentence', sentence: 'Whole sentence', shared: true })
    expect(lineView(aligned, 4).translation).toEqual({ fragment: 'Another', sentence: 'Another', shared: true })
    expect(lineView(aligned, 0).tokens).toHaveLength(1)
    expect(lineView(aligned, 9)).toEqual({ tokens: undefined })
    expect(lineView(undefined, 0)).toEqual({})
  })
})
