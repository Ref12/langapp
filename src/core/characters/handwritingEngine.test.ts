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
