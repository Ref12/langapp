import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Eye, Headphones, Moon, Pause, Play, Settings as SettingsIcon, SkipBack, SkipForward } from 'lucide-react'
import { PageHeading, type PageProps } from '../../components/shared'
import { useCatalog } from '../../components/study/useCatalog'
import { HandsfreeSettingsForm } from '../../components/handsfree/HandsfreeSettingsForm'
import { normalizeHandsfreeSettings, type HandsfreeSettings } from '../../core/handsfree/contracts'
import { buildRunScript, loadHandsfreeSettings, saveHandsfreeSettings } from '../../core/handsfree/store'
import { activityOf, handsfreeRoute, ensureHandsfree, finishHandsfree, updateHandsfree, type HandsfreeKind } from '../../core/drills/store'
import type { DrillSet } from '../../core/drills/contracts'
import { addedLine } from '../../core/handsfree/summary'
import { resolveVoices } from '../../core/handsfree/voices'
import { pinyin as toPinyin } from 'pinyin-pro'
import { loadItems, type ItemInfo } from '../../core/drills/items'
import { IntroCards } from './IntroCards'
import { Sheet } from './Sheet'
import { ACTIVITY_SKILLS, PROMPT_SKILLS } from '../../core/study/skill-map'
import { recordRunPractice } from '../../core/study/skills'
import { createHandsfreePlayer, type HandsfreeState } from '../../core/handsfree/player'
import { findPrompt, promptKeyAt, type Script } from '../../core/handsfree/script'
import { createWakeLockController } from '../../core/pocket/wake-lock'
import './drills.css'

/** Pocket mode exits after this long a hold, counted down 3, 2, 1 inside a progress ring. */
const HOLD_SECONDS = 3
const TICK_MS = 100
const HAN_TEXT = /\p{Script=Han}/u

/** What has been spoken of the current prompt's answer: Chinese (shown with pinyin) from the moment it starts, or the English answer. */
interface Heard { zh?: string; en?: string; /** The section introduction being spoken: shown as the header until the first prompt. */ section?: string; /** What the section contains, under its header (the Full section introductions). */ detail?: string }
/** A section introduction (index 0) shows its header in place of the progress; an item shows "Phase N of M". */
const progressLabel = (marker: { index: number; total: number; prompt: string }) => marker.index === 0 ? marker.prompt : `${marker.index} of ${marker.total}`
/** The one-line instruction for the current prompt. */
export function instructionOf(marker: { index: number; act?: string; item?: string } | undefined): string {
  if (!marker || marker.index === 0 || !marker.act) return ''
  if (marker.act === 'intro') return `New ${marker.item === 'phrase' ? 'phrase' : marker.item === 'grammar' ? 'sentence' : 'word'}: repeat after me`
  return marker.act === 'toChinese' ? 'Say it in Mandarin' : 'What does it mean? Say it in English.'
}
const hasHan = (text: string) => HAN_TEXT.test(text)

/** The player's display, also the pocket-mode screen: the phase, the prompt, then the answer once it is being spoken. */
function Display({ phase, instruction = '', fresh, prompt, heard, done, total, position, added, className = '' }: { phase: string; instruction?: string; /** True for a new item, false for a review one, undefined for no tag. */ fresh?: boolean; prompt: string; heard: Heard; done: boolean; total: number; position: number; added: string; className?: string }) {
  const zh = heard.zh
  const main = done ? 'Well done.' : heard.section ?? zh ?? prompt
  return <div className={'hf-display ' + className}>
    <p className="hf-phase" role="status">{phase}</p>
    {!done && instruction && <p className="hf-instruction" data-testid="hf-instruction">{fresh !== undefined && <span className={'hf-tag' + (fresh ? ' hf-new' : '')} data-testid="hf-tag">{fresh ? 'New' : 'Review'}</span>} {instruction}</p>}
    {!done && zh && !hasHan(prompt) && prompt && <p className="hf-cue">{prompt}</p>}
    <p className={'hf-prompt' + (heard.section && !done ? ' hf-section' : '')} lang={!done && hasHan(main) ? 'zh-Hans' : undefined}>{main}</p>
    {!done && heard.section && heard.detail && <p className="hf-cue" data-testid="hf-section-detail">{heard.detail}</p>}
    {!done && zh && <p className="hf-pinyin" data-testid="hf-pinyin">{toPinyin(zh, { toneType: 'symbol' })}</p>}
    {!done && heard.en && <p className="hf-answer" data-testid="hf-answer">{heard.en}</p>}
    {done && added && <p className="hf-added" role="status">{added}</p>}
    <progress aria-label="Run progress" value={done ? total : Math.min(position, total)} max={Math.max(1, total)} />
  </div>
}


