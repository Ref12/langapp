import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { saveAIConnection } from '../assistant/store'
import { requestStructuredJSON } from '../ai/structured'
import { resetProfileStorage } from '../../test/profile-storage'
import { isTranslated, lineView, type Aligned, type MediaLine } from './contracts'
import { reconcileLine } from './reconcile'
import { saveMedia } from './store'
import { applySalvage, buildChunk, planChunk, planGap, RUN, translateMedia } from './translation'

vi.mock('../ai/structured', () => ({ requestStructuredJSON: vi.fn() }))
const completion = vi.mocked(requestStructuredJSON)

const lines: MediaLine[] = Array.from({ length: 130 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `第${i}句。` }))
const tokens = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => ({ line: from + k, items: [{ text: `第${from + k}句`, pinyin: 'dì jù', meaning: 'sentence', trailing: '。' }] }))
/** A fake AI reply covering from..end, one sentence per two lines. */
function reply(from: number, end: number) {
  const sentences = []
  for (let first = from; first < end; first += 2) {
    const last = Math.min(first + 1, end - 1)
    sentences.push({ lines: [first, last], translation: `Sentence ${first}`, fragments: last > first ? [{ line: first, text: `S${first}a` }, { line: last, text: `S${first}b` }] : [{ line: first, text: `S${first}` }] })
  }
  return { sentences, tokens: tokens(from, end) }
}
type Body = { context: { line: number }[]; lines: { line: number; text: string }[]; lookahead: { line: number }[] }
const bodyOf = (request: { user: string }) => JSON.parse(request.user) as Body
const isFollowUp = (request: { name: string }) => request.name === 'media_translation_lines'
const windowCalls = () => completion.mock.calls.filter(call => !isFollowUp(call[1]))
const followUps = () => completion.mock.calls.filter(call => isFollowUp(call[1]))
const answerWindow = async (_connection: unknown, request: { user: string; name: string }) => {
  const body = bodyOf(request)
  const first = body.lines[0].line
  return reply(first, first + body.lines.length)
}

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  completion.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  Object.assign(RUN, { backoffMs: 0 })
  await saveAIConnection({ baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
})
afterEach(() => vi.restoreAllMocks())

async function item(source: MediaLine[] = lines) {
  return saveMedia({ url: 'https://example.com/v', title: 'T', extractor: 'x', source: 'captions', language: 'zh-Hans', lines: source } as never)
}

describe('chunk planning', () => {
  it('windows ~28 lines with read-only context before and look-ahead after', () => {
    expect(planChunk(130, 0)).toEqual({ from: 0, coreEnd: 28, beforeFrom: 0, windowEnd: 32 })
    expect(planChunk(130, 28)).toEqual({ from: 28, coreEnd: 56, beforeFrom: 25, windowEnd: 60 })
    expect(planChunk(130, 126)).toEqual({ from: 126, coreEnd: 130, beforeFrom: 123, windowEnd: 130 })
    expect(planGap(130, 40, 45)).toEqual({ from: 40, coreEnd: 45, beforeFrom: 37, windowEnd: 45 })
  })
})

describe('reconciling tokens with the source line', () => {
  const rebuilt = (line: string, items: { text: string; trailing?: string }[]) => {
    const result = reconcileLine(line, items.map(token => ({ pinyin: 'x', meaning: 'g', trailing: '', ...token })))
    expect(result.tokens.map(token => token.text + token.trailing).join('')).toBe(line)
    return result
  }
  it('keeps tokens that already reproduce the line, untouched', () => {
    const result = rebuilt('你好吗？', [{ text: '你好' }, { text: '吗', trailing: '？' }])
    expect(result.repaired).toBe(false)
    expect(result.tokens[1].meaning).toBe('g')
  })
  it('puts back a dropped particle as its own token with a reading', () => {
    const result = rebuilt('更是个三心二意的人渣！', [{ text: '更是' }, { text: '个' }, { text: '三心二意' }, { text: '人渣', trailing: '！' }])
    expect(result.repaired).toBe(true)
    const particle = result.tokens.find(token => token.text === '的')!
    expect(particle.pinyin).toBeTruthy()
    expect(particle.meaning).toBe('')
  })
  it('puts back a dropped final 了 and a dropped final punctuation mark', () => {
    rebuilt('被官差全部抓起来了！', [{ text: '被' }, { text: '官差' }, { text: '全部' }, { text: '抓起来', trailing: '！' }])
    const result = rebuilt('你这是做什么呀？', [{ text: '你' }, { text: '这是' }, { text: '做什么' }, { text: '呀' }])
    expect(result.tokens[result.tokens.length - 1]).toMatchObject({ text: '呀', trailing: '？' })
  })
  it('drops characters the model added, such as a question mark', () => {
    const result = rebuilt('出去逛青楼都是错', [{ text: '出去' }, { text: '逛' }, { text: '青楼' }, { text: '都是' }, { text: '错', trailing: '？' }])
    expect(result.tokens.map(token => token.trailing).join('')).toBe('')
    expect(result.repaired).toBe(true)
  })
  it('survives tokens that are wrong, empty or in the wrong order by falling back to per-character tokens', () => {
    expect(rebuilt('你好。', []).tokens.map(token => token.text)).toEqual(['你', '好'])
    rebuilt('你好。', [{ text: '好' }, { text: '你' }, { text: '。' }])
    rebuilt('你好。', [{ text: 'xyz' }, { text: '' }])
  })
})

