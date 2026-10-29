import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, Undo2, X } from 'lucide-react'
import { pinyin } from 'pinyin-pro'
import { distance, writingPoint, type Point } from '../../core/characters/geometry'
import { createHandwritingRecognizer, type HandwritingRecognizer } from '../../core/characters/handwriting'
import { Pinyin } from '../Pinyin'

const DEBOUNCE_MS = 150
const SLOTS = 8

/** Draw a character with a finger or pen; stroke order, direction and neatness do not matter. */
export function HandwritingPad({ allowed, onPick, onClose }: {
  /** Characters a result may be: the catalog (and Characters section) set. */
  allowed: ReadonlySet<string>
  onPick: (character: string) => void
  onClose: () => void
}) {
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [ink, setInk] = useState<Point[]>([])
  const [candidates, setCandidates] = useState<string[]>([])
  const [status, setStatus] = useState('Draw the character with your finger. Any stroke order works.')
  const svg = useRef<SVGSVGElement>(null)
  const pointer = useRef<{ id: number; points: Point[]; bounds: DOMRect }>()
  const recognizer = useRef<HandwritingRecognizer>()
  const latest = useRef(0)
  const allowedText = useMemo(() => [...allowed].join(''), [allowed])
  const readings = useMemo(() => new Map(candidates.map(character => [character, pinyin(character, { toneType: 'symbol' })])), [candidates])

  useEffect(() => {
    recognizer.current = createHandwritingRecognizer()
    return () => { recognizer.current?.dispose(); recognizer.current = undefined }
  }, [])
  useEffect(() => {
    // Drawing never needs the keyboard: drop the focus the search box may still hold.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur()
  }, [])
  useEffect(() => {
    const request = ++latest.current
    if (!strokes.length) { setCandidates([]); setStatus('Draw the character with your finger. Any stroke order works.'); return }
    const timer = window.setTimeout(() => {
      setStatus('Looking...')
      recognizer.current?.recognize(strokes, allowedText).then(matches => {
        if (request !== latest.current) return
        setCandidates(matches.slice(0, SLOTS).map(match => match.character))
        setStatus(matches.length ? 'Tap the character you meant.' : 'No match. Try again or clear.')
      }, reason => {
        if (request !== latest.current) return
        setCandidates([])
        setStatus(reason instanceof Error ? reason.message : 'Handwriting lookup is unavailable.')
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [strokes, allowedText])

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
      setInk([...active.points])
    }
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    active.points.push(writingPoint(event.clientX, event.clientY, active.bounds))
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
    <ul className="handwriting-candidates" aria-label="Candidate characters">
      {Array.from({ length: SLOTS }, (_, slot) => {
        const character = candidates[slot]
        return <li key={slot}>{character && <button type="button" className="handwriting-candidate" onClick={() => { cancel(); setStrokes([]); onPick(character) }}>
          <span lang="zh-Hans" className="handwriting-character">{character}</span>
          <span className="handwriting-reading"><Pinyin text={readings.get(character) ?? ''} /></span></button>}</li>
      })}
    </ul>
  </section>
}
