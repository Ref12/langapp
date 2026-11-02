import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { loadCharacterAsset } from '../../core/characters/assets'
import { distance, makeStrokeGuide, writingPoint, type Point } from '../../core/characters/geometry'
import { commitStroke, memoryHint, newWritingRound, type WritingRound } from '../../core/characters/practice'
import { hasGuide, isHan } from '../../core/characters/writing-route'
import '../writing.css'

/** Draw the target characters from memory, no outline: each stroke is checked against the character's stroke data. Two misses on a stroke reveal it (a hint). */
export function StrokePad({ text, disabled, onDone, onStep }: { text: string; disabled?: boolean; onDone: (result: { misses: number; hinted: boolean }) => void; onStep?: (index: number, total: number) => void }) {
  const characters = useMemo(() => Array.from(text).filter(character => isHan(character) && hasGuide(character)), [text])
  const [index, setIndex] = useState(0)
  const [paths, setPaths] = useState<string[]>()
  const [error, setError] = useState('')
  const [round, setRound] = useState<WritingRound>({ ...newWritingRound(), phase: 2 })
  const [ink, setInk] = useState<Point[]>([])
  const totals = useRef({ misses: 0, hinted: false })
  const pointer = useRef<{ id: number; points: Point[]; bounds: DOMRect }>()
  const finished = useRef(false)
  const character = characters[index]
  useEffect(() => { onStep?.(index, characters.length) }, [index, characters.length, onStep])
  useEffect(() => {
    let live = true
    setPaths(undefined)
    if (!character) return
    loadCharacterAsset(character).then(asset => { if (live) setPaths(asset.paths) }, reason => { if (live) setError(reason instanceof Error ? reason.message : 'The stroke data could not be loaded.') })
    return () => { live = false }
  }, [character])
  const guides = useMemo(() => (paths ?? []).map(makeStrokeGuide), [paths])
  const hint = memoryHint(round) && round.completed < guides.length
  useEffect(() => { if (hint) totals.current.hinted = true }, [hint])
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
    pointer.current = { id: event.pointerId, points, bounds }
    event.currentTarget.setPointerCapture(event.pointerId)
    setInk(points)
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    const point = writingPoint(event.clientX, event.clientY, active.bounds)
    if (distance(active.points[active.points.length - 1], point) >= 0.35) { active.points.push(point); setInk([...active.points]) }
  }
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    active.points.push(writingPoint(event.clientX, event.clientY, active.bounds))
    pointer.current = undefined
    setInk([])
    const next = commitStroke(round, active.points, guides)
    if (next.completed === round.completed) totals.current.misses++
    setRound(next)
  }
  const status = error || (done ? 'Written.' : !guides.length ? 'Loading the stroke guide…' : round.feedback || `Stroke ${round.completed + 1} of ${guides.length}. Write it from memory.`)
  return <div className="dr-strokepad">
    <p className="small muted" aria-live="polite">{status}</p>
    <svg viewBox="0 0 100 100" className="writing-pad dr-pad-svg" role="img" aria-label="Handwriting area" tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={end}
      onPointerCancel={() => { pointer.current = undefined; setInk([]) }}>
      <path d="M50 0 V100 M0 50 H100 M0 0 L100 100 M100 0 L0 100" className="writing-gridlines" />
      <g aria-hidden="true">{guides.map((guide, i) => (i < round.completed || (hint && i === round.completed))
        ? <path key={i} d={guide.path} className={`writing-guide${i < round.completed ? ' completed' : ''}`} /> : null)}</g>
      {ink.length > 1 && <polyline className="writing-ink" points={ink.map(point => point.join(',')).join(' ')} fill="none" />}
    </svg>
    {done && <p className="small accent"><CheckCircle2 size={14} aria-hidden="true" /> All strokes checked.</p>}
  </div>
}