describe('building a chunk from a reply', () => {
  const plan = planChunk(130, 0)
  it('accepts a complete reply, may end past the core, and rebuilds every line', () => {
    const spilling = reply(0, 28)
    spilling.sentences[spilling.sentences.length - 1].lines = [26, 29] // starts in the window, ends in the look-ahead
    spilling.sentences[spilling.sentences.length - 1].fragments = [{ line: 26, text: 'x' }]
    spilling.tokens = tokens(0, 30)
    const chunk = buildChunk(spilling, lines, plan)
    expect(chunk.upTo).toBe(30)
    expect(chunk.uncovered).toEqual([])
    expect(chunk.repaired).toBe(0)
    expect(chunk.sentences[0].lines).toEqual([0, 1])
  })
  it('repairs a mismatching token line instead of rejecting the chunk, and counts it', () => {
    const bad = reply(0, 28)
    bad.tokens[3].items[0].text = '错'
    bad.tokens[4].items = []
    const chunk = buildChunk(bad, lines, plan)
    expect(chunk.repaired).toBe(2)
    for (const entry of chunk.tokens) expect(entry.items.map(token => token.text + token.trailing).join('')).toBe(lines[entry.line].text)
  })
  it('reports lines with no sentence as uncovered and lines with no tokens as untokened', () => {
    const partial = reply(0, 28)
    partial.sentences.splice(3, 1) // lines 6-7
    partial.tokens = partial.tokens.filter(entry => entry.line !== 10)
    const chunk = buildChunk(partial, lines, plan)
    expect(chunk.uncovered).toEqual([6, 7])
    expect(chunk.untokened).toEqual([10])
    expect(chunk.tokens.find(entry => entry.line === 10)!.items.length).toBeGreaterThan(0)
  })
  it('drops sentences that overlap, run backwards or leave the window, and fixes bad fragments', () => {
    const odd = reply(0, 28)
    odd.sentences[1].lines = [1, 3] // overlaps the first sentence
    odd.sentences[2].fragments = [{ line: 5, text: 'x' }] // not on its first line
    odd.sentences.push({ lines: [200, 201], translation: 'far away', fragments: [] })
    const chunk = buildChunk(odd, lines, plan)
    expect(chunk.sentences.some(sentence => sentence.lines[0] === 200)).toBe(false)
    expect(chunk.sentences.every((sentence, index) => index === 0 || sentence.lines[0] > chunk.sentences[index - 1].lines[1])).toBe(true)
    expect(chunk.sentences.find(sentence => sentence.lines[0] === 4)!.fragments).toEqual([])
  })
  it('still rejects a reply that is not a translation at all, or that lost most of the window', () => {
    expect(() => buildChunk({ sentences: [], tokens: [] }, lines, plan)).toThrow(/invalid or incomplete/)
    expect(() => buildChunk('nope', lines, plan)).toThrow(/invalid or incomplete/)
    expect(() => buildChunk(reply(0, 6), lines, plan)).toThrow(/invalid or incomplete/)
  })
  it('folds a follow-up reply into uncovered and untokened lines only', () => {
    const partial = reply(0, 28)
    partial.sentences.splice(3, 1)
    partial.tokens = partial.tokens.filter(entry => entry.line !== 10)
    const chunk = buildChunk(partial, lines, plan)
    const answer = { results: [
      { line: 6, translation: 'Six', items: [{ text: '第6句', pinyin: 'x', meaning: 'g', trailing: '。' }] },
      { line: 7, translation: '', items: [] }, // no translation: stays uncovered
      { line: 10, translation: 'ignored', items: [{ text: '第10句', pinyin: 'x', meaning: 'g', trailing: '。' }] },
      { line: 3, translation: 'not asked', items: [] },
    ] }
    const { chunk: fixed, fixed: count } = applySalvage(chunk, answer, lines)
    expect(count).toBe(2)
    expect(fixed.uncovered).toEqual([7])
    expect(fixed.untokened).toEqual([])
    expect(fixed.sentences.find(sentence => sentence.lines[0] === 6)).toMatchObject({ translation: 'Six', lines: [6, 6] })
  })
})

