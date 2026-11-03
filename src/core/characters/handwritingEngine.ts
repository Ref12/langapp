import type { Point } from './geometry'
import type { HandwritingRecognizer } from './handwriting'

/** Which recognizer produced a candidate. */
export type EngineName = 'chrome' | 'google' | 'builtin'
export type EngineMode = 'auto' | 'chrome' | 'google' | 'builtin'
export interface Candidate { character: string; engine: EngineName }
export interface EngineResult {
  candidates: Candidate[]
  /** Engine that answered first (Chrome or Google when it was used, even if topped up). */
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
/** Unofficial, undocumented endpoint behind Google Translate's draw input; opt-in only, since it sends the strokes to Google. */
export const GOOGLE_URL = 'https://inputtools.google.com/request?ime=handwriting&app=translate&cs=1&oe=UTF-8'
export const GOOGLE_TIMEOUT_MS = 3000
/** The pad draws in a 0..100 box; Google gets it as a 300 x 300 writing area. */
const GOOGLE_AREA = 300

export interface LookupRecord { at: string; engine: EngineName; ms: number; chromeCandidates: number; googleCandidates: number; builtinCandidates: number; googleMs?: number; error?: string }
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
  try { const value = localStorage.getItem(STORAGE_KEY); return value === 'chrome' || value === 'google' || value === 'builtin' ? value : 'auto' } catch { return 'auto' }
}
export function saveMode(mode: EngineMode): void {
  try { if (mode === 'auto') localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, mode) } catch { /* private mode */ }
}

/** Indicator text for the current state, before any lookup too. */
export function indicatorText(mode: EngineMode, used: EngineName | undefined): string {
  if (used === 'chrome') return 'Recognizer: Chrome (on-device)'
  if (used === 'google') return 'Recognizer: Google (online)'
  if (mode === 'google') return 'Recognizer: Google (online)'
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
/** Ask Google's handwriting service; throws on a timeout, offline, HTTP error or a reply that is not SUCCESS. */
async function googlePredict(drawing: Point[][], allowed: ReadonlySet<string>, timing: InkTiming, signal?: AbortSignal): Promise<string[]> {
  const control = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; control.abort() }, GOOGLE_TIMEOUT_MS)
  const forward = () => control.abort()
  signal?.addEventListener('abort', forward)
  try {
    const ink = drawing.map((stroke, index) => [
      stroke.map(point => Math.round(point[0] * GOOGLE_AREA / 100)),
      stroke.map(point => Math.round(point[1] * GOOGLE_AREA / 100)),
      stroke.map((_, at) => Math.round(timing.times[index]?.[at] ?? at * 8)),
    ])
    const response = await fetch(GOOGLE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: control.signal,
      body: JSON.stringify({ options: 'enable_pre_space', requests: [{ writing_guide: { writing_area_width: GOOGLE_AREA, writing_area_height: GOOGLE_AREA }, max_num_results: ALTERNATIVES, max_completions: 0, ink, language: 'zh_CN' }] }),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const data = await response.json() as unknown
    if (!Array.isArray(data) || data[0] !== 'SUCCESS') throw new Error(typeof (data as unknown[])?.[0] === 'string' ? String((data as unknown[])[0]) : 'unexpected reply')
    const texts = ((data[1] as unknown[][])?.[0]?.[1] ?? []) as unknown[]
    const seen = new Set<string>()
    const kept: string[] = []
    for (const text of texts) {
      if (typeof text !== 'string' || Array.from(text).length !== 1 || !allowed.has(text) || seen.has(text)) continue
      seen.add(text); kept.push(text)
    }
    return kept
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(timedOut ? 'timed out after ' + GOOGLE_TIMEOUT_MS / 1000 + ' s' : error instanceof TypeError ? 'offline or blocked' : message(error))
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', forward) }
}

function makeStroke() { const points: object[] = []; return { points, addPoint: (point: object) => { points.push(point) } } }

/** Recognize with Chrome when allowed and working, topping up from the built-in matcher; otherwise the built-in matcher alone. */
export async function recognizeStrokes(builtin: HandwritingRecognizer, drawing: Point[][], allowedText: string, timing: InkTiming, slots: number, mode: EngineMode, signal?: AbortSignal): Promise<EngineResult> {
  const t0 = performance.now()
  await probeChromeHandwriting()
  const allowed = new Set(Array.from(allowedText))
  let chrome: string[] | undefined
  let google: string[] | undefined
  let googleError: string | undefined
  let googleMs: number | undefined
  // Google is opt-in: Auto never sends strokes anywhere.
  if (mode === 'google') {
    const g0 = performance.now()
    try { google = await googlePredict(drawing, allowed, timing, signal) } catch (error) {
      if (signal?.aborted) throw error
      googleError = message(error)
    }
    googleMs = Math.round(performance.now() - g0)
  } else if (mode !== 'builtin' && chromeAvailable()) {
    try { chrome = await chromePredict(drawing, allowed, timing) } catch (error) {
      state.lastError = message(error); state.broken = true; state.recognizer = undefined
    }
  }
  const first = google ?? chrome
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const own = (first && first.length >= slots) ? [] : (await builtin.recognize(drawing, allowedText)).map(match => match.character)
  const candidates: Candidate[] = (google ?? chrome ?? []).map(character => ({ character, engine: google ? 'google' as const : 'chrome' as const }))
  for (const character of own) if (candidates.length < slots && !candidates.some(item => item.character === character)) candidates.push({ character, engine: 'builtin' })
  const engine: EngineName = google ? 'google' : chrome ? 'chrome' : 'builtin'
  const shown = candidates.slice(0, slots)
  state.lastEngine = engine
  state.lookups.unshift({ at: new Date().toISOString(), engine, ms: Math.round(performance.now() - t0), chromeCandidates: shown.filter(item => item.engine === 'chrome').length, googleCandidates: shown.filter(item => item.engine === 'google').length, builtinCandidates: shown.filter(item => item.engine === 'builtin').length, ...(googleMs !== undefined ? { googleMs } : {}), ...(googleError ? { error: 'Google: ' + googleError } : {}) })
  state.lookups.length = Math.min(state.lookups.length, KEEP_LOOKUPS)
  const indicator = googleError ? 'Recognizer: built-in matcher \u00b7 Google unavailable: ' + googleError : indicatorText(mode, engine)
  return { candidates: shown, engine, indicator }
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
