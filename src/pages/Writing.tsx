import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleHelp, Eraser, Play, Square, Undo2, Volume2, VolumeX, X } from 'lucide-react'
import { characterAssetIndex, characterAttributionUrl, loadCharacterAsset, type CharacterAsset } from '../core/characters/assets'
import { recordCharacterPractice } from '../core/characters/store'
import { distance, makeStrokeGuide, writingPoint, type Point } from '../core/characters/geometry'
import { advanceRound, commitStroke, isLastStep, memoryHint, newWritingRound, PHASES, previousRound, REPETITIONS, type WritingRound } from '../core/characters/practice'
import { buildWritingRoute, isHan, neighbourIndex, parseWritingQuery } from '../core/characters/writing-route'
import { useCatalog } from '../components/study/useCatalog'
import { EmptyState, type PageProps } from '../components/shared'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../core/assistant/speech'
import { haptic } from '../core/haptics'
import { savePreferences } from '../core/learning'
import { Pinyin } from '../components/Pinyin'
import './writing.css'

function routeCharacter(codepoint?: string): string | undefined {
  if (!codepoint || !/^[\da-f]{4,6}$/i.test(codepoint)) return undefined
  const code = Number.parseInt(codepoint, 16)
  if (code > 0x10ffff) return undefined
  return String.fromCodePoint(code)
}
const hasAsset = (character?: string) => character !== undefined && characterAssetIndex.some(asset => asset.character === character)

/** Where a freshly opened character starts; set by Previous/Next so a hash-only route change can carry it. */
let arrival: { character: string; phase: number; repetition: number; saved: boolean; at: number } | undefined
function takeArrival(character: string) {
  return arrival && arrival.character === character && Date.now() - arrival.at < 5000 ? arrival : undefined
}
const go = (route: string) => { window.location.replace(`#${route}`) }

export function Writing({ codepoint, scope, query, ...props }: PageProps & { codepoint?: string; scope?: string; query?: string }) {
  const character = routeCharacter(codepoint)
  const playable = hasAsset(character) ? character : undefined
  const [asset, setAsset] = useState<CharacterAsset>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const scopeName = scope === 'knowledge' ? 'knowledge' : 'all'
  const { word, index, back: requestedBack } = useMemo(() => parseWritingQuery(query, character), [query, character])
  const back = requestedBack ?? `dictionary/characters/${scopeName}`
  const routeFor = (at: number) => buildWritingRoute(word[at], scopeName, { word: word.join(''), index: at, back: requestedBack })
  const nextIndex = word.length ? neighbourIndex(word, index, 1) : undefined
  const previousIndex = word.length ? neighbourIndex(word, index, -1) : undefined
  useEffect(() => {
    let disposed = false
    setAsset(undefined)
    setError('')
    if (playable) loadCharacterAsset(playable).then(value => { if (!disposed) setAsset(value) },
      reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true }
  }, [playable, retry])
  if (!playable) return <EmptyState title="This stroke guide is not available.">
    <p>{character && word.length ? `No guide for ${character}.` : 'No character was substituted. Choose an available guide from the dictionary.'}</p>
    <div className="button-row">{nextIndex !== undefined && <a className="button primary" href={`#${routeFor(nextIndex)}`}>Skip to next character</a>}
      <a className="button secondary" href={`#${back}`}>Back</a></div></EmptyState>
  if (error) return <EmptyState title="The stroke guide could not be loaded."><p role="alert">{error}</p><div className="button-row"><button className="button primary" onClick={() => setRetry(value => value + 1)}>Retry</button><a className="button secondary" href={`#${back}`}>Back</a></div></EmptyState>
  const han = word.filter(isHan)
  const skipped = word.filter(item => isHan(item) && !hasAsset(item))
  const hanPosition = word.slice(0, index + 1).filter(isHan).length
  return asset ? <WritingPlayer key={asset.character} {...props} asset={asset} back={back}
    place={han.length > 1 ? { number: hanPosition, total: han.length } : undefined} skipped={skipped}
    hasPrevious={previousIndex !== undefined} last={nextIndex === undefined}
    onPrevious={() => { if (previousIndex === undefined) return; arrival = { character: word[previousIndex], phase: PHASES.length - 1, repetition: REPETITIONS - 1, saved: true, at: Date.now() }; go(routeFor(previousIndex)) }}
    onNext={() => { if (nextIndex === undefined) { go(back); return } arrival = { character: word[nextIndex], phase: 0, repetition: 0, saved: false, at: Date.now() }; go(routeFor(nextIndex)) }} />
    : <p role="status">Loading stroke guide...</p>
}

export interface WritingPlayerProps {
  asset: CharacterAsset
  /** Route (no "#") for the Back link. */
  back: string
  place?: { number: number; total: number }
  skipped?: string[]
  hasPrevious?: boolean
  /** No later character to advance to: Next on the final step finishes. */
  last?: boolean
  onPrevious?: () => void
  /** Called once the character's nine repetitions are saved (or were already) and Next is pressed. */
  onNext?: () => void
}

