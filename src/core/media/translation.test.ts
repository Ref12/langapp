import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { saveAIConnection } from '../assistant/store'
import { requestStructuredJSON } from '../ai/structured'
import { resetProfileStorage } from '../../test/profile-storage'
import { isTranslated, lineView, type Aligned, type MediaLine } from './contracts'
import { reconcileLine } from './reconcile'
import { saveMedia } from './store'
import { applySalvage, clearTranslation, buildChunk, getChunkSize, getConcurrency, mergeChunks, planChunk, planGap, RUN, setChunkSize, setConcurrency, translateMedia, troubleLines, bleeds, normalizePinyin } from './translation'

vi.mock('../ai/structured', () => ({ requestStructuredJSON: vi.fn() }))
const completion = vi.mocked(requestStructuredJSON)

const lines: MediaLine[] = Array.from({ length: 130 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `第${i}句。` }))
const words = (line: number) => [`第${line}句|dì jù|sentence`]
const tokens = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => ({ n: from + k, w: words(from + k) }))
/** A fake AI reply in the compact format covering from..end, one sentence per two lines. */
function reply(from: number, end: number) {
  const s = []
  for (let first = from; first < end; first += 2) {
    const last = Math.min(first + 1, end - 1)
    s.push({ l: [first, last], t: `Sentence ${first}`, f: last > first ? [{ n: first, t: `S${first}a` }, { n: last, t: `S${first}b` }] : [{ n: first, t: `S${first}` }] })
  }
  return { s, k: tokens(from, end) }
}
type Body = { context: { line: number }[]; lines: { line: number; text: string }[]; lookahead: { line: number }[] }
const bodyOf = (request: { user: string }) => JSON.parse(request.user) as Body
const isFollowUp = (request: { name: string }) => request.name === 'media_translation_lines'
const windowCalls = () => completion.mock.calls.filter(call => !isFollowUp(call[1]))
const followUps = () => completion.mock.calls.filter(call => isFollowUp(call[1]))
const followAnswer = (request: { user: string }) => ({ r: bodyOf(request).lines.map(entry => ({ n: entry.line, t: `T${entry.line}`, w: words(entry.line) })) })
const answerWindow = async (_connection: unknown, request: { user: string; name: string }) => {
  if (isFollowUp(request)) return followAnswer(request)
  const body = bodyOf(request)
  const first = body.lines[0].line
  return reply(first, first + body.lines.length)
}

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  completion.mockReset()
  setChunkSize(22)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  Object.assign(RUN, { backoffMs: 0 })
  await saveAIConnection({ baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
})
afterEach(() => vi.restoreAllMocks())

async function item(source: MediaLine[] = lines) {
  return saveMedia({ url: 'https://example.com/v', title: 'T', extractor: 'x', source: 'captions', language: 'zh-Hans', lines: source } as never)
}

describe('chunk planning', () => {
  it('windows ~22 lines with read-only context before and look-ahead after', () => {
    expect(planChunk(130, 0, 22, 3, 4)).toEqual({ from: 0, coreEnd: 22, beforeFrom: 0, windowEnd: 26 })
    expect(planChunk(130, 22, 22, 3, 4)).toEqual({ from: 22, coreEnd: 44, beforeFrom: 19, windowEnd: 48 })
    expect(planChunk(130, 126, 22, 3, 4)).toEqual({ from: 126, coreEnd: 130, beforeFrom: 123, windowEnd: 130 })
    expect(planGap(130, 40, 45)).toEqual({ from: 40, coreEnd: 45, beforeFrom: 35, windowEnd: 45 })
  })
})