/** What the player works from: a set's items with its Hands-free activity's seed, settings and saved position. */
interface Run { id: string; title: string; refs: string[]; seed: number; settings: HandsfreeSettings; started: boolean; position: number; layout?: 2 | 3; kind: HandsfreeKind; addedRefs?: string[]; back: string; shortcut: boolean }
const runOf = (set: DrillSet, kind: HandsfreeKind): Run | undefined => { const activity = activityOf(set, kind); return activity ? { kind, id: set.id, title: set.title, refs: set.refs, seed: activity.seed, settings: activity.settings, started: activity.started, position: activity.position, ...(activity.layout ? { layout: activity.layout } : {}),
  ...(set.addedRefs ? { addedRefs: set.addedRefs } : {}), back: `#practice/set/${set.id}`, shortcut: !!set.shortcut } : undefined }

/** The Hands-free activity of a set. The activity is created the first time it is opened. */
export function HandsFree({ set, kind = 'introduction', ...props }: PageProps & { set: DrillSet; kind?: HandsfreeKind }) {
  const missing = !activityOf(set, kind)
  useEffect(() => { if (missing) void ensureHandsfree(set.id, loadHandsfreeSettings(), kind) }, [missing, set.id, kind])
  const run = runOf(set, kind)
  // A run saved before the mixed flow has a different script, so its place in it means nothing: it opens at the top (a finished or unstarted run is unchanged otherwise).
  const stale = !!run && run.layout !== 3
  useEffect(() => {
    if (!run || !stale) return
    let live = true
    void (async () => { if (live) await updateHandsfree(run.id, { layout: 3, position: 0 }, Date.now(), run.kind) })()
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, stale])
  if (!run || stale) return <div className="opening-workspace" role="status">Opening Hands-free...</div>
  return <Player key={run.id + run.kind} hf={run} {...props} />
}

const settingsKey = (settings: HandsfreeSettings) => (() => { const s = normalizeHandsfreeSettings(settings); return `${s.repeats}:${s.itemWording}:${s.sectionIntros}:${s.emphasis}:${s.emphasisRate}:${s.zhRate}` })()

