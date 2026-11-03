import type { Point } from './geometry'
import type { HandwritingRecognizer } from './handwriting'

/** Which recognizer produced a candidate. */
export type EngineName = 'chrome' | 'builtin'
export type EngineMode = 'auto' | 'chrome' | 'builtin'
export interface Candidate { character: string; engine: EngineName }
export interface EngineResult {
  candidates: Candidate[]
  /** Engine that answered first (Chrome when it was used, even if topped up). */
  engine: EngineName
  /** Short text for the indicator under the candidates. */
  indicator: string
}
/** What the pad collects besides the points: when each point was made (ms since the first stroke began) and the pointer type. */
export interface InkTiming { times: number[][]; inputType: 'touch' | 'mouse' | 'stylus' }

interface ChromeDrawing { addStroke(stroke: unknown): void; getPrediction(): Promise<{ text: string }[]>; clear?(): void }
interface ChromeRecognizer { startDrawing(hints: object): ChromeDrawing; finish?(): void }
interface ChromeNavigator {
  queryHandwritingRecognizer?: (constraint: { languages: string[] }) => Promise<unknown>
  createHandwritingRecognizer?: (constraint: { languages: string[] }) => Promise<ChromeRecognizer>
}

export const LANGUAGE_TAGS = ['zh-Hans', 'zh-CN', 'zh'] as const
const STORAGE_KEY = 'handwriting-engine'
const ALTERNATIVES = 10
const KEEP_LOOKUPS = 20

export interface LookupRecord { at: string; engine: EngineName; ms: number; chromeCandidates: number; builtinCandidates: number }
interface State {
  probe?: Promise<void>
  apiPresent: boolean
  queries: Record<string, string>
  tag?: string
  recognizer?: Promise<ChromeRecognizer>
  lastError?: string
  broken: boolean
  lastEngine?: EngineName
  lookups: LookupRecord[]
}
const fresh = (): State => ({ apiPresent: false, queries: {}, broken: false, lookups: [] })
let state = fresh()

/** For tests. */
export const resetHandwritingEngine = () => { state = fresh() }

const chromeApi = () => (typeof navigator === 'undefined' ? {} : navigator) as ChromeNavigator
const message = (error: unknown) => (error instanceof Error ? error.message || error.name : String(error)).slice(0, 120)

/** Feature-detect and ask Chrome about each Chinese tag, once; the answer per tag is kept for Diagnostics. */
export function probeChromeHandwriting(): Promise<void> {
  state.probe ??= (async () => {
    const api = chromeApi()
    state.apiPresent = typeof api.queryHandwritingRecognizer === 'function' && typeof api.createHandwritingRecognizer === 'function'
    if (!state.apiPresent) return
    for (const tag of LANGUAGE_TAGS) {
      try {
        const result = await api.queryHandwritingRecognizer!({ languages: [tag] })
        state.queries[tag] = result ? 'supported' : 'not supported'
        if (result) { state.tag = tag; return }
      } catch (error) { state.queries[tag] = 'error: ' + message(error) }
    }
  })()
  return state.probe
}

export const chromeAvailable = () => state.apiPresent && state.tag !== undefined && !state.broken

export function readMode(): EngineMode {
  try { const value = localStorage.getItem(STORAGE_KEY); return value === 'chrome' || value === 'builtin' ? value : 'auto' } catch { return 'auto' }
}
export function saveMode(mode: EngineMode): void {
  try { if (mode === 'auto') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, mode) } catch { /* private mode */ }
}

/** Indicator text for the current state, before any lookup too. */
export function indicatorText(mode: EngineMode, used: EngineName | undefined): string {
  if (used === 'chrome') return 'Recognizer: Chrome (on-device)'
  if (mode === 'builtin') return 'Recognizer: built-in matcher'
  if (state.lastError) return 'Recognizer: built-in matcher \u00b7 Chrome error: ' + state.lastError
  if (!state.probe) return 'Recognizer: checking\u2026'
  if (!chromeAvailable()) return 'Recognizer: built-in matcher \u00b7 Chrome handwriting not available'
  return 'Recognizer: Chrome (on-device)'
}

const getRecognizer = () => state.recognizer ??= chromeApi().createHandwritingRecognizer!({ languages: [state.tag!] })

async function chromePredict(drawing: Point[][], allowed: ReadonlySet<string>, timing: InkTiming): Promise<string[]> {
  const recognizer = await getRecognizer()
  const session = recognizer.startDrawing({ recognitionType: 'text', inputType: timing.inputType, alternatives: ALTERNATIVES })
  const Stroke = (globalThis as { HandwritingStroke?: new () => { addPoint(point: object): void } }).HandwritingStroke
  drawing.forEach((points, index) => {
    const stroke = Stroke ? new Stroke() : makeStroke()
    points.forEach((point, at) => stroke.addPoint({ x: point[0], y: point[1], t: Math.round(timing.times[index]?.[at] ?? at * 8) }))
    session.addStroke(stroke)
  })
  const predictions = await session.getPrediction()
  session.clear?.()
  const seen = new Set<string>()
  const kept: string[] = []
  for (const { text } of predictions) {
    if (Array.from(text).length !== 1 || !allowed.has(text) || seen.has(text)) continue
    seen.add(text); kept.push(text)
  }
  return kept
}
function makeStroke() { const points: object[] = []; return { points, addPoint: (point: object) => { points.push(point) } } }

/** Recognize with Chrome when allowed and working, topping up from the built-in matcher; otherwise the built-in matcher alone. */
export async function recognizeStrokes(builtin: HandwritingRecognizer, drawing: Point[][], allowedText: string, timing: InkTiming, slots: number, mode: EngineMode): Promise<EngineResult> {
  const t0 = performance.now()
  await probeChromeHandwriting()
  const allowed = new Set(Array.from(allowedText))
  let chrome: string[] | undefined
  if (mode !== 'builtin' && chromeAvailable()) {
    try { chrome = await chromePredict(drawing, allowed, timing) } catch (error) {
      state.lastError = message(error); state.broken = true; state.recognizer = undefined
    }
  }
  const own = (chrome && chrome.length >= slots) ? [] : (await builtin.recognize(drawing, allowedText)).map(match => match.character)
  const candidates: Candidate[] = (chrome ?? []).map(character => ({ character, engine: 'chrome' as const }))
  for (const character of own) if (candidates.length < slots && !candidates.some(item => item.character === character)) candidates.push({ character, engine: 'builtin' })
  const engine: EngineName = chrome ? 'chrome' : 'builtin'
  const shown = candidates.slice(0, slots)
  state.lastEngine = engine
  state.lookups.unshift({ at: new Date().toISOString(), engine, ms: Math.round(performance.now() - t0), chromeCandidates: shown.filter(item => item.engine === 'chrome').length, builtinCandidates: shown.filter(item => item.engine === 'builtin').length })
  state.lookups.length = Math.min(state.lookups.length, KEEP_LOOKUPS)
  return { candidates: shown, engine, indicator: indicatorText(mode, engine) }
}

/** Section of the Diagnostics report: support, per-tag query results, engine in use, last error and timings. No ink, no characters. */
export async function handwritingReport() {
  await probeChromeHandwriting()
  return {
    chromeApiPresent: state.apiPresent,
    queries: { ...state.queries },
    languageTag: state.tag ?? null,
    mode: readMode(),
    engineInUse: state.lastEngine ?? (readMode() === 'builtin' || !chromeAvailable() ? 'builtin' : 'chrome'),
    ...(state.lastError ? { lastError: state.lastError } : {}),
    lookups: state.lookups.map(item => ({ ...item })),
  }
}