describe('chunk size and overlap', () => {
  it('defaults to 50 lines with 5 lines of context before and 5 of look-ahead, and keeps the setting between 20 and 80', () => {
    localStorage.removeItem('media-translation-chunk-size')
    expect(getChunkSize()).toBe(50)
    expect(planChunk(200, 50, getChunkSize())).toEqual({ from: 50, coreEnd: 100, beforeFrom: 45, windowEnd: 105 })
    expect(setChunkSize(5)).toBe(20)
    expect(setChunkSize(500)).toBe(80)
    expect(getChunkSize()).toBe(80)
    expect(setChunkSize(0)).toBe(50)
    setChunkSize(22)
  })
  it('lets the chunk where a sentence starts own it: not one starting in the context, nor one starting in the look-ahead', () => {
    const plan = planChunk(200, 50, 50, 5, 5)
    const text = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 0.9, text: `第${i}句。` }))
    const sentence = (first: number, last: number) => ({ l: [first, last], t: `S${first}`, f: [{ n: first, t: `S${first}` }] })
    const s = [sentence(49, 50), sentence(51, 98), sentence(99, 101), sentence(102, 103)]
    const chunk = buildChunk({ s, k: tokens(50, 104) }, text, plan)
    expect(chunk.sentences.map(entry => entry.lines)).toEqual([[51, 98], [99, 101]])
    expect(chunk.uncovered).toEqual([50])
    expect(chunk.upTo).toBe(102)
    expect(chunk.tokens.map(entry => entry.line)).not.toContain(49)
  })
  it('saves a sentence that crosses the edge once, from the chunk where it starts, and asks again only for the line the next chunk could not take', async () => {
    const id = await item(lines.slice(0, 44))
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) return followAnswer(request as never)
      const body = bodyOf(request as never)
      const first = body.lines[0].line
      const answer = reply(first, first + body.lines.length)
      if (first === 0) { answer.s[answer.s.length - 1].l = [20, 23]; answer.s[answer.s.length - 1].f = [{ n: 20, t: 'x' }]; answer.k = tokens(0, 24) }
      if (first === 22) { answer.s[0].l = [22, 23]; answer.s[0].t = 'again' } // the lookahead of the first chunk already owns lines 22-23
      return answer
    })
    await translateMedia(id, new AbortController().signal)
    const saved = (await db.mediaItems.get(id))!.aligned!
    const covered = saved.sentences.flatMap(sentence => Array.from({ length: sentence.lines[1] - sentence.lines[0] + 1 }, (_, k) => sentence.lines[0] + k))
    expect(covered).toEqual(Array.from({ length: 44 }, (_, i) => i))
    expect(saved.sentences.find(sentence => sentence.lines[0] === 20)!.lines).toEqual([20, 23])
    expect(saved.sentences.some(sentence => sentence.translation === 'again')).toBe(false)
    expect(saved.tokens.map(entry => entry.line)).toEqual(Array.from({ length: 44 }, (_, i) => i))
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

describe('compact tokens', () => {
  it('attaches punctuation as trailing without counting it as a repair, and fills readings of unglossed function words from the character data', () => {
    const result = reconcileLine('你好吗？', [{ text: '你好', pinyin: 'nǐ hǎo', meaning: 'hello' }, { text: '吗', pinyin: '', meaning: '' }])
    expect(result.repaired).toBe(false)
    expect(result.tokens.map(token => token.text + token.trailing).join('')).toBe('你好吗？')
    expect(result.tokens[1]).toMatchObject({ text: '吗', trailing: '？', meaning: '' })
    expect(result.tokens[1].pinyin).toBeTruthy()
  })
})