function Player({ hf: run, workspace, now, run: perform, busy }: PageProps & { hf: Run }) {
  const { catalog } = useCatalog()
  // New or Review is judged against the knowledge set as it was when the run opened.
  const startKnown = useRef<ReadonlySet<string>>(new Set(workspace.knowledge.map(entry => entry.ref)))
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [heard, setHeard] = useState<Heard>({})
  const scriptRef = useRef<Script>({ segments: [], promptStarts: [] })
  const runId = run.id
  const structure = settingsKey(run.settings)
  const pauseLength = run.settings.pause
  // The script follows the run's own seed and settings, so leaving and coming back plays the same run. Changing the pause length keeps its shape.
  useEffect(() => {
    let live = true
    const before = scriptRef.current
    const at = playerRef.current?.state().prompt ?? 0
    const key = promptKeyAt(before, at)
    void buildRunScript(run, run.kind, startKnown.current).then(({ script: built }) => {
      if (!live) return
      scriptRef.current = built
      setScript(built)
      // A changed setting rebuilds the script; this prompt keeps its place in it (phase, item, direction), and the next one comes from the new script.
      if (before.promptStarts.length) playerRef.current?.rebase(findPrompt(built, key, at))
    }, cause => { if (live) setError(cause instanceof Error ? cause.message : 'The run could not be prepared.') })
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
      if (next.status === 'completed') void finishHandsfree(runId, total, Date.now(), run.kind).catch(cause => setError(cause instanceof Error ? cause.message : 'The new items could not be added to your knowledge set.'))
      else if (next.status === 'playing' || next.status === 'paused') {
        lastSaved.current = next.prompt
        // Each prompt counts its item once per run (listening or speaking by the prompt's kind).
        if (next.status === 'playing') {
          const at = scriptRef.current.segments[scriptRef.current.promptStarts[next.prompt]]
          if (at?.kind === 'marker' && at.ref && at.act) void recordRunPractice(runId, [at.ref], PROMPT_SKILLS[at.act], Date.now(), run.kind).catch(() => undefined)
        }
        void updateHandsfree(runId, { ...(next.status === 'playing' ? { started: true } : {}), position: next.prompt }, Date.now(), run.kind)
      }
    }, startRef.current, () => resolveVoices(voicesRef.current.settings, voicesRef.current.saved),
    // The answer shows only when its segment starts: Chinese with pinyin, or the English answer to a Chinese prompt.
    segment => setHeard(before => !segment ? (before.zh || before.en || before.section ? {} : before) : segment.section ? { section: segment.header ?? segment.text, ...(segment.detail ? { detail: segment.detail } : {}) } : segment.locale === 'zh-Hans' ? { zh: segment.text } : segment.answer ? { ...before, en: segment.text } : before.section ? {} : before))
    playerRef.current = player
    return () => {
      player.dispose()
      // Leaving mid-run needs no write: the position is saved on every prompt, so the set stays unfinished at its saved prompt.
    }
  }, [runId])

  const total = script?.promptStarts.length ?? 0
  const marker = useMemo(() => {
    if (!script || state.status === 'idle' && !run.started && state.prompt === 0 && !script.promptStarts.length) return undefined
    const segment = script.segments[script.promptStarts[Math.min(state.prompt, total - 1)]]
    return segment?.kind === 'marker' ? segment : undefined
  }, [script, state.prompt, state.status, total, run.started])
  const eyebrow = run.kind === 'recall' ? 'Hands-free recall' : 'Hands-free lesson'
  const done = state.status === 'completed'
  const playing = state.status === 'playing'
  const change = (next: HandsfreeSettings) => { saveHandsfreeSettings(next); void updateHandsfree(run.id, { settings: next }, Date.now(), run.kind) }
  const instruction = instructionOf(marker)
  const fresh = marker && marker.index > 0 && marker.ref && marker.act ? !startKnown.current.has(marker.ref) : undefined
  const [eyeItem, setEyeItem] = useState<ItemInfo>()
  /** The eye: pauses, and shows the current item's intro card (a phrase shows its word's card). */
  const viewCurrent = () => {
    playerRef.current?.pause()
    const found = marker?.ref ? items?.find(item => item.ref === marker.ref) : undefined
    if (found) setEyeItem(found)
  }

  const phaseLine = done ? 'Finished' : marker ? progressLabel(marker) : script ? 'Ready' : 'Preparing...'
  // Start listening plays at once when the script is ready, or as soon as it is.
  const startListening = () => { setView('player'); setListening(true) }
  useEffect(() => {
    if (!listening || !script || !total) return
    setListening(false)
    playerRef.current?.play()
  }, [listening, script, total])

  useMediaSession(run.title, marker ? progressLabel(marker) : '', playerRef, !!script)

  const introRefs = run.refs.join(',')
  useEffect(() => {
    if (view === 'intro' && items) void recordRunPractice(runId, run.refs, ACTIVITY_SKILLS.introCard).catch(() => undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, !!items, introRefs])

  if (view === 'intro') return <div className="dr hf">
    <a className="back-link" href={run.back}><ArrowLeft size={16} /> {run.title}</a>
    <PageHeading eyebrow={eyebrow} title={run.title}>Here is everything you will hear. Read the cards first, or skip them and listen.</PageHeading>
    {error && <p className="notice error" role="alert">{error}</p>}
    {catalog && items ? <IntroCards items={items} catalog={catalog} workspace={workspace} now={now} run={perform} busy={busy} route={`practice/set/${run.id}/${handsfreeRoute(run.kind)}`} /> : <p className="small muted" role="status">Opening the intro cards...</p>}
    <div className="hf-startbar"><button type="button" className="button primary" onClick={startListening}><Headphones size={18} /> {run.started ? 'Continue listening' : 'Start listening'}</button></div>
  </div>

  return <div className="dr hf">
    <a className="back-link" href={run.back}><ArrowLeft size={16} /> {run.title}</a>
    <PageHeading eyebrow={eyebrow} title={run.title} action={<button type="button" className="button secondary" onClick={() => { playerRef.current?.pause(); setView('intro') }}><Eye size={16} /> View items</button>}>Listen, answer aloud, hear the answer, repeat it. Nothing is graded.</PageHeading>
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="panel hf-stage" aria-label="Now playing" aria-live="polite">
      <Display phase={phaseLine} instruction={instruction} fresh={fresh} prompt={marker?.prompt ?? ''} heard={heard} done={done} total={total} position={state.prompt} added={addedLine(run.addedRefs)} />
      <div className="hf-controls">
        <button type="button" className="button secondary icon-only" aria-label="Back" disabled={!script || state.prompt <= 0 && !done} onClick={() => playerRef.current?.back()}><SkipBack size={22} /></button>
        <button type="button" className="button primary hf-play" aria-label={playing ? 'Pause' : done ? 'Play again' : state.prompt > 0 ? 'Resume' : 'Play'} disabled={!script || !total} onClick={() => playing ? playerRef.current?.pause() : playerRef.current?.play()}>{playing ? <Pause size={26} /> : <Play size={26} />}</button>
        <button type="button" className="button secondary icon-only" aria-label="Skip" disabled={!script || done} onClick={() => playerRef.current?.skip()}><SkipForward size={22} /></button>
      </div>
      <div className="hf-tools"><button type="button" className="button secondary" aria-label="View this item" title="View this item" disabled={!marker?.ref || !items} onClick={viewCurrent}><Eye size={16} /> This item</button>
        <button type="button" className="button secondary" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><SettingsIcon size={16} /> Settings</button>
        <button type="button" className="button secondary" onClick={() => setPocket(true)}><Moon size={16} /> Pocket mode</button></div>
    </section>
    {eyeItem && catalog && <Sheet title="This item" label="Current item" onClose={() => setEyeItem(undefined)}><IntroCards items={[eyeItem]} catalog={catalog} workspace={workspace} now={now} run={perform} busy={busy} route={`practice/set/${run.id}/${handsfreeRoute(run.kind)}`} /></Sheet>}
    {settingsOpen && <Sheet title="Settings" label="Hands-free settings" onClose={() => setSettingsOpen(false)} footer={<p className="small muted">Changes apply from the next prompt.</p>}><HandsfreeSettingsForm settings={run.settings} onChange={change} /></Sheet>}
    {pocket && <PocketOverlay onExit={() => setPocket(false)}><Display phase={phaseLine} instruction={instruction} fresh={fresh} prompt={marker?.prompt ?? ''} heard={heard} done={done} total={total} position={state.prompt} added={addedLine(run.addedRefs)} className="hf-pocket-display" /></PocketOverlay>}
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