export function WritingPlayer({ asset, back, place, skipped = [], hasPrevious = false, last = true, onPrevious, onNext, workspace, run, busy }: PageProps & WritingPlayerProps) {
  const guides = useMemo(() => asset.paths.map(makeStrokeGuide), [asset.paths])
  const [arrived] = useState(() => takeArrival(asset.character))
  const [round, setRound] = useState<WritingRound>(() => arrived ? { ...newWritingRound(), phase: arrived.phase, repetition: arrived.repetition } : newWritingRound())
  const [ink, setInk] = useState<Point[]>([])
  const [replay, setReplay] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [help, setHelp] = useState(false)
  const saveLock = useRef(false)
  const saved = useRef(arrived?.saved ?? false)
  const svg = useRef<SVGSVGElement>(null)
  const pointer = useRef<{ id: number; points: Point[]; bounds: DOMRect }>()
  const marker = useId().replace(/:/g, '')
  const speechId = useId()
  const autoSpeak = workspace.preferences.writingAutoSpeak !== false
  useEffect(() => () => {
    if (getPlaybackState().activeId === speechId) stopBrowserSpeech()
  }, [speechId])
  useEffect(() => {
    if (!autoSpeak && getPlaybackState().activeId === speechId) stopBrowserSpeech()
  }, [autoSpeak, speechId])
  const { catalog } = useCatalog()
  const word = useMemo(() => catalog ? [...catalog.units.values()].find(unit => unit.kind === 'vocabulary' && unit.record.ch.includes(asset.character)) : undefined, [catalog, asset.character])
  const completed = round.completed === guides.length
  const hint = memoryHint(round) && !completed
  const hidden = round.phase === 2 && !round.finished
  const current = guides[round.completed]
  const state = workspace.characterStates.find(entry => entry.character === asset.character)
  const atStart = round.phase === 0 && round.repetition === 0 && !round.finished
  const canPrevious = !saving && !busy && (!atStart || hasPrevious)
  const finalStep = isLastStep(round)

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
  useEffect(() => {
    if (!help) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setHelp(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [help])

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
    const next = commitStroke(round, active.points, guides)
    if (next !== round) haptic(next.completed > round.completed ? 'success' : 'error', workspace.preferences.haptics !== false)
    setRound(value => commitStroke(value, active.points, guides))
    // Every finished stroke, accepted or missed, says the character; blocked speech stays silent.
    if (autoSpeak) { try { playBrowserSpeech(speechId, asset.character, 'zh-Hans') } catch { /* ignore */ } }
  }
  function previous() {
    if (!canPrevious) return
    cancelStroke()
    setReplay(null)
    const earlier = previousRound(round)
    if (earlier) setRound(earlier)
    else onPrevious?.()
  }
  function next() {
    if (!completed || saveLock.current || round.finished) return
    cancelStroke()
    setReplay(null)
    if (!finalStep) { setRound(advanceRound(round, guides.length)); return }
    if (saved.current) { onNext?.(); return }
    saveLock.current = true
    setSaving(true)
    void run(async () => {
      try {
        await recordCharacterPractice(asset.character)
        saved.current = true
        setRound(value => ({ ...value, finished: true, feedback: '' }))
        onNext?.()
      } finally {
        saveLock.current = false
        setSaving(false)
      }
    })
  }
  const status = round.feedback || (round.finished ? 'All nine repetitions done. Practice saved; no mastery score is assigned.'
    : replay !== null ? `Watching stroke ${replay + 1} of ${guides.length}. This does not complete a stroke.`
      : completed ? 'Complete. Press Next.'
        : `${round.completed}/${guides.length} strokes. ${hint ? 'Trace the revealed stroke.' : hidden ? 'Write from memory.' : 'Follow the blue dot and arrow.'}`)
  const phaseHelp = round.phase === 0 ? 'Trace the outlines in order. Start at the blue dot and follow the arrow.'
    : round.phase === 1 ? 'Only the next stroke is shown. Complete it to reveal the following guide.'
      : 'Write the character you just practiced. Two misses on the same stroke reveal its guide; later strokes stay hidden.'
  const progress = round.finished ? 'Saved' : completed ? 'Complete' : `${round.completed}/${guides.length}`

  return <div className="writing-page" data-assistant-exclude>
    <header className="writing-header">
      <a className="text-link writing-back" href={`#${back}`} aria-label="Back" title="Back"><ArrowLeft size={16} />Back</a>
      <p className="writing-title">
        <span className={hidden ? 'writing-title-hidden' : 'writing-title-character'} lang={hidden ? undefined : 'zh-Hans'} aria-label={hidden ? 'From memory' : undefined}>{hidden ? '\u25a1' : asset.character}</span>
        {word?.kind === 'vocabulary' && <span className="writing-title-word">
          <span lang="zh-Hans">{hidden ? Array.from(word.record.ch).map(character => character === asset.character ? '\u25a1' : character).join('') : word.record.ch}</span>
          {workspace.preferences.pinyin && <> <Pinyin text={word.record.pr} /></>} <span className="muted">{word.record.ds}</span></span>}
      </p>
      <button className="icon-button writing-help-button" type="button" aria-label="About this exercise" title="About this exercise" aria-expanded={help} aria-controls="writing-sheet" onClick={() => setHelp(value => !value)}><CircleHelp size={18} /></button>
      {help && <div id="writing-sheet" className="writing-sheet" role="dialog" aria-label="About this exercise">
        <button className="icon-button writing-sheet-close" type="button" aria-label="Close" onClick={() => setHelp(false)}><X size={16} /></button>
        <p id="writing-help"><strong>{PHASES[round.phase]}.</strong> {phaseHelp}</p>
        <p>Three repetitions in each of three phases: full guide, one stroke at a time, then memory. Use a mouse, touch or pen. Next advances once the character is complete; Previous steps back.</p>
        <p>Watching stroke order is optional and does not count as tracing. Press Escape to cancel an in-progress stroke. Leaving this page restarts an unfinished round.</p>
        <p>{asset.reviewed ? 'This guide retains the earlier prototype artwork review.' : 'Source-derived artwork; this character has not received an individual visual review.'} Matching is a tracing aid, not handwriting recognition.</p>
        {state && state.practiceCompletions > 0 && <p>Completed rounds: {state.practiceCompletions}</p>}
        <a className="text-link" href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>
      </div>}
    </header>
    <section className="writing-workbench" aria-label="Writing exercise">
      <div className="writing-statusline">
        <span><strong>{PHASES[round.phase]}</strong> &middot; {round.repetition + 1}/{REPETITIONS}</span>
        <ol className="writing-phases" aria-label="Phase">{PHASES.map((phase, index) => <li key={phase} title={phase} data-done={round.phase > index || round.finished ? '' : undefined} aria-current={round.phase === index ? 'step' : undefined}><span className="visually-hidden">{phase}</span></li>)}</ol>
        {place && <span className="writing-place">Character {place.number} of {place.total}</span>}
      </div>
      {skipped.length > 0 && <p className="writing-skipped small muted">No guide for {skipped.join(', ')}; skipped.</p>}
      <svg ref={svg} viewBox="0 0 100 100" className="writing-pad" role="img" aria-label="Handwriting area" aria-describedby="writing-status" tabIndex={0}
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
      <div className="writing-controls" role="toolbar" aria-label="Writing controls">
        <button className="icon-button" aria-label={`${autoSpeak ? 'Mute' : 'Unmute'} automatic character audio`} aria-pressed={!autoSpeak}
          title={autoSpeak ? 'Mute automatic character audio' : 'Unmute automatic character audio'} disabled={busy}
          onClick={() => { if (autoSpeak) stopBrowserSpeech(); void run(() => savePreferences({ writingAutoSpeak: !autoSpeak })) }}>{autoSpeak ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <button className="icon-button" title="Undo last stroke" aria-label="Undo" disabled={!round.completed || round.finished || saving || busy} onClick={() => { cancelStroke(); setReplay(null); setRound(value => ({ ...value, completed: Math.max(0, value.completed - 1), feedback: '' })) }}><Undo2 size={18} /></button>
        <button className="icon-button" title="Clear this character" aria-label="Clear" disabled={round.finished || saving || busy} onClick={() => { cancelStroke(); setReplay(null); setRound(value => ({ ...value, completed: 0, misses: [], feedback: '' })) }}><Eraser size={18} /></button>
        <button className="icon-button" title={replay === null ? 'Watch stroke order' : 'Stop demonstration'} aria-label={replay === null ? 'Watch stroke order' : 'Stop demonstration'} disabled={saving || busy} onClick={() => { cancelStroke(); setReplay(value => value === null ? 0 : null) }}>{replay === null ? <Play size={18} /> : <Square size={18} />}</button>
        <span className="writing-progress" data-complete={completed ? '' : undefined} title="Stroke progress" aria-hidden="true">{completed && <Check size={15} />}{progress}</span>
        <button className="button secondary writing-step" title="Previous repetition, phase or character" aria-label="Previous" disabled={!canPrevious} onClick={previous}><ChevronLeft size={18} /><span>Prev</span></button>
        <button className="button primary writing-step" title={finalStep && last ? 'Finish and save' : 'Next repetition, phase or character'} aria-label={finalStep && last ? 'Finish' : 'Next'} disabled={!completed || saving || busy || replay !== null || round.finished} onClick={next}><span>{saving ? 'Saving' : finalStep && last ? 'Finish' : 'Next'}</span><ChevronRight size={18} /></button>
      </div>
      <p id="writing-status" className="writing-feedback" role="status" aria-live="polite">{status}</p>
    </section>
  </div>
}
