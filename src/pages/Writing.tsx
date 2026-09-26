import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, RotateCcw, Undo2 } from 'lucide-react'
import { characterAssetIndex, characterAttributionUrl, loadCharacterAsset, type CharacterAsset } from '../core/characters/assets'
import { recordCharacterPractice } from '../core/characters/store'
import { distance, makeStrokeGuide, writingPoint, type Point } from '../core/characters/geometry'
import { advanceRound, commitStroke, memoryHint, newWritingRound, PHASES, REPETITIONS } from '../core/characters/practice'
import { useCatalog } from '../components/study/useCatalog'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import './writing.css'

function routeCharacter(codepoint?: string): string | undefined {
  if (!codepoint || !/^[\da-f]{4,6}$/i.test(codepoint)) return undefined
  const code = Number.parseInt(codepoint, 16)
  if (code > 0x10ffff) return undefined
  const character = String.fromCodePoint(code)
  return characterAssetIndex.some(asset => asset.character === character) ? character : undefined
}

export function Writing({ codepoint, scope, ...props }: PageProps & { codepoint?: string; scope?: string }) {
  const character = routeCharacter(codepoint)
  const [asset, setAsset] = useState<CharacterAsset>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const back = `#dictionary/characters/${scope === 'knowledge' ? 'knowledge' : 'all'}`
  useEffect(() => {
    let disposed = false
    setAsset(undefined)
    setError('')
    if (character) loadCharacterAsset(character).then(value => { if (!disposed) setAsset(value) },
      reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true }
  }, [character, retry])
  if (!character) return <EmptyState title="This stroke guide is not available."><p>No character was substituted. Choose an available guide from the dictionary.</p><a className="button secondary" href={back}>Back to characters</a></EmptyState>
  if (error) return <EmptyState title="The stroke guide could not be loaded."><p role="alert">{error}</p><div className="button-row"><button className="button primary" onClick={() => setRetry(value => value + 1)}>Retry</button><a className="button secondary" href={back}>Back to characters</a></div></EmptyState>
  return asset ? <WritingPlayer key={asset.character} {...props} asset={asset} back={back} /> : <p role="status">Loading stroke guide...</p>
}

