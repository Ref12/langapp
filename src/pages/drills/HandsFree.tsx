import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Headphones, ListChecks, Moon, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { db } from '../../core/database'
import { EmptyState, PageHeading, type PageProps } from '../../components/shared'
import { useCatalog } from '../../components/study/useCatalog'
import { HandsfreeSettingsForm } from '../../components/handsfree/HandsfreeSettingsForm'
import { type HandsfreeRun, type HandsfreeSettings } from '../../core/handsfree/contracts'
import { buildRunScript, completeHandsfreeRun, saveHandsfreeSettings, updateHandsfreeRun } from '../../core/handsfree/store'
import { addedLine } from '../../core/handsfree/summary'
import { resolveVoices } from '../../core/handsfree/voices'
import { pinyin as toPinyin } from 'pinyin-pro'
import { loadItems, type ItemInfo } from '../../core/drills/items'
import { IntroCards } from './IntroCards'
import { createHandsfreePlayer, type HandsfreeState } from '../../core/handsfree/player'
import { PHASE_LABEL, type Script } from '../../core/handsfree/script'
import { createWakeLockController } from '../../core/pocket/wake-lock'
import './drills.css'

/** Pocket mode exits after this long a hold, counted down 3, 2, 1 inside a progress ring. */
const HOLD_SECONDS = 3
const TICK_MS = 100
const HAN_TEXT = /\p{Script=Han}/u

/** What has been spoken of the current prompt's answer: Chinese (shown with pinyin) from the moment it starts, or the English answer. */
interface Heard { zh?: string; en?: string }
const hasHan = (text: string) => HAN_TEXT.test(text)

/** The player's display, also the pocket-mode screen: the phase, the prompt, then the answer once it is being spoken. */
function Display({ phase, prompt, heard, done, total, position, added, className = '' }: { phase: string; prompt: string; heard: Heard; done: boolean; total: number; position: number; added: string; className?: string }) {
  const zh = heard.zh
  const main = done ? 'Well done.' : zh ?? prompt
  return <div className={'hf-display ' + className}>
    <p className="hf-phase" role="status">{phase}</p>
    {!done && zh && !hasHan(prompt) && prompt && <p className="hf-cue">{prompt}</p>}
    <p className="hf-prompt" lang={!done && hasHan(main) ? 'zh-Hans' : undefined}>{main}</p>
    {!done && zh && <p className="hf-pinyin" data-testid="hf-pinyin">{toPinyin(zh, { toneType: 'symbol' })}</p>}
    {!done && heard.en && <p className="hf-answer" data-testid="hf-answer">{heard.en}</p>}
    {done && added && <p className="hf-added" role="status">{added}</p>}
    <progress aria-label="Run progress" value={done ? total : Math.min(position, total)} max={Math.max(1, total)} />
  </div>
}


export function HandsFree({ runId, ...props }: PageProps & { runId?: string }) {
  const run = useLiveQuery(async () => runId ? (await db.handsfreeRuns.get(runId)) ?? null : null, [runId])
  if (run === undefined) return <div className="opening-workspace" role="status">Opening Hands-free...</div>
  if (run === null) return <EmptyState title="This Hands-free run is not available"><p>It may have been removed from this workspace.</p><a className="button primary" href="#practice">Back to Practice</a></EmptyState>
  return <Player key={run.id} hf={run} {...props} />
}

const settingsKey = (settings: HandsfreeSettings) => `${settings.repeats}:${settings.grammar}:${settings.emphasisRate}:${settings.zhRate}`

