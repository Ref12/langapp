import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handwritingReport, readMode, recognizeStrokes, resetHandwritingEngine, saveMode } from './handwritingEngine'
import type { HandwritingRecognizer } from './handwriting'
import type { Point } from './geometry'

const drawing: Point[][] = [[[10, 10], [50, 50]]]
const timing = { times: [[0, 20]], inputType: 'touch' as const }
const allowed = '\u9e23\u9e1f\u9e21\u9e22\u9e24\u9e25\u9e26\u9e27\u9e28\u9e29'
const builtin = (letters = '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b'): HandwritingRecognizer => ({
  recognize: vi.fn(async () => Array.from(letters).map((character, index) => ({ character, score: index }))), dispose: vi.fn(),
})
const nav = navigator as unknown as Record<string, unknown>
const install = (query: unknown, create?: unknown) => { nav.queryHandwritingRecognizer = query; nav.createHandwritingRecognizer = create }
const chromeWith = (predictions: () => Promise<{ text: string }[]>) => {
  const addStroke = vi.fn()
  const startDrawing = vi.fn(() => ({ addStroke, getPrediction: predictions }))
  return { addStroke, startDrawing, create: vi.fn(async () => ({ startDrawing })) }
}
const all = allowed + '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b'

beforeEach(() => { resetHandwritingEngine(); localStorage.clear() })
afterEach(() => { delete nav.queryHandwritingRecognizer; delete nav.createHandwritingRecognizer })

describe('Google engine', () => {
  const reply = (body: unknown, ok = true, status = 200) => vi.fn(async () => ({ ok, status, json: async () => body }))
  afterEach(() => vi.unstubAllGlobals())
  it('sends pad-pixel ink with times, keeps allowed single characters in Google order, and tops up from the built-in matcher', async () => {
    const fetchMock = reply(['SUCCESS', [['id', ['\u9e23', '\u9e23\u9e1f', '+', '\u9e1f', '\u9e23', '\u4e0d'], [], {}]]])
    vi.stubGlobal('fetch', fetchMock)
    const result = await recognizeStrokes(builtin(), [[[10, 10], [50, 50]], [[0, 100], [100, 0]]], all, { times: [[0, 20], [40, 60]], inputType: 'touch' }, 8, 'google')
    expect(result.engine).toBe('google')
    expect(result.indicator).toBe('Recognizer: Google (online)')
    expect(result.candidates.map(item => item.character + item.engine[0])).toEqual(['\u9e23g', '\u9e1fg', '\u4e00b', '\u4e8cb', '\u4e09b', '\u56dbb', '\u4e94b', '\u516db'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string; headers: Record<string, string> }]
    expect(url).toBe('https://inputtools.google.com/request?ime=handwriting&app=translate&cs=1&oe=UTF-8')
    expect(init.method).toBe('POST'); expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body) as { requests: { ink: number[][][]; language: string; max_num_results: number; writing_guide: object }[] }
    expect(body.requests[0]).toMatchObject({ language: 'zh_CN', max_num_results: 10, writing_guide: { writing_area_width: 300, writing_area_height: 300 } })
    expect(body.requests[0].ink).toEqual([[[30, 150], [30, 150], [0, 20]], [[0, 300], [300, 0], [40, 60]]])
    const report = await handwritingReport() as { lookups: { engine: string; googleCandidates: number; googleMs: number }[] }
    expect(report.lookups[0]).toMatchObject({ engine: 'google', googleCandidates: 2 })
    expect(typeof report.lookups[0].googleMs).toBe('number')
  })
  it('falls back to the built-in matcher and says why on non-SUCCESS, HTTP errors, offline and timeouts', async () => {
    const cases: [string, ReturnType<typeof vi.fn>][] = [
      ['Google unavailable: ERROR', reply(['ERROR'])],
      ['Google unavailable: HTTP 500', reply(null, false, 500)],
      ['Google unavailable: offline or blocked', vi.fn(async () => { throw new TypeError('Failed to fetch') })],
    ]
    for (const [text, mock] of cases) {
      vi.stubGlobal('fetch', mock)
      const result = await recognizeStrokes(builtin(), drawing, all, timing, 8, 'google')
      expect(result.engine).toBe('builtin')
      expect(result.indicator).toBe('Recognizer: built-in matcher \u00b7 ' + text)
      expect(result.candidates).toHaveLength(8)
    }
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))))
    const pending = recognizeStrokes(builtin(), drawing, all, timing, 8, 'google')
    await vi.advanceTimersByTimeAsync(3100)
    expect((await pending).indicator).toBe('Recognizer: built-in matcher \u00b7 Google unavailable: timed out after 3 s')
    vi.useRealTimers()
    expect(((await handwritingReport()) as { lookups: { error?: string }[] }).lookups[0].error).toBe('Google: timed out after 3 s')
  })
  it('stops a stale request when the caller aborts it', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))))
    const control = new AbortController()
    const pending = recognizeStrokes(builtin(), drawing, all, timing, 8, 'google', control.signal)
    control.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('is never called in Auto, Chrome or Built-in mode', async () => {
    const fetchMock = reply(['SUCCESS', [['id', ['\u9e23']]]])
    vi.stubGlobal('fetch', fetchMock)
    for (const mode of ['auto', 'chrome', 'builtin'] as const) await recognizeStrokes(builtin(), drawing, all, timing, 8, mode)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('remembers the Google choice per device', () => { saveMode('google'); expect(readMode()).toBe('google') })
})

