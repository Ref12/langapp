import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, Undo2, X } from 'lucide-react'
import { pinyin } from 'pinyin-pro'
import { distance, writingPoint, type Point } from '../../core/characters/geometry'
import { createHandwritingRecognizer, type HandwritingRecognizer } from '../../core/characters/handwriting'
import { chromeAvailable, indicatorText, probeChromeHandwriting, readMode, recognizeStrokes, saveMode, type Candidate, type EngineMode, type EngineName, type InkTiming } from '../../core/characters/handwritingEngine'
import { Pinyin } from '../Pinyin'
import { getPack } from '../../core/language'

const DEBOUNCE_MS = 150
const SLOTS = 8
const engineLabel: Record<EngineName, string> = { chrome: 'Chrome', google: 'Google', builtin: 'built-in matcher' }

/** Draw a character with a finger or pen; stroke order, direction and neatness do not matter. */
export function HandwritingPad({ allowed, preferred, onPick, onClose }: {
  /** Characters a result may be: the catalog (and Characters section) set. */
  allowed: ReadonlySet<string>
  /** The learner's lesson characters: the built-in matcher favours them between close candidates. */
  preferred?: ReadonlySet<string>
  onPick: (character: string) => void
  onClose: () => void
}) {
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [ink, setInk] = useState<Point[]>([])
  const [results, setResults] = useState<Candidate[]>([])
  const [mode, setMode] = useState<EngineMode>(readMode)
  const [used, setUsed] = useState<EngineName>()
  const [indicator, setIndicator] = useState<string>()
  const [probed, setProbed] = useState(false)
  const [, setTick] = useState(0)
  const pack = getPack()
  const target = pack.writing.handwriting
  const learningTag = pack.learningTag
  const preferredText = useMemo(() => target.favourLessons ? [...(preferred ?? [])].join('') : '', [preferred, target])
  const candidates = useMemo(() => results.map(item => item.character), [results])
  const times = useRef(new WeakMap<Point[], number[]>())
  const origin = useRef(0)
  const inputType = useRef<InkTiming['inputType']>('touch')
  const [status, setStatus] = useState('Draw the character with your finger. Any stroke order works.')
  const svg = useRef<SVGSVGElement>(null)
  const pointer = useRef<{ id: number; points: Point[]; bounds: DOMRect }>()
  const recognizer = useRef<HandwritingRecognizer>()
  const latest = useRef(0)
  const allowedText = useMemo(() => [...allowed].join(''), [allowed])
  const readings = useMemo(() => new Map(target.pinyin ? candidates.map(character => [character, pinyin(character, { toneType: 'symbol' })]) : []), [candidates, target])

  useEffect(() => {
    recognizer.current = createHandwritingRecognizer()
    void probeChromeHandwriting(target).then(() => setProbed(true), () => setProbed(true))
    return () => { recognizer.current?.dispose(); recognizer.current = undefined }
  }, [target])
  useEffect(() => {
    // Drawing never needs the keyboard: drop the focus the search box may still hold.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur()
  }, [])
  useEffect(() => {
    const request = ++latest.current
    if (!strokes.length) { setResults([]); setStatus('Draw the character with your finger. Any stroke order works.'); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setStatus('Looking...')
      const timing: InkTiming = { times: strokes.map(stroke => times.current.get(stroke) ?? []), inputType: inputType.current }
      if (!recognizer.current) return
      void recognizeStrokes(recognizer.current, strokes, allowedText, timing, SLOTS, mode, controller.signal, target, preferredText).then(result => {
        if (request !== latest.current) return
        setResults(result.candidates); setUsed(result.engine); setIndicator(result.indicator)
        setStatus(result.candidates.length ? 'Tap the character you meant.' : 'No match. Try again or clear.')
      }, reason => {
        if (request !== latest.current) return
        setResults([])
        setStatus(reason instanceof Error ? reason.message : 'Handwriting lookup is unavailable.')
      })
    }, DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [strokes, allowedText, preferredText, mode, target])

  const cancel = useCallback(() => {
    const active = pointer.current
    if (!active) return
    pointer.current = undefined
    if (svg.current?.hasPointerCapture(active.id)) svg.current.releasePointerCapture(active.id)
    setInk([])
  }, [])
  useEffect(() => {
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); pointer.current = undefined }
  }, [cancel])

  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.isPrimary === false || event.button !== 0 || pointer.current) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const points = [writingPoint(event.clientX, event.clientY, bounds)]
    const now = performance.now()
    if (!strokes.length) origin.current = now
    inputType.current = event.pointerType === 'pen' ? 'stylus' : event.pointerType === 'mouse' ? 'mouse' : 'touch'
    times.current.set(points, [Math.round(now - origin.current)])
    pointer.current = { id: event.pointerId, points, bounds }
    event.currentTarget.setPointerCapture(event.pointerId)
    setInk(points)
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    const point = writingPoint(event.clientX, event.clientY, active.bounds)
    if (distance(active.points[active.points.length - 1], point) >= 0.35) {
      active.points.push(point)
      times.current.get(active.points)?.push(Math.round(performance.now() - origin.current))
      setInk([...active.points])
    }
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    active.points.push(writingPoint(event.clientX, event.clientY, active.bounds))
    times.current.get(active.points)?.push(Math.round(performance.now() - origin.current))
    pointer.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setInk([])
    setStrokes(value => [...value, active.points])
  }

  return <section className="handwriting" aria-label="Draw a character">
    <div className="handwriting-head">
      <strong>Draw a character</strong>
      <span className="handwriting-tools">
        <button type="button" className="icon-button" aria-label="Undo stroke" title="Undo stroke" disabled={!strokes.length} onClick={() => { cancel(); setStrokes(value => value.slice(0, -1)) }}><Undo2 size={18} /></button>
        <button type="button" className="icon-button" aria-label="Clear drawing" title="Clear drawing" disabled={!strokes.length} onClick={() => { cancel(); setStrokes([]) }}><Eraser size={18} /></button>
        <button type="button" className="icon-button" aria-label="Close drawing pad" title="Close" onClick={onClose}><X size={18} /></button>
      </span>
    </div>
    <svg ref={svg} viewBox="0 0 100 100" className="handwriting-pad" role="img" aria-label="Handwriting area" aria-describedby="handwriting-status"
      onPointerDown={start} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={event => { if (pointer.current?.id === event.pointerId) cancel() }}
      onLostPointerCapture={event => { if (pointer.current?.id === event.pointerId) cancel() }}>
      <path d="M50 0 V100 M0 50 H100" className="writing-gridlines" />
      {strokes.map((stroke, index) => <polyline key={index} points={stroke.map(point => point.join(',')).join(' ')} className="writing-ink" aria-hidden="true" />)}
      {ink.length > 0 && <polyline points={ink.map(point => point.join(',')).join(' ')} className="writing-ink" aria-hidden="true" />}
    </svg>
    <p id="handwriting-status" className="handwriting-status small muted" role="status" aria-live="polite">{status}</p>
    <p className="handwriting-engine small muted" data-testid="handwriting-engine">
      <span>{indicator ?? indicatorText(mode, used, target)}</span>
      <span role="group" aria-label="Recognizer" className="handwriting-engine-toggle">
        {(['auto', 'chrome', 'google', 'builtin'] as const).map(value => <button key={value} type="button" className="handwriting-engine-option" aria-pressed={mode === value}
          disabled={value === 'chrome' && probed && !chromeAvailable(target)} onClick={() => { saveMode(value); setMode(value); setIndicator(undefined); setUsed(undefined); setTick(tick => tick + 1) }}>{value === 'auto' ? 'Auto' : value === 'chrome' ? 'Chrome' : value === 'google' ? 'Google' : 'Built-in'}</button>)}
      </span>
    </p>
    {mode === 'google' && <p className="small muted" data-testid="handwriting-google-note">Google: unofficial handwriting service; your strokes are sent to Google.</p>}
    <ul className="handwriting-candidates" aria-label="Candidate characters">
      {Array.from({ length: SLOTS }, (_, slot) => {
        const item = results[slot]
        const character = item?.character
        const topUp = used !== 'builtin' && used !== undefined && item?.engine === 'builtin'
        return <li key={slot}>{character && <button type="button" className={'handwriting-candidate' + (topUp ? ' topped-up' : '')} title={'From ' + engineLabel[item.engine]} aria-label={`${character}, from ${engineLabel[item.engine]}`} onClick={() => { cancel(); setStrokes([]); onPick(character) }}>
          <span lang={learningTag} className="handwriting-character">{character}</span>
          {target.pinyin && <span className="handwriting-reading"><Pinyin text={readings.get(character) ?? ''} /></span>}</button>}</li>
      })}
    </ul>
  </section>
}