describe('building a chunk from a reply', () => {
  const plan = planChunk(130, 0, 22, 3, 4)
  it('accepts a complete reply, may end past the core, and rebuilds every line', () => {
    const spilling = reply(0, 22)
    spilling.s[spilling.s.length - 1].l = [20, 23] // starts in the window, ends in the look-ahead
    spilling.s[spilling.s.length - 1].f = [{ n: 20, t: 'x' }]
    spilling.k = tokens(0, 24)
    const chunk = buildChunk(spilling, lines, plan)
    expect(chunk.upTo).toBe(24)
    expect(chunk.uncovered).toEqual([])
    expect(chunk.repaired).toBe(0)
    expect(chunk.sentences[0].lines).toEqual([0, 1])
    expect(chunk.tokens[0].items[0]).toEqual({ text: '第0句', pinyin: 'dì jù', meaning: 'sentence', trailing: '。' })
  })
  it('repairs a mismatching token line instead of rejecting the chunk, and counts it', () => {
    const bad = reply(0, 22)
    bad.k[3].w = ['错|cuò|wrong']
    bad.k[4].w = []
    const chunk = buildChunk(bad, lines, plan)
    expect(chunk.repaired).toBe(2)
    for (const entry of chunk.tokens) expect(entry.items.map(token => token.text + token.trailing).join('')).toBe(lines[entry.line].text)
  })
  it('reports lines with no sentence as uncovered, lines with no tokens as untokened, and content words with no gloss as weak', () => {
    const partial = reply(0, 22)
    partial.s.splice(3, 1) // lines 6-7
    partial.k = partial.k.filter(entry => entry.n !== 10)
    partial.k[2].w = ['第2句|dì jù|'] // content word without a gloss
    const chunk = buildChunk(partial, lines, plan)
    expect(chunk.uncovered).toEqual([6, 7])
    expect(chunk.untokened).toEqual([10])
    expect(chunk.weak).toEqual([2])
    expect(troubleLines(chunk)).toEqual([2, 6, 7, 10])
  })
  it('drops sentences that overlap, run backwards or leave the window, and fixes bad fragments', () => {
    const odd = reply(0, 22)
    odd.s[1].l = [1, 3] // overlaps the first sentence
    odd.s[2].f = [{ n: 5, t: 'x' }] // not on its first line
    odd.s.push({ l: [200, 201], t: 'far away', f: [] })
    const chunk = buildChunk(odd, lines, plan)
    expect(chunk.sentences.some(sentence => sentence.lines[0] === 200)).toBe(false)
    expect(chunk.sentences.every((sentence, index) => index === 0 || sentence.lines[0] > chunk.sentences[index - 1].lines[1])).toBe(true)
    expect(chunk.sentences.find(sentence => sentence.lines[0] === 4)!.fragments).toEqual([])
  })
  it('still rejects a reply that is not a translation at all, or that lost most of the window', () => {
    expect(() => buildChunk({ s: [], k: [] }, lines, plan)).toThrow(/invalid or incomplete/)
    expect(() => buildChunk('nope', lines, plan)).toThrow(/invalid or incomplete/)
    expect(() => buildChunk(reply(0, 6), lines, plan)).toThrow(/invalid or incomplete/)
  })
  it('folds a follow-up reply into uncovered, untokened and weak lines only', () => {
    const partial = reply(0, 22)
    partial.s.splice(3, 1)
    partial.k = partial.k.filter(entry => entry.n !== 10)
    partial.k[2].w = ['第2句|dì jù|']
    const chunk = buildChunk(partial, lines, plan)
    const answer = { r: [
      { n: 6, t: 'Six', w: ['第6句|x|g'] },
      { n: 7, t: '', w: [] }, // no translation: stays uncovered
      { n: 10, t: 'ignored', w: ['第10句|x|g'] },
      { n: 2, t: 'ignored', w: ['第2句|dì jù|a sentence'] },
      { n: 3, t: 'not asked', w: [] },
    ] }
    const { chunk: fixed, fixed: count } = applySalvage(chunk, answer, lines)
    expect(count).toBe(3)
    expect(fixed.uncovered).toEqual([7])
    expect(fixed.untokened).toEqual([])
    expect(fixed.weak).toEqual([])
    expect(fixed.sentences.find(sentence => sentence.lines[0] === 6)).toMatchObject({ translation: 'Six', lines: [6, 6] })
    expect(fixed.tokens.find(entry => entry.line === 2)!.items[0].meaning).toBe('a sentence')
  })
  it('merges two halves, the later giving way to a sentence the earlier one already covers', () => {
    const first = buildChunk(reply(0, 11), lines, { from: 0, coreEnd: 11, beforeFrom: 0, windowEnd: 15 })
    const second = buildChunk(reply(10, 22), lines, { from: 10, coreEnd: 22, beforeFrom: 7, windowEnd: 26 })
    const merged = mergeChunks(first, second)
    const covered = merged.sentences.flatMap(sentence => Array.from({ length: sentence.lines[1] - sentence.lines[0] + 1 }, (_, k) => sentence.lines[0] + k))
    expect(new Set(covered).size).toBe(covered.length)
    expect(merged.tokens.map(entry => entry.line)).toEqual([...new Set(merged.tokens.map(entry => entry.line))])
  })
})

