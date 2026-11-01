import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Moon, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { db } from '../../core/database'
import { EmptyState, PageHeading, type PageProps } from '../../components/shared'
import { PAUSE_LENGTHS, type HandsfreeRun, type HandsfreeSettings } from '../../core/handsfree/contracts'
import { buildRunScript, saveHandsfreeSettings, updateHandsfreeRun } from '../../core/handsfree/store'
import { createHandsfreePlayer, type HandsfreeState } from '../../core/handsfree/player'
import { PHASE_LABEL, type Script } from '../../core/handsfree/script'
import { createWakeLockController } from '../../core/pocket/wake-lock'
import './drills.css'

const HOLD_MS = 1000

export function HandsFree({ runId }: PageProps & { runId?: string }) {
  const run = useLiveQuery(async () => runId ? (await db.handsfreeRuns.get(runId)) ?? null : null, [runId])
  if (run === undefined) return <div className="opening-workspace" role="status">Opening Hands-free...</div>
  if (run === null) return <EmptyState title="This Hands-free run is not available"><p>It may have been removed from this workspace.</p><a className="button primary" href="#practice">Back to Practice</a></EmptyState>
  return <Player key={run.id} run={run} />
}

const settingsKey = (settings: HandsfreeSettings) => `${settings.repeats}:${settings.grammar}`

