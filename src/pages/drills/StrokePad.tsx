import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { loadCharacterAsset } from '../../core/characters/assets'
import { distance, makeStrokeGuide, writingPoint, type Point, type StrokeMatching } from '../../core/characters/geometry'
import { advanceTrace, traceComplete, tracedPoints } from '../../core/characters/tracer'
import { commitStroke, completeTracedStroke, memoryHint, newWritingRound, tracerStroke, type WritingRound } from '../../core/characters/practice'
import { getPack } from '../../core/language'
import { haptic } from '../../core/haptics'
import '../writing.css'

/** Draw the target characters from memory, no outline: each stroke is checked against the character's stroke data. Two misses on a stroke reveal it (a hint). */
export function StrokePad({ text, disabled, haptics = true, matching, onDone, onStep }: { text: string; disabled?: boolean; haptics?: boolean; matching?: StrokeMatching; onDone: (result: { misses: number; hinted: boolean }) => void; onStep?: (index: number, total: number) => void }) {
  const characters = useMemo(() => getPack().writing.guidedChars(text), [text])
  const [index, setIndex] = useState(0)
  const [paths, setPaths] = useState<string[]>()
  const [error, setError] = useState('')
  const [round, setRound] = useState<WritingRound>({ ...newWritingRound(), phase: 2 })
  const [ink, setInk] = useState<Point[]>([])
  const totals = useRef({ misses: 0, hinted: false })
  const pointer = useRef<{ id: number; points: Point[]; bounds: DOMRect; tracer: boolean }>()
  const [trace, setTrace] = useState({ key: '', progress: 0 })
  const traceRef = useRef(trace)
  const finished = useRef(false)
  const character = characters[index]
  useEffect(() => { onStep?.(index, characters.length) }, [index, characters.length, onStep])
  useEffect(() => {
    let live = true
    setPaths(undefined)
    if (!character) return
    loadCharacterAsset(character, getPack().writing.language).then(asset => { if (live) setPaths(asset.paths) }, reason => { if (live) setError(reason instanceof Error ? reason.message : 'The stroke data could not be loaded.') })
    return () => { live = false }
  }, [character])
  const guides = useMemo(() => (paths ?? []).map(makeStrokeGuide), [paths])
  const hint = memoryHint(round) && round.completed < guides.length
  const traceKey = `${index}:${round.completed}`
  const tracing = tracerStroke(round) && round.completed < guides.length
  const traced = trace.key === traceKey ? trace.progress : 0
  useEffect(() => { if (hint || tracing) totals.current.hinted = true }, [hint, tracing])
  useEffect(() => {
    if (!guides.length || round.completed < guides.length) return
    if (index + 1 < characters.length) { setIndex(index + 1); setRound({ ...newWritingRound(), phase: 2 }); return }
    if (!finished.current) { finished.current = true; onDone({ ...totals.current }) }
  }, [round.completed, guides.length, index, characters.length, onDone])
  if (!characters.length) return <p className="small muted" role="status">There is no stroke guide for these characters. Write it on paper instead.</p>
  const done = finished.current
  const start = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || pointer.current || disabled || done || !guides.length) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const points = [writingPoint(event.clientX, event.clientY, bounds)]
    pointer.current = { id: event.pointerId, points, bounds, tracer: tracing }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tracing) { follow(points[0]); return }
    setInk(points)
  }
  /** Tracer: draw the stroke up to the pointer (forward only, kept between drags); the end completes it, as a hint. */
  const follow = (point: Point) => {
    const guide = guides[round.completed]
    if (!guide) return
    const before = traceRef.current.key === traceKey ? traceRef.current.progress : 0
    const after = advanceTrace(before, point, guide)
    if (after === before && traceRef.current.key === traceKey) return
    traceRef.current = { key: traceKey, progress: after }
    setTrace(traceRef.current)
    if (!traceComplete(after, guide)) return
    pointer.current = undefined
    haptic('success', haptics)
    setRound(value => completeTracedStroke(value, guides))
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    const point = writingPoint(event.clientX, event.clientY, active.bounds)
    if (active.tracer) { follow(point); return }
    if (distance(active.points[active.points.length - 1], point) >= 0.35) { active.points.push(point); setInk([...active.points]) }
  }
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    active.points.push(writingPoint(event.clientX, event.clientY, active.bounds))
    pointer.current = undefined
    setInk([])
    if (active.tracer) { follow(active.points[active.points.length - 1]); return }
    const next = commitStroke(round, active.points, guides, matching)
    if (next.completed === round.completed) totals.current.misses++
    if (next !== round) haptic(next.completed > round.completed ? 'success' : 'error', haptics)
    setRound(next)
  }
  const status = error || (done ? 'Written.' : !guides.length ? 'Loading the stroke guide…' : tracing ? 'Tracer on: drag along the stroke; you can lift and continue. This counts as a hint.' : round.feedback || `Stroke ${round.completed + 1} of ${guides.length}. Write it from memory.`)
  return <div className="dr-strokepad">
    <p className="small muted" aria-live="polite">{status}</p>
    <svg viewBox="0 0 100 100" className="writing-pad dr-pad-svg" data-tracer={tracing ? '' : undefined} role="img" aria-label="Handwriting area" tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={end}
      onPointerCancel={() => { pointer.current = undefined; setInk([]) }}>
      <path d="M50 0 V100 M0 50 H100 M0 0 L100 100 M100 0 L0 100" className="writing-gridlines" />
      <g aria-hidden="true">{guides.map((guide, i) => (i < round.completed || (hint && i === round.completed))
        ? <path key={i} d={guide.path} className={`writing-guide${i < round.completed ? ' completed' : ''}`} /> : null)}</g>
      {tracing && traced > 0 && <polyline className="writing-trace" data-testid="tracer-trace" aria-hidden="true" points={tracedPoints(guides[round.completed], traced).map(point => point.join(',')).join(' ')} />}
      {ink.length > 1 && <polyline className="writing-ink" points={ink.map(point => point.join(',')).join(' ')} fill="none" />}
    </svg>
    {done && <p className="small accent"><CheckCircle2 size={14} aria-hidden="true" /> All strokes checked.</p>}
  </div>
}