describe('translateMedia', () => {
  it('runs windows in parallel, saves the whole item, and trims the overlap a spilling sentence leaves', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const body = bodyOf(request)
      const first = body.lines[0].line
      return reply(first, first + body.lines.length + (first === 0 ? 2 : 0)) // the first window ends two lines into the next one
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
    expect(sent.map(entry => entry.lines[0].line).sort((x, y) => x - y)).toEqual([0, 22, 44, 66, 88, 110])
    expect(sent.find(entry => entry.lines[0].line === 0)!.lookahead.length).toBe(5)
    const done = progress.mock.calls.map(call => call[0] as number)
    expect(done[0]).toBe(0)
    expect(done[done.length - 1]).toBe(130)
    expect([...done].sort((x, y) => x - y)).toEqual(done)
  })

  it('asks for the compact format, with 16k output, each line verbatim with its index', async () => {
    const id = await item()
    completion.mockImplementation(answerWindow)
    await translateMedia(id, new AbortController().signal)
    const entry = completion.mock.calls.map(call => ({ request: call[1], body: bodyOf(call[1]) })).find(item => item.body.lines[0].line === 22)!
    expect(entry.body.lines[0]).toEqual({ line: 22, text: '第22句。' })
    expect(entry.body.context.map(line => line.line)).toEqual([17, 18, 19, 20, 21])
    expect(entry.request.system).toMatch(/COMPACT JSON/)
    expect(entry.request.system).toMatch(/text\|pinyin\|gloss/)
    expect(entry.request.system).toMatch(/still referring|still|never empty/)
    expect(entry.request.maxOutputTokens).toBe(16000)
    expect(JSON.stringify(entry.request.schema)).not.toMatch(/"meaning"|"trailing"|"translation"/)
  })

  it('repairs tokens that do not match the lines, saves every line exactly, and reports the repaired count', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const answer = await answerWindow(_connection, request as never)
      if ('k' in answer) for (const entry of answer.k) if (entry.n % 5 === 0) entry.w = ['别的|bié de|other'] // not in the line at all
      return answer
    })
    await translateMedia(id, new AbortController().signal)
    const saved = (await db.mediaItems.get(id))!.aligned!
    for (const entry of saved.tokens) expect(entry.items.map(token => token.text + token.trailing).join('')).toBe(lines[entry.line].text)
    expect(saved.upTo).toBe(130)
    const logged = vi.mocked(console.info).mock.calls.map(call => String(call[0])).filter(text => text.includes('line(s) repaired'))
    expect(logged.some(text => /[1-9]\d* line\(s\) repaired/.test(text))).toBe(true)
  })

  it('asks for lines a reply could not cover or gloss in one batched follow-up, never one request per line', async () => {
    const id = await item(lines.slice(0, 20))
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) return followAnswer(request as never)
      const answer = reply(0, 20)
      answer.s = answer.s.filter(sentence => sentence.l[0] < 10 || sentence.l[0] >= 16) // lines 10-15 missing
      answer.k = answer.k.filter(entry => entry.n !== 2 && entry.n !== 3) // untokened
      answer.k.find(entry => entry.n === 5)!.w = ['第5句|dì jù|'] // content word without a gloss
      return answer
    })
    await translateMedia(id, new AbortController().signal)
    expect(windowCalls()).toHaveLength(1)
    expect(followUps()).toHaveLength(1)
    expect(bodyOf(followUps()[0][1]).lines.map(entry => entry.line)).toEqual([2, 3, 5, 10, 11, 12, 13, 14, 15])
    const saved = (await db.mediaItems.get(id))!.aligned!
    expect(isTranslated(saved, 20)).toBe(true)
    expect(saved.sentences.find(sentence => sentence.lines[0] === 12)).toMatchObject({ translation: 'T12', lines: [12, 12] })
    expect(saved.tokens.find(entry => entry.line === 5)!.items[0].meaning).toBe('sentence')
  })

  it('splits a window whose reply was too large into two halves instead of asking it again whole, down to ~6 lines', async () => {
    const id = await item(lines.slice(0, 22))
    const asked: [number, number][] = []
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) return followAnswer(request as never)
      const body = bodyOf(request as never)
      const first = body.lines[0].line
      asked.push([first, first + body.lines.length])
      if (body.lines.length > 6) throw new Error('The AI response was too large. Request less content.')
      return reply(first, first + body.lines.length)
    })
    await translateMedia(id, new AbortController().signal)
    // 22 -> 11 + 11 -> 6 + 5 each; the whole window was asked once, never again as it was.
    expect(asked.filter(([from, to]) => from === 0 && to === 22)).toHaveLength(1)
    expect(asked).toContainEqual([0, 11]); expect(asked).toContainEqual([11, 22])
    expect(asked.filter(([from, to]) => to - from > 11)).toEqual([[0, 22]])
    const saved = (await db.mediaItems.get(id))!.aligned!
    expect(isTranslated(saved, 22)).toBe(true)
    expect(saved.tokens.map(entry => entry.line)).toEqual(lines.slice(0, 22).map((_, i) => i))
    expect(vi.mocked(console.info).mock.calls.some(call => String(call[0]).includes('splitting into'))).toBe(true)
  })

  it('does not split a window for a network error, only retries it', async () => {
    const id = await item(lines.slice(0, 22))
    let tries = 0
    completion.mockImplementation(async (_connection, request) => {
      if (!isFollowUp(request as never) && tries++ === 0) throw new Error('network down')
      return answerWindow(_connection, request as never)
    })
    await translateMedia(id, new AbortController().signal)
    expect(windowCalls().every(call => bodyOf(call[1]).lines.length === 22)).toBe(true)
    expect(windowCalls()).toHaveLength(2)
  })

  it('does not stop the run for a window that keeps failing: the rest is saved, the failed range is reported and refilled by the next run', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      if (!isFollowUp(request as never) && bodyOf(request as never).lines[0].line === 44) throw new Error('network down')
      return answerWindow(_connection, request as never)
    })
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow(/lines 45-66 failed: network down/)
    expect(completion.mock.calls.filter(call => bodyOf(call[1]).lines[0].line === 44)).toHaveLength(RUN.retries + 1)
    let saved = (await db.mediaItems.get(id))!.aligned!
    expect(saved.upTo).toBe(130)
    expect(saved.missing).toEqual([[44, 66]])
    expect(isTranslated(saved, 130)).toBe(false)
    expect(saved.tokens.length).toBe(130 - 22)
    completion.mockClear()
    completion.mockImplementation(answerWindow)
    await translateMedia(id, new AbortController().signal)
    expect(completion.mock.calls.map(call => bodyOf(call[1]).lines[0].line)).toEqual([44])
    saved = (await db.mediaItems.get(id))!.aligned!
    expect(saved.missing).toBeUndefined()
    expect(isTranslated(saved, 130)).toBe(true)
    expect(saved.tokens.map(entry => entry.line)).toEqual(lines.map((_, i) => i))
  })

  it('names every failed part when several fail', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      const first = isFollowUp(request as never) ? -1 : bodyOf(request as never).lines[0].line
      if (first === 22 || first === 88) throw new Error('boom')
      return answerWindow(_connection, request as never)
    })
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow(/2 parts failed \(lines 23-44, lines 89-110\).*Retry failed parts/)
    expect((await db.mediaItems.get(id))!.aligned!.missing).toEqual([[22, 44], [88, 110]])
  })

  it('retries a failed window and succeeds when a retry works', async () => {
    const id = await item()
    const seen = new Map<number, number>()
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) return followAnswer(request as never)
      const first = bodyOf(request as never).lines[0].line
      seen.set(first, (seen.get(first) ?? 0) + 1)
      if (first === 44 && seen.get(first)! <= 2) throw new Error('blip')
      return answerWindow(_connection, request as never)
    })
    await translateMedia(id, new AbortController().signal)
    expect(seen.get(44)).toBe(3)
    expect(isTranslated((await db.mediaItems.get(id))!.aligned, 130)).toBe(true)
  })

  it('has several requests in flight at once, bounded by the concurrency setting (12 by default), and reports the active windows', async () => {
    expect(getConcurrency()).toBe(12)
    expect(setConcurrency(99)).toBe(16)
    expect(getConcurrency()).toBe(16)
    expect(setConcurrency(0)).toBe(12)
    localStorage.removeItem('media-translation-concurrency')
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
    active = 0; peak = 0
    const again = await item(big)
    await translateMedia(again, new AbortController().signal)
    expect(peak).toBe(12)
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

describe('translation progress', () => {
  it('counts every saved line once: monotonic and ending at the total through overlap, a split window, a gap fill and a retry', async () => {
    const id = await item()
    let failedOnce = false
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) return followAnswer(request as never)
      const body = bodyOf(request as never)
      const first = body.lines[0].line
      const size = body.lines.length
      if (first === 66 && size > 6) throw new Error('The AI response was too large. Request less content.') // split in halves
      if (first === 88 && !failedOnce) { failedOnce = true; throw new Error('blip') } // retried
      const answer = reply(first, first + size)
      if (first === 0) { answer.s[answer.s.length - 1].l = [20, 23]; answer.s[answer.s.length - 1].f = [{ n: 20, t: 'x' }]; answer.k = tokens(0, 24) } // spills into the next chunk
      if (first === 22) { answer.s[0].l = [22, 24]; answer.s[0].f = [{ n: 22, t: 'x' }]; answer.s.splice(1, 1) } // overlaps the spill: dropped, leaving line 24 for a gap fill
      return answer
    })
    const progress: number[] = []
    const totals = new Set<number>()
    await translateMedia(id, new AbortController().signal, (done, total) => { progress.push(done); totals.add(total) })
    expect(totals).toEqual(new Set([130]))
    expect(progress[0]).toBe(0)
    expect(progress[progress.length - 1]).toBe(130)
    expect([...progress].sort((x, y) => x - y)).toEqual(progress)
    expect(Math.max(...progress)).toBe(130)
    expect(windowCalls().some(call => bodyOf(call[1]).lines.length === 1 && bodyOf(call[1]).lines[0].line === 24)).toBe(true) // the gap fill
    expect(vi.mocked(console.info).mock.calls.some(call => String(call[0]).includes('splitting into'))).toBe(true)
  })
  it('starts a resumed run from the saved count', async () => {
    const id = await item()
    completion.mockImplementation(async (_connection, request) => {
      if (isFollowUp(request as never)) return followAnswer(request as never)
      const first = bodyOf(request as never).lines[0].line
      if (first === 44) throw new Error('network down')
      return answerWindow(_connection, request as never)
    })
    await expect(translateMedia(id, new AbortController().signal)).rejects.toThrow()
    completion.mockImplementation(answerWindow)
    const progress: number[] = []
    await translateMedia(id, new AbortController().signal, done => progress.push(done))
    expect(progress[0]).toBe(130 - 22)
    expect(progress[progress.length - 1]).toBe(130)
    expect([...progress].sort((x, y) => x - y)).toEqual(progress)
  })
})