describe('handwriting engine', () => {
  it('puts Chrome candidates first, keeps only allowed single characters, and tops up from the built-in matcher', async () => {
    const chrome = chromeWith(async () => [{ text: '\u9e23' }, { text: '\u9e23\u9e1f' }, { text: 'x' }, { text: '\u9e1f' }, { text: '\u9e23' }, { text: '\u4e0d' }])
    const query = vi.fn(async (c: { languages: string[] }) => c.languages[0] === 'zh-CN' ? {} : undefined)
    install(query, chrome.create)
    const result = await recognizeStrokes(builtin('\u9e1f\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03'), drawing, all, timing, 8, 'auto')
    expect(result.engine).toBe('chrome')
    expect(result.candidates.map(item => item.character + item.engine[0])).toEqual(['\u9e23c', '\u9e1fc', '\u4e00b', '\u4e8cb', '\u4e09b', '\u56dbb', '\u4e94b', '\u516db'])
    expect(result.indicator).toBe('Recognizer: Chrome (on-device)')
    expect(query.mock.calls.map(call => call[0].languages[0])).toEqual(['zh-Hans', 'zh-CN'])
    expect(chrome.create).toHaveBeenCalledWith({ languages: ['zh-CN'] })
    expect(chrome.startDrawing).toHaveBeenCalledWith({ recognitionType: 'text', inputType: 'touch', alternatives: 10 })
    expect(chrome.addStroke).toHaveBeenCalledTimes(1)
  })
  it('falls back with the right indicator when the API is missing or no tag is supported', async () => {
    const missing = await recognizeStrokes(builtin(), drawing, all, timing, 8, 'auto')
    expect(missing.engine).toBe('builtin')
    expect(missing.indicator).toBe('Recognizer: built-in matcher \u00b7 Chrome handwriting not available')
    resetHandwritingEngine()
    install(vi.fn(async () => undefined), vi.fn())
    const unsupported = await recognizeStrokes(builtin(), drawing, all, timing, 8, 'auto')
    expect(unsupported.indicator).toContain('Chrome handwriting not available')
    expect(await handwritingReport()).toMatchObject({ chromeApiPresent: true, languageTag: null, queries: { 'zh-Hans': 'not supported', 'zh-CN': 'not supported', zh: 'not supported' }, engineInUse: 'builtin' })
  })
  it('switches to the built-in matcher for the session when Chrome throws, and records the error', async () => {
    const chrome = chromeWith(async () => { throw new Error('model missing') })
    install(async () => ({}), chrome.create)
    const result = await recognizeStrokes(builtin(), drawing, all, timing, 8, 'auto')
    expect(result.engine).toBe('builtin')
    expect(result.indicator).toBe('Recognizer: built-in matcher \u00b7 Chrome error: model missing')
    await recognizeStrokes(builtin(), drawing, all, timing, 8, 'auto')
    expect(chrome.startDrawing).toHaveBeenCalledTimes(1)
    const report = await handwritingReport() as { lastError: string; lookups: { engine: string; builtinCandidates: number }[] }
    expect(report.lastError).toBe('model missing')
    expect(report.lookups).toHaveLength(2)
    expect(report.lookups[0]).toMatchObject({ engine: 'builtin', builtinCandidates: 8 })
    expect(JSON.stringify(report)).not.toContain('\u4e00')
  })
  it('lets the toggle force each engine and remembers it', async () => {
    const chrome = chromeWith(async () => [{ text: '\u9e23' }])
    install(async () => ({}), chrome.create)
    const forced = await recognizeStrokes(builtin(), drawing, all, timing, 8, 'builtin')
    expect(forced.engine).toBe('builtin'); expect(forced.indicator).toBe('Recognizer: built-in matcher'); expect(chrome.startDrawing).not.toHaveBeenCalled()
    expect((await recognizeStrokes(builtin(), drawing, all, timing, 8, 'chrome')).engine).toBe('chrome')
    saveMode('builtin'); expect(readMode()).toBe('builtin')
    saveMode('auto'); expect(readMode()).toBe('auto')
  })
})