function Player({ hf: run, workspace, now, run: perform, busy }: PageProps & { hf: HandsfreeRun }) {
  const { catalog } = useCatalog()
  const [items, setItems] = useState<ItemInfo[]>()
  // A run that has not started opens on its intro cards; one that has goes straight to the player, with an Items button to see them again.
  const [view, setView] = useState<'intro' | 'player'>(run.started ? 'player' : 'intro')
  const [listening, setListening] = useState(false)
  const voicesRef = useRef({ settings: run.settings, saved: workspace.preferences.speechVoices })
  voicesRef.current = { settings: run.settings, saved: workspace.preferences.speechVoices }
  useEffect(() => {
    if (!catalog) return
    let live = true
    void loadItems(run.refs, catalog).then(found => { if (live) setItems(found) })
    return () => { live = false }
  }, [run.refs, catalog])
  const [script, setScript] = useState<Script>()
  const [error, setError] = useState('')
  const [state, setState] = useState<HandsfreeState>({ status: 'idle', prompt: run.position })
  const [pocket, setPocket] = useState(false)
  const [heard, setHeard] = useState<Heard>({})
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
      if (next.status === 'completed') void completeHandsfreeRun(runId, total).catch(cause => setError(cause instanceof Error ? cause.message : 'The new items could not be added to your knowledge set.'))
      else if (next.status === 'playing' || next.status === 'paused') {
        lastSaved.current = next.prompt
        void updateHandsfreeRun(runId, { status: 'active', ...(next.status === 'playing' ? { started: true } : {}), position: next.prompt })
      }
    }, startRef.current, () => resolveVoices(voicesRef.current.settings, voicesRef.current.saved, typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices() : []),
    // The answer shows only when its segment starts: Chinese with pinyin, or the English answer to a Chinese prompt.
    segment => setHeard(before => !segment ? (before.zh || before.en ? {} : before) : segment.locale === 'zh-Hans' ? { zh: segment.text } : segment.answer ? { ...before, en: segment.text } : before))
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

  const phaseLine = done ? 'Finished' : marker ? PHASE_LABEL[marker.phase] + ' ' + marker.index + ' of ' + marker.total : script ? 'Ready' : 'Preparing...'
  // Start listening plays at once when the script is ready, or as soon as it is.
  const startListening = () => { setView('player'); setListening(true) }
  useEffect(() => {
    if (!listening || !script || !total) return
    setListening(false)
    playerRef.current?.play()
  }, [listening, script, total])

  useMediaSession(run.title, marker ? `${PHASE_LABEL[marker.phase]} ${marker.index} of ${marker.total}` : '', playerRef, !!script)

  if (view === 'intro') return <div className="dr hf">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> Practice</a>
    <PageHeading eyebrow="Hands-free" title={run.title}>Here is everything you will hear. Read the cards first, or skip them and listen.</PageHeading>
    {error && <p className="notice error" role="alert">{error}</p>}
    {catalog && items ? <IntroCards items={items} catalog={catalog} workspace={workspace} now={now} run={perform} busy={busy} route={`practice/handsfree/${run.id}`} /> : <p className="small muted" role="status">Opening the intro cards...</p>}
    <div className="hf-startbar"><button type="button" className="button primary" onClick={startListening}><Headphones size={18} /> Start listening</button></div>
  </div>

  return <div className="dr hf">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> Practice</a>
    <PageHeading eyebrow="Hands-free" title={run.title} action={<button type="button" className="button secondary" onClick={() => { playerRef.current?.pause(); setView('intro') }}><ListChecks size={16} /> Items</button>}>Listen, answer aloud, hear the answer, repeat it. Nothing is graded.</PageHeading>
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="panel hf-stage" aria-label="Now playing" aria-live="polite">
      <Display phase={phaseLine} prompt={marker?.prompt ?? ''} heard={heard} done={done} total={total} position={state.prompt} added={addedLine(run.addedRefs)} />
      <div className="hf-controls">
        <button type="button" className="button secondary icon-only" aria-label="Back" disabled={!script || state.prompt <= 0 && !done} onClick={() => playerRef.current?.back()}><SkipBack size={22} /></button>
        <button type="button" className="button primary hf-play" aria-label={playing ? 'Pause' : done ? 'Play again' : state.prompt > 0 ? 'Resume' : 'Play'} disabled={!script || !total} onClick={() => playing ? playerRef.current?.pause() : playerRef.current?.play()}>{playing ? <Pause size={26} /> : <Play size={26} />}</button>
        <button type="button" className="button secondary icon-only" aria-label="Skip" disabled={!script || done} onClick={() => playerRef.current?.skip()}><SkipForward size={22} /></button>
      </div>
      <button type="button" className="button secondary" onClick={() => setPocket(true)}><Moon size={16} /> Pocket mode</button>
    </section>
    <section className="panel hf-settings" aria-label="Settings">
      <HandsfreeSettingsForm settings={run.settings} onChange={change} structureLocked={run.started} />
    </section>
    {pocket && <PocketOverlay onExit={() => setPocket(false)}><Display phase={phaseLine} prompt={marker?.prompt ?? ''} heard={heard} done={done} total={total} position={state.prompt} added={addedLine(run.addedRefs)} className="hf-pocket-display" /></PocketOverlay>}
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

/** Pocket mode: the player's display full screen on a dark background. Keeps the screen on; touches do nothing except a 3 second hold, which shows a ring and a 3, 2, 1 count and exits. */
function PocketOverlay({ onExit, children }: { onExit: () => void; children: ReactNode }) {
  const [ticks, setTicks] = useState(0)
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>()
  const exit = useRef(onExit)
  exit.current = onExit
  useEffect(() => {
    const lock = createWakeLockController()
    lock.start()
    return () => lock.stop()
  }, [])
  const clear = useCallback(() => { clearInterval(timer.current); timer.current = undefined; setHolding(false); setTicks(0) }, [])
  useEffect(() => clear, [clear])
  const begin = () => {
    clear()
    setHolding(true)
    let count = 0
    timer.current = setInterval(() => {
      count++
      setTicks(count)
      if (count * TICK_MS >= HOLD_SECONDS * 1000) { clearInterval(timer.current); timer.current = undefined; exit.current() }
    }, TICK_MS)
  }
  const swallow = (event: { preventDefault(): void; stopPropagation(): void }) => { event.preventDefault(); event.stopPropagation() }
  const total = HOLD_SECONDS * 1000 / TICK_MS
  const count = Math.max(1, HOLD_SECONDS - Math.floor(ticks * TICK_MS / 1000))
  const RADIUS = 54
  const circumference = 2 * Math.PI * RADIUS
  return <div className={'hf-pocket' + (holding ? ' holding' : '')} role="dialog" aria-modal="true" aria-label="Pocket mode. Press and hold to exit."
    onPointerDown={event => { swallow(event); begin() }} onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}
    onClick={swallow} onTouchStart={swallow} onTouchEnd={swallow} onTouchMove={swallow} onContextMenu={swallow}>
    {children}
    {holding && <div className="hf-ring" role="timer" aria-label={'Exiting in ' + count}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="hf-ring-track" cx="60" cy="60" r={RADIUS} /><circle className="hf-ring-fill" data-testid="hf-ring" cx="60" cy="60" r={RADIUS}
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(1, ticks / total))} transform="rotate(-90 60 60)" /></svg>
      <span className="hf-ring-count">{count}</span></div>}
    <p className="hf-pocket-hint">Hold anywhere to exit</p>
  </div>
}