export function WritingPlayer({ asset, back, workspace, run, busy }: PageProps & { asset: CharacterAsset; back: string }) {
  const guides = useMemo(() => asset.paths.map(makeStrokeGuide), [asset.paths])
  const [round, setRound] = useState(newWritingRound)
  const [ink, setInk] = useState<Point[]>([])
  const [replay, setReplay] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const svg = useRef<SVGSVGElement>(null)
  const pointer = useRef<{ id: number; points: Point[]; bounds: DOMRect }>()
  const marker = useId().replace(/:/g, '')
  const { catalog } = useCatalog()
  const word = useMemo(() => catalog ? [...catalog.units.values()].find(unit => unit.kind === 'vocabulary' && unit.record.ch.includes(asset.character)) : undefined, [catalog, asset.character])
  const completed = round.completed === guides.length
  const hint = memoryHint(round) && !completed
  const hidden = round.phase === 2 && !round.finished
  const current = guides[round.completed]
  const state = workspace.characterStates.find(entry => entry.character === asset.character)

  const cancelStroke = useCallback(() => {
    const active = pointer.current
    if (!active) return
    pointer.current = undefined
    if (svg.current?.hasPointerCapture(active.id)) svg.current.releasePointerCapture(active.id)
    setInk([])
    setRound(value => ({ ...value, feedback: 'Stroke interrupted. Start this stroke again.' }))
  }, [])
  useEffect(() => {
    const visibility = () => { if (document.hidden) cancelStroke() }
    window.addEventListener('blur', cancelStroke)
    window.addEventListener('resize', cancelStroke)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', cancelStroke)
      window.removeEventListener('resize', cancelStroke)
      document.removeEventListener('visibilitychange', visibility)
      pointer.current = undefined
    }
  }, [cancelStroke])
  useEffect(() => {
    if (replay === null) return
    const timer = window.setTimeout(() => setReplay(value => value === null || value >= guides.length - 1 ? null : value + 1), 800)
    return () => window.clearTimeout(timer)
  }, [replay, guides.length])

  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.isPrimary === false || event.button !== 0 || pointer.current || completed || round.finished || replay !== null || saving || busy) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const points = [writingPoint(event.clientX, event.clientY, bounds)]
    pointer.current = { id: event.pointerId, points, bounds }
    event.currentTarget.focus({ preventScroll: true })
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
    setRound(value => commitStroke(value, active.points, guides))
  }
  const nextLabel = round.repetition < REPETITIONS - 1 ? 'Repeat' : round.phase < PHASES.length - 1 ? 'Next phase' : 'Finish writing'
  function next() {
    if (!completed || saveLock.current) return
    cancelStroke()
    setReplay(null)
    const nextRound = advanceRound(round, guides.length)
    if (!nextRound.finished) { setRound(nextRound); return }
    saveLock.current = true
    setSaving(true)
    void run(async () => {
      try {
        await recordCharacterPractice(asset.character)
        setRound(nextRound)
      } finally {
        saveLock.current = false
        setSaving(false)
      }
    })
  }
  const status = round.feedback || (round.finished ? 'Three repetitions in each phase finished. Practice saved; no mastery score is assigned.'
    : replay !== null ? `Watching stroke ${replay + 1} of ${guides.length}. This does not complete a stroke.`
      : completed ? `Character complete. Choose ${nextLabel} to continue.`
        : `${round.completed} of ${guides.length} strokes. ${hint ? 'Trace the revealed stroke.' : hidden ? 'Write from memory.' : 'Follow the blue dot and arrow.'}`)

  return <div className="writing-page">
    <a className="text-link writing-back" href={back}><ArrowLeft size={16} />Back to characters</a>
    <PageHeading eyebrow="WRITING PRACTICE" title="Build the shape, stroke by stroke.">Three repetitions in each phase: full guide, one stroke at a time, then memory. Use a mouse, touch, or pen.</PageHeading>
    <div className="writing-layout">
      <section className="writing-workbench" aria-label="Writing exercise">
        <ol className="writing-phases">{PHASES.map((phase, index) => <li key={phase} aria-current={round.phase === index ? 'step' : undefined}><span>{index + 1}</span>{phase}</li>)}</ol>
        <div className="writing-statusline"><strong>{PHASES[round.phase]}</strong><span>Repetition {round.repetition + 1} of {REPETITIONS}</span></div>
        <svg ref={svg} viewBox="0 0 100 100" className="writing-pad" role="img" aria-label="Handwriting area" aria-describedby="writing-help" tabIndex={0}
          onPointerDown={start} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={event => { if (pointer.current?.id === event.pointerId) cancelStroke() }}
          onLostPointerCapture={event => { if (pointer.current?.id === event.pointerId) cancelStroke() }}
          onKeyDown={event => { if (event.key === 'Escape') { cancelStroke(); setReplay(null) } }}>
          <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"
            markerWidth={Math.min(6, Math.max(1.5, (current?.length ?? 20) * 0.3))} markerHeight={Math.min(6, Math.max(1.5, (current?.length ?? 20) * 0.3))}>
            <path d="M1 1 L9 5 L1 9 Z" className="writing-arrow" /></marker></defs>
          <path d="M50 0 V100 M0 50 H100 M0 0 L100 100 M100 0 L0 100" className="writing-gridlines" />
          <g aria-hidden="true" data-testid="stroke-guides">
            {guides.map((guide, index) => {
              const visible = replay !== null ? index <= replay : round.finished || index < round.completed || round.phase === 0 || (round.phase === 1 || hint) && index === round.completed
              return visible ? <path key={`${index}-${replay}`} d={guide.path} data-stroke={index}
                className={`writing-guide${replay !== null ? index === replay ? ' replaying' : ' replayed' : index < round.completed ? ' completed' : ''}`}
                strokeDasharray={replay === index ? guide.length : undefined} style={replay === index ? { '--stroke-length': guide.length } as React.CSSProperties : undefined} /> : null
            })}
          </g>
          {current && replay === null && !round.finished && (!hidden || hint) && <g aria-hidden="true" className="writing-direction">
            <path d={current.path} markerEnd={`url(#${marker})`} />
            <circle cx={current.points[0][0]} cy={current.points[0][1]} r={Math.min(5.2, Math.max(1, current.length * 0.2))} />
            {current.length >= 20 && <text x={current.points[0][0]} y={current.points[0][1]}>{round.completed + 1}</text>}
          </g>}
          {ink.length > 0 && <polyline points={ink.map(point => point.join(',')).join(' ')} className="writing-ink" aria-hidden="true" />}
        </svg>
        <p className="writing-feedback" role="status" aria-live="polite">{status}</p>
        <div className="writing-controls">
          <button className="button secondary" disabled={!round.completed || round.finished || saving || busy} onClick={() => { cancelStroke(); setReplay(null); setRound(value => ({ ...value, completed: Math.max(0, value.completed - 1), feedback: '' })) }}><Undo2 size={16} />Undo</button>
          <button className="button secondary" disabled={round.finished || saving || busy} onClick={() => { cancelStroke(); setReplay(null); setRound(value => ({ ...value, completed: 0, misses: [], feedback: '' })) }}>Clear</button>
          {round.finished ? <button className="button primary" onClick={() => { setReplay(null); setRound(newWritingRound()) }}><RotateCcw size={16} />Practice again</button>
            : <button className="button primary" disabled={!completed || saving || busy || replay !== null} onClick={next}>{saving ? 'Saving...' : nextLabel}</button>}
        </div>
      </section>
      <aside className="writing-reference panel" aria-label="Practice guidance">
        <p className="eyebrow">{hidden ? 'RECALL THE CHARACTER' : 'YOUR CHARACTER'}</p>
        <p className={hidden ? 'writing-memory-prompt' : 'writing-reference-character'} lang={hidden ? undefined : 'zh-Hans'}>{hidden ? 'From memory' : asset.character}</p>
        {word?.kind === 'vocabulary' && <div className="writing-word-context">
          <p className="small muted">Word context{hidden ? ` / character ${Array.from(word.record.ch).indexOf(asset.character) + 1}` : ''}</p>
          <p lang="zh-Hans">{hidden ? Array.from(word.record.ch).map(character => character === asset.character ? '\u25a1' : character).join('') : word.record.ch}</p>
          {workspace.preferences.pinyin && <p className="small muted">{word.record.pr}</p>}
          <p className="small">{word.record.ds}</p>
        </div>}
        <p id="writing-help">{round.phase === 0 ? 'Trace the outlines in order. Start at the blue dot and follow the arrow.'
          : round.phase === 1 ? 'Only the next stroke is shown. Complete it to reveal the following guide.'
            : 'Write the character you just practiced. Two misses on the same stroke reveal its guide; later strokes stay hidden.'}</p>
        <button className="button secondary full-width" disabled={saving || busy} onClick={() => { cancelStroke(); setReplay(value => value === null ? 0 : null) }}>{replay === null ? 'Watch stroke order' : 'Stop demonstration'}</button>
        <p className="small muted">Watching is optional and does not count as tracing. Press Escape to cancel an in-progress stroke. Leaving this page restarts an unfinished round.</p>
        <p className="small muted">{asset.reviewed ? 'This guide retains the earlier prototype artwork review.' : 'Source-derived artwork; this character has not received an individual visual review.'} Matching is a tracing aid, not handwriting recognition.</p>
        <a className="text-link small" href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>
        {state && state.practiceCompletions > 0 && <p className="small muted">Completed rounds: {state.practiceCompletions}</p>}
      </aside>
    </div>
  </div>
}