function Player({ run }: { run: HandsfreeRun }) {
  const [script, setScript] = useState<Script>()
  const [error, setError] = useState('')
  const [state, setState] = useState<HandsfreeState>({ status: 'idle', prompt: run.position })
  const [pocket, setPocket] = useState(false)
  const scriptRef = useRef<Script>({ segments: [], promptStarts: [] })
  const runId = run.id
  const structure = settingsKey(run.settings)
  const pauseLength = run.settings.pause
  // The script follows the run's own seed and settings, so leaving and coming back plays the same run. Changing the pause length keeps its shape.
  useEffect(() => {
    let live = true
    void buildRunScript(run).then(({ script: built }) => { if (live) { scriptRef.current = built; setScript(built) } }, cause => { if (live) setError(cause instanceof Error ? cause.message : 'The run could not be prepared.') })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.refs.join(','), run.seed, structure, pauseLength])

  const startRef = useRef(run.position)
  const playerRef = useRef<ReturnType<typeof createHandsfreePlayer>>()
  const lastSaved = useRef(run.position)
  useEffect(() => {
    const player = createHandsfreePlayer(`handsfree:${runId}`, () => scriptRef.current, next => {
      setState(next)
      if (next.status === 'error') setError(next.error ?? 'Audio could not be played.')
      if (next.status === 'playing') setError('')
      const total = scriptRef.current.promptStarts.length
      if (next.status === 'completed') void updateHandsfreeRun(runId, { status: 'completed', started: true, position: total })
      else if (next.status === 'playing' || next.status === 'paused') {
        lastSaved.current = next.prompt
        void updateHandsfreeRun(runId, { status: 'active', ...(next.status === 'playing' ? { started: true } : {}), position: next.prompt })
      }
    }, startRef.current)
    playerRef.current = player
    return () => {
      const at = player.state()
      player.dispose()
      // Leaving mid-run keeps it in History as stopped, and the position for coming back.
      if (at.status !== 'completed') void db.handsfreeRuns.get(runId).then(current => current?.started && current.status !== 'completed' ? updateHandsfreeRun(runId, { status: 'abandoned', position: lastSaved.current }) : undefined)
    }
  }, [runId])

  const total = script?.promptStarts.length ?? 0
  const marker = useMemo(() => {
    if (!script || state.status === 'idle' && !run.started && state.prompt === 0 && !script.promptStarts.length) return undefined
    const segment = script.segments[script.promptStarts[Math.min(state.prompt, total - 1)]]
    return segment?.kind === 'marker' ? segment : undefined
  }, [script, state.prompt, state.status, total, run.started])
  const done = state.status === 'completed'
  const playing = state.status === 'playing'
  const change = (next: HandsfreeSettings) => { saveHandsfreeSettings(next); void updateHandsfreeRun(run.id, { settings: next }) }

  useMediaSession(run.title, marker ? `${PHASE_LABEL[marker.phase]} ${marker.index} of ${marker.total}` : '', playerRef, !!script)

  return <div className="dr hf">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> Practice</a>
    <PageHeading eyebrow="Hands-free" title={run.title}>Listen, answer aloud, hear the answer, repeat it. Nothing is graded.</PageHeading>
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="panel hf-stage" aria-label="Now playing" aria-live="polite">
      <p className="hf-phase" role="status">{done ? 'Finished' : marker ? `${PHASE_LABEL[marker.phase]} ${marker.index} of ${marker.total}` : script ? 'Ready' : 'Preparing...'}</p>
      <p className="hf-prompt" lang={marker && /\p{Script=Han}/u.test(marker.prompt) ? 'zh-Hans' : undefined}>{done ? 'Well done.' : marker?.prompt ?? ''}</p>
      <progress aria-label="Run progress" value={done ? total : Math.min(state.prompt, total)} max={Math.max(1, total)} />
      <div className="hf-controls">
        <button type="button" className="button secondary icon-only" aria-label="Back" disabled={!script || state.prompt <= 0 && !done} onClick={() => playerRef.current?.back()}><SkipBack size={22} /></button>
        <button type="button" className="button primary hf-play" aria-label={playing ? 'Pause' : done ? 'Play again' : state.prompt > 0 ? 'Resume' : 'Play'} disabled={!script || !total} onClick={() => playing ? playerRef.current?.pause() : playerRef.current?.play()}>{playing ? <Pause size={26} /> : <Play size={26} />}</button>
        <button type="button" className="button secondary icon-only" aria-label="Skip" disabled={!script || done} onClick={() => playerRef.current?.skip()}><SkipForward size={22} /></button>
      </div>
      <button type="button" className="button secondary" onClick={() => setPocket(true)}><Moon size={16} /> Pocket mode</button>
    </section>
    <section className="panel hf-settings" aria-label="Settings">
      <label><span className="eyebrow accent">Pause length</span>
        <select value={run.settings.pause} aria-label="Pause length" onChange={event => change({ ...run.settings, pause: event.target.value as HandsfreeSettings['pause'] })}>
          {PAUSE_LENGTHS.map(length => <option key={length} value={length}>{length[0].toUpperCase() + length.slice(1)}</option>)}</select></label>
      <label><span className="eyebrow accent">Repeats of each new word</span>
        <select value={run.settings.repeats} aria-label="Repeats" disabled={run.started} onChange={event => change({ ...run.settings, repeats: Number(event.target.value) })}>
          {[1, 2, 3].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
      <label className="hf-check"><input type="checkbox" checked={run.settings.grammar} disabled={run.started} onChange={event => change({ ...run.settings, grammar: event.target.checked })} /> Include grammar</label>
      {run.started && <p className="small muted">Repeats and grammar are fixed once a run has started, so it resumes where you left it.</p>}
    </section>
    {pocket && <PocketOverlay onExit={() => setPocket(false)} />}
  </div>
}

function useMediaSession(title: string, album: string, playerRef: { current?: ReturnType<typeof createHandsfreePlayer> }, ready: boolean) {
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!session || !ready) return
    try {
      if (typeof MediaMetadata !== 'undefined') session.metadata = new MediaMetadata({ title, artist: 'LinguaWeave', album })
      session.setActionHandler('play', () => playerRef.current?.play())
      session.setActionHandler('pause', () => playerRef.current?.pause())
      session.setActionHandler('previoustrack', () => playerRef.current?.back())
      session.setActionHandler('nexttrack', () => playerRef.current?.skip())
    } catch { /* media-session actions are not available in every browser */ }
    return () => {
      try {
        for (const action of ['play', 'pause', 'previoustrack', 'nexttrack'] as const) session.setActionHandler(action, null)
        session.metadata = null
      } catch { /* nothing to clean up */ }
    }
  }, [title, album, ready, playerRef])
}

/** Keeps the screen on and nearly black; touches do nothing until a press held for about a second. */
function PocketOverlay({ onExit }: { onExit: () => void }) {
  const hold = useRef<ReturnType<typeof setTimeout>>()
  const [holding, setHolding] = useState(false)
  useEffect(() => {
    const lock = createWakeLockController()
    lock.start()
    return () => lock.stop()
  }, [])
  const clear = useCallback(() => { clearTimeout(hold.current); hold.current = undefined; setHolding(false) }, [])
  useEffect(() => clear, [clear])
  const begin = () => { clear(); setHolding(true); hold.current = setTimeout(onExit, HOLD_MS) }
  const swallow = (event: { preventDefault(): void; stopPropagation(): void }) => { event.preventDefault(); event.stopPropagation() }
  return <div className={`hf-pocket${holding ? ' holding' : ''}`} role="dialog" aria-modal="true" aria-label="Pocket mode. Press and hold to exit."
    onPointerDown={event => { swallow(event); begin() }} onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}
    onClick={swallow} onTouchStart={swallow} onTouchEnd={swallow} onTouchMove={swallow} onContextMenu={swallow}>
    <p>Hold to exit</p>
  </div>
}