describe('starting over', () => {
  it('discards the saved translation and the word links, so both passes can run again', async () => {
    const id = await item(lines.slice(0, 22))
    completion.mockImplementation(answerWindow)
    await translateMedia(id, new AbortController().signal)
    await db.mediaItems.update(id, { entries: { links: { 第0句: 'vocabulary:x' }, skipped: [], counts: {}, total: 1, complete: true, updatedAt: 1 } })
    await clearTranslation(id)
    const saved = (await db.mediaItems.get(id))!
    expect(saved.aligned).toBeUndefined()
    expect(saved.entries).toBeUndefined()
    completion.mockClear()
    await translateMedia(id, new AbortController().signal)
    expect(windowCalls().length).toBeGreaterThan(0)
    expect(isTranslated((await db.mediaItems.get(id))!.aligned, 22)).toBe(true)
  })
  it('asks for consistent pinyin: lower-case titles, one fixed form per name', async () => {
    const id = await item(lines.slice(0, 22))
    completion.mockImplementation(answerWindow)
    await translateMedia(id, new AbortController().signal)
    const system = (completion.mock.calls[0][1] as { system: string }).system
    expect(system).toMatch(/titles and common nouns are lower case/)
    expect(system).toMatch(/Jìngyún, never Jìng Yún/)
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

describe('trial fixes', () => {
  it('flags a fragment far longer than its line', () => {
    expect(bleeds("Today, I'm taking you in, so listen to what I say.", '今日')).toBe(true)
    expect(bleeds('Today', '今日')).toBe(false)
  })
  it('normalises pinyin to the most frequent spelling', () => {
    const tok = (pinyin: string) => ({ text: '镇国公府', pinyin, meaning: '', trailing: '' })
    const { tokens, changed } = normalizePinyin([{ line: 0, items: [tok('a')] }, { line: 1, items: [tok('b')] }, { line: 2, items: [tok('b')] }])
    expect(changed).toBe(1)
    expect(tokens.every(entry => entry.items[0].pinyin === 'b')).toBe(true)
  })
})