describe('translateMedia', () => {
  it('runs windows in parallel, saves the whole item, and trims the overlap a spilling sentence leaves', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const body = bodyOf(request)
      const first = body.lines[0].line
      // The first window ends two lines into the next one, as a sentence crossing the edge would.
      return reply(first, first + body.lines.length + (first === 0 ? 2 : 0))
    })
    const progress = vi.fn()
    const models = vi.fn()
    await translateMedia(id, new AbortController().signal, progress, { onModel: models })
    expect(models).toHaveBeenCalledWith('test-model')
    const saved = (await db.mediaItems.get(id))!.aligned!
    expect(saved.upTo).toBe(130)
    expect(isTranslated(saved, 130)).toBe(true)
    expect(saved.tokens.map(entry => entry.line)).toEqual(lines.map((_, i) => i))
    const covered = saved.sentences.flatMap(sentence => Array.from({ length: sentence.lines[1] - sentence.lines[0] + 1 }, (_, k) => sentence.lines[0] + k))
    expect(covered).toEqual(lines.map((_, i) => i))
    const sent = windowCalls().map(call => bodyOf(call[1]))
    expect(sent.map(entry => entry.lines[0].line).sort((x, y) => x - y)).toEqual([0, 28, 56, 84, 112])
    expect(sent.find(entry => entry.lines[0].line === 0)!.lookahead.length).toBe(4)
    const done = progress.mock.calls.map(call => call[0] as number)
    expect(done[0]).toBe(0)
    expect(done[done.length - 1]).toBe(130)
    expect([...done].sort((x, y) => x - y)).toEqual(done)
  })

  it('sends each source line verbatim with its index and tells the model to copy text exactly', async () => {
    const id = await item()
    completion.mockImplementation(answerWindow)
    await translateMedia(id, new AbortController().signal)
    const first = completion.mock.calls.map(call => ({ request: call[1], body: bodyOf(call[1]) })).find(entry => entry.body.lines[0].line === 28)!
    expect(first.body.lines[0]).toEqual({ line: 28, text: '第28句。' })
    expect(first.body.context.map(entry => entry.line)).toEqual([25, 26, 27])
    expect(first.request.system).toMatch(/Copy each token's "text" exactly/)
    expect(first.request.system).toMatch(/trailing/)
  })

  it('repairs tokens that do not match the lines, saves every line exactly, and reports the repaired count', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const answer = await answerWindow(_connection, request as never)
      for (const entry of answer.tokens) if (entry.line % 5 === 0) entry.items[0].trailing = '？' // adds a character the line does not have
      return answer
    })
    await translateMedia(id, new AbortController().signal)
    const saved = (await db.mediaItems.get(id))!.aligned!
    for (const entry of saved.tokens) expect(entry.items.map(token => token.text + token.trailing).join('')).toBe(lines[entry.line].text)
    expect(saved.upTo).toBe(130)
    const logged = vi.mocked(console.info).mock.calls.map(call => String(call[0])).filter(text => text.includes('line(s) repaired'))
    expect(logged.length).toBe(5)
    expect(logged.some(text => /[1-9]\d* line\(s\) repaired/.test(text))).toBe(true)
  })

  it('asks for lines a reply could not cover in one batched follow-up, never one request per line', async () => {
    const small = lines.slice(0, 20)
    const id = await item(small)
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) {
        const asked = bodyOf(request as never).lines
        return { results: asked.map(entry => ({ line: entry.line, translation: `T${entry.line}`, items: [{ text: `第${entry.line}句`, pinyin: 'x', meaning: 'g', trailing: '。' }] })) }
      }
      const answer = reply(0, 20)
      answer.sentences = answer.sentences.filter(sentence => sentence.lines[0] < 10 || sentence.lines[0] >= 16) // lines 10-15 missing
      answer.tokens = answer.tokens.filter(entry => entry.line !== 2 && entry.line !== 3) // untokened
      return answer
    })
    await translateMedia(id, new AbortController().signal)
    expect(windowCalls()).toHaveLength(1)
    expect(followUps()).toHaveLength(1)
    expect(bodyOf(followUps()[0][1]).lines.map(entry => entry.line)).toEqual([2, 3, 10, 11, 12, 13, 14, 15])
    const saved = (await db.mediaItems.get(id))!.aligned!
    expect(isTranslated(saved, 20)).toBe(true)
    expect(saved.sentences.find(sentence => sentence.lines[0] === 12)).toMatchObject({ translation: 'T12', lines: [12, 12] })
  })

  it('does not stop the run for a window that keeps failing: the rest is saved, the failed range is reported and refilled by the next run', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const first = bodyOf(request as never).lines[0].line
      if (first === 56) throw new Error('network down')
      return answerWindow(_connection, request as never)
    })
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow(/lines 57-84 failed: network down/)
    expect(completion.mock.calls.filter(call => bodyOf(call[1]).lines[0].line === 56)).toHaveLength(RUN.retries + 1)
    let saved = (await db.mediaItems.get(id))!.aligned!
    expect(saved.upTo).toBe(130)
    expect(saved.missing).toEqual([[56, 84]])
    expect(isTranslated(saved, 130)).toBe(false)
    expect(saved.tokens.length).toBe(130 - 28)
    completion.mockClear()
    completion.mockImplementation(answerWindow)
    await translateMedia(id, new AbortController().signal)
    expect(completion.mock.calls.map(call => bodyOf(call[1]).lines[0].line)).toEqual([56])
    saved = (await db.mediaItems.get(id))!.aligned!
    expect(saved.missing).toBeUndefined()
    expect(isTranslated(saved, 130)).toBe(true)
    expect(saved.tokens.map(entry => entry.line)).toEqual(lines.map((_, i) => i))
  })

  it('names every failed part when several fail', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const first = bodyOf(request as never).lines[0].line
      if (first === 28 || first === 84) throw new Error('boom')
      return answerWindow(_connection, request as never)
    })
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow(/2 parts failed \(lines 29-56, lines 85-112\).*Retry failed parts/)
    expect((await db.mediaItems.get(id))!.aligned!.missing).toEqual([[28, 56], [84, 112]])
  })

  it('retries a failed window and succeeds when a retry works', async () => {
    const id = await item()
    const seen = new Map<number, number>()
    completion.mockImplementation(async (_connection, request) => {
      const first = bodyOf(request as never).lines[0].line
      seen.set(first, (seen.get(first) ?? 0) + 1)
      if (first === 56 && seen.get(first)! <= 2) throw new Error('blip')
      return answerWindow(_connection, request as never)
    })
    await translateMedia(id, new AbortController().signal)
    expect(seen.get(56)).toBe(3)
    expect(isTranslated((await db.mediaItems.get(id))!.aligned, 130)).toBe(true)
  })

  it('has several requests in flight at once, bounded by the concurrency, and reports the active windows', async () => {
    const big: MediaLine[] = Array.from({ length: 600 }, (_, i) => ({ start: i, end: i + 0.9, text: `第${i}句。` }))
    const id = await item(big)
    let active = 0, peak = 0
    completion.mockImplementation(async (_connection, request) => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return answerWindow(_connection, request as never)
    })
    const seen: number[] = []
    await translateMedia(id, new AbortController().signal, undefined, { concurrency: 3, onActive: list => seen.push(list.length) })
    expect(peak).toBe(3)
    expect(Math.max(...seen)).toBe(3)
    expect(seen[seen.length - 1]).toBe(0)
    expect(isTranslated((await db.mediaItems.get(id))!.aligned, 600)).toBe(true)
  })

  it('times out a window that never answers instead of hanging, and keeps going', async () => {
    const id = await item()
    completion.mockImplementation((_connection, request) => new Promise((_resolve, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
    await expect(translateMedia(id, new AbortController().signal, undefined, { timeoutMs: 20 })).rejects.toThrow(/did not answer within/)
    expect((await db.mediaItems.get(id))!.aligned!.missing).toEqual([[0, 130]])
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
