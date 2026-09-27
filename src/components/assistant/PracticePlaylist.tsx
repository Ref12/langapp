import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { speechRateSchema, type SpeechBlock, type SpeechRate } from '../../core/assistant/contracts'
import { MAX_PRACTICE_CHUNKS, type PracticePlan, type PracticeDirection, type PracticePlaylistItem } from '../../core/assistant/practice-chain-contracts'
import { createPracticePlayback, type PracticePlaybackOptions, type PracticePlaybackState } from '../../core/assistant/practice-playback'
import { PracticeBoundaryEditor } from './PracticeBoundaryEditor'
import { PracticePhraseSelection } from './PracticePhraseSelection'
import './practice-playlist.css'

type ChainEngine = typeof import('../../core/assistant/practice-chain')
interface LoadedPlan { engine: ChainEngine; plan: PracticePlan }
interface Props {
  phrase: SpeechBlock
  rate: SpeechRate
  savedEnds?: number[]
  savedItems?: PracticePlaylistItem[]
  busy: boolean
  recordingActive: boolean
  recording?: (rate: SpeechRate) => ReactNode
  onSave: (ends: number[], items?: PracticePlaylistItem[]) => Promise<void>
  onClose: () => Promise<void>
  saveNotice?: string
}

export function PracticePlaylist({ phrase, rate, savedEnds, savedItems, busy, recordingActive, recording, onSave, onClose, saveNotice }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const activeRow = useRef<HTMLButtonElement>(null)
  const player = useRef<ReturnType<typeof createPracticePlayback>>()
  const closeAction = useRef(onClose)
  closeAction.current = onClose
  const alive = useRef(false)
  const closing = useRef(false)
  const saved = useRef({ ends: savedEnds, items: savedItems })
  const initialOptions = useRef<PracticePlaybackOptions>({ pacing: 'self-paced', rate, pauseSeconds: 3, repetitions: 1 })
  const [options, setOptions] = useState(initialOptions.current)
  const [direction, setDirection] = useState<PracticeDirection>('backward')
  const [loaded, setLoaded] = useState<LoadedPlan>()
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<PracticePlaybackState>({ status: 'idle', index: 0, repetition: 1 })
  const [draft, setDraft] = useState<PracticePlan>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const requestClose = async () => {
    if (closing.current || saving) return
    closing.current = true
    player.current?.pause()
    if (player.current?.getState().status === 'error') {
      setError(player.current.getState().error ?? 'Playback could not be stopped.')
      closing.current = false
      return
    }
    try { await closeAction.current() }
    catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Practice could not be closed. Try again.')
      closing.current = false
    }
  }
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose

  useEffect(() => {
    alive.current = true
    const element = dialog.current!
    const previousFocus = opener.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    const leave = () => {
      player.current?.pause()
      void closeRef.current()
    }
    const hidden = () => { if (document.hidden) leave() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', leave)
    window.addEventListener('hashchange', leave)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('hashchange', leave)
      player.current?.dispose()
      player.current = undefined
      element.close()
      document.body.style.overflow = overflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !document.querySelector('dialog[open]')) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoadError('')
    setLoaded(undefined)
    void import('../../core/assistant/practice-chain').then(engine => {
      if (!active) return
      let plan = engine.createPracticePlan(phrase.text, phrase.romanization)
      if (saved.current.ends) plan = engine.applyPracticeEnds(plan, saved.current.ends)
      if (saved.current.items) plan = { ...plan, items: saved.current.items }
      const tracks = engine.buildPracticeTracks(plan, 'backward')
      player.current = createPracticePlayback(id, tracks.map(track => track.text), initialOptions.current, next => {
        if (alive.current && active) setState(next)
      })
      setLoaded({ engine, plan })
    }).catch(cause => {
      if (active) setLoadError(cause instanceof Error ? cause.message : 'Practice could not load. Check your connection and try again.')
    })
    return () => {
      active = false
      player.current?.dispose()
      player.current = undefined
    }
  }, [id, phrase.text, phrase.romanization, retry])

  useEffect(() => {
    if (busy) { player.current?.pause(); void closeRef.current() }
  }, [busy])
  useEffect(() => { activeRow.current?.scrollIntoView?.({ block: 'nearest' }) }, [state.index, loaded, direction])

  const tracks = loaded?.engine.buildPracticeTracks(loaded.plan, direction) ?? []
  const disabled = !loaded || busy || saving || recordingActive || !!draft
  const playing = state.status === 'playing' || state.status === 'responding'
  const configure = (nextOptions: PracticePlaybackOptions, nextDirection = direction) => {
    if (!loaded) return
    const nextTracks = loaded.engine.buildPracticeTracks(loaded.plan, nextDirection)
    player.current?.configure(nextTracks.map(track => track.text), nextOptions, nextDirection === direction ? state.index : 0)
    if (player.current?.getState().status === 'error') return
    setOptions(nextOptions)
    setDirection(nextDirection)
  }
  const edit = (operation: () => PracticePlan) => {
    setError('')
    try { setDraft(operation()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Those chunk boundaries could not be used.') }
  }
  const persist = async (next: PracticePlan, index: number, label: string): Promise<boolean> => {
    if (!loaded) return false
    setSaving(true)
    setError('')
    try {
      player.current?.pause()
      if (player.current?.getState().status === 'error') return false
      const nextTracks = loaded.engine.buildPracticeTracks(next, direction)
      if (next.items) await onSave(next.ends, next.items)
      else await onSave(next.ends)
      if (!alive.current) return false
      player.current?.configure(nextTracks.map(track => track.text), options, index)
      saved.current = { ends: next.ends, items: next.items }
      setLoaded({ ...loaded, plan: next })
      return true
    } catch (cause) {
      if (alive.current) setError(`${label} not saved. ${cause instanceof Error ? cause.message : 'Check browser storage and retry.'}`)
      return false
    } finally { if (alive.current) setSaving(false) }
  }
  const save = async () => {
    if (!loaded || !draft) return
    const nextTracks = loaded.engine.buildPracticeTracks(draft, direction)
    const changed = nextTracks.findIndex((track, index) => track.text !== tracks[index]?.text)
    const index = Math.min(state.index, changed < 0 ? nextTracks.length - 1 : changed)
    if (await persist(draft, index, 'Chunks')) setDraft(undefined)
  }
  const addSelection = async (start: number, end: number): Promise<boolean> => {
    if (!loaded) return false
    if (tracks.length >= MAX_PRACTICE_CHUNKS) {
      setError('The playlist already has 80 steps. Remove a selected part or join some chunks first.')
      return false
    }
    if (tracks.some(track => track.item.kind === 'selection' && track.item.start === start && track.item.end === end)) {
      setError('That selected part is already in the playlist.')
      return false
    }
    try {
      const index = player.current?.getState().index ?? state.index
      return await persist(loaded.engine.addPracticeSelection(loaded.plan, start, end, index), index, 'Playlist')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Select a complete word or part of the phrase.')
      return false
    }
  }
  const move = (from: number, to: number) => {
    if (!loaded) return
    const current = player.current?.getState().index ?? state.index
    const index = current === from ? to : current === to ? from : current
    void persist(loaded.engine.movePracticeItem(loaded.plan, from, to), index, 'Playlist')
  }
  const remove = (index: number) => {
    if (!loaded) return
    const current = player.current?.getState().index ?? state.index
    void persist(loaded.engine.removePracticeSelection(loaded.plan, index),
      Math.min(current > index ? current - 1 : current, tracks.length - 2), 'Playlist')
  }
  const status = state.status === 'error' ? state.error : state.status === 'playing' ? 'Listen to the model...'
    : state.status === 'responding' ? `Your turn. Repeat aloud. Repetition ${state.repetition} of ${options.repetitions}.`
      : state.status === 'completed' ? 'Playlist finished. You can repeat any part.'
        : state.status === 'paused' ? 'Paused. Play repeats this step from the beginning.'
          : 'Ready. Play a step, then repeat aloud.'

  return createPortal(<dialog ref={dialog} className="practice-playlist" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-privacy`} onCancel={event => { event.preventDefault(); void requestClose() }}
    onClose={event => {
      // Strict Mode can reopen the dialog before a queued cleanup close event arrives.
      if (alive.current && !event.currentTarget.open) void requestClose()
    }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void requestClose() }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) void requestClose()
    }} data-assistant-exclude>
    <header className="practice-playlist-header">
      <div><p className="eyebrow">LISTEN AND BUILD</p><h2 id={`${id}-title`}>Phrase practice</h2></div>
      <button type="button" className="icon-button" aria-label="Close practice" disabled={saving} autoFocus onClick={() => void requestClose()}><X size={22} /></button>
    </header>
    <div className="practice-playlist-controls">
      <label>Build direction<select value={direction} disabled={disabled} onChange={event => configure(options, event.target.value === 'forward' ? 'forward' : 'backward')}>
        <option value="forward">From start</option><option value="backward">From end</option>
      </select></label>
      <label>Pacing<select value={options.pacing} disabled={disabled} onChange={event => configure({ ...options, pacing: event.target.value === 'guided' ? 'guided' : 'self-paced' })}>
        <option value="self-paced">Self-paced</option><option value="guided">Guided</option>
      </select></label>
      <label>Practice speed<select value={options.rate} disabled={disabled} onChange={event => configure({ ...options, rate: speechRateSchema.parse(Number(event.target.value)) })}>
        {speechRateSchema.options.map(({ value }) => <option key={value} value={value}>{value}x</option>)}
      </select></label>
      {options.pacing === 'guided' && <>
        <label>Repetition pause<select value={options.pauseSeconds} disabled={disabled} onChange={event => configure({ ...options, pauseSeconds: Number(event.target.value) })}>
          {[1, 2, 3, 5, 8, 10, 15, 20, 30].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
        </select></label>
        <label>Repetitions per step<select value={options.repetitions} disabled={disabled} onChange={event => configure({ ...options, repetitions: Number(event.target.value) })}>
          {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}
        </select></label>
      </>}
    </div>
    <div className="practice-playlist-content">
      <div className="practice-target">
        <p className="small muted">Full phrase</p>
        {loaded && !draft ? <PracticePhraseSelection text={phrase.text} units={loaded.plan.units} disabled={disabled}
          preview={(start, end) => loaded.engine.getPracticePart(loaded.plan, start, end)} add={addSelection} />
          : <p lang="zh-Hans">{phrase.text}</p>}
        {phrase.meaning && <p className="small muted">{phrase.meaning}</p>}
      </div>
      <p id={`${id}-privacy`} className="small muted">Chunks and pinyin are suggested on this device. Your selected speech voice may be online. Opening Practice does not play or record audio.</p>
      {saveNotice && <p className="small muted">{saveNotice}</p>}
      {loadError ? <div role="alert" className="notice error"><p>{loadError}</p><button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>Retry loading practice</button></div>
        : !loaded ? <p role="status">Preparing chunks and pinyin...</p> : <>
          {loaded.plan.warnings.length > 0 && <details className="small">
            <summary>Review local chunk and pinyin suggestions</summary>
            {loaded.plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </details>}
          <div className="practice-list-heading">
            <p className="small muted">Colored characters and underlined pinyin mark the newly added part.</p>
            <button type="button" className="button secondary" disabled={disabled} onClick={() => {
              player.current?.pause()
              if (player.current?.getState().status === 'error') {
                setError(player.current.getState().error ?? 'Playback could not be stopped.')
                return
              }
              setError('')
              setDraft(loaded.plan)
            }}>Edit chunks</button>
          </div>
          {draft ? <section className="practice-chunk-editor" aria-label="Edit phrase chunks">
            <PracticeBoundaryEditor plan={draft} disabled={saving}
              trackCount={loaded.engine.getPracticePlaylistItems(draft).length}
              change={ends => edit(() => loaded.engine.applyPracticeEnds(draft, ends))} />
            <div className="practice-chunk-preview" aria-label="Chunk preview">
              {loaded.engine.getPracticeChunks(draft).map(chunk => <span key={`${chunk.start}:${chunk.end}`}>
                <span lang="zh-Hans">{chunk.text}</span><span lang="zh-Latn">{chunk.pinyin}</span>
              </span>)}
            </div>
            <div className="button-row">
              <button type="button" className="button primary" disabled={saving || draft.ends.join(',') === loaded.plan.ends.join(',')} onClick={() => void save()}>{saving ? 'Saving chunks...' : 'Save chunks'}</button>
              <button type="button" className="button secondary" disabled={saving} onClick={() => { setDraft(undefined); setError('') }}>Cancel edits</button>
            </div>
          </section> : <ol className="practice-tracks" aria-label="Phrase playlist">
            {tracks.map((track, index) => <li className="practice-track-row"
              key={track.item.kind === 'chain' ? `chain:${track.item.step}` : `selection:${track.item.start}:${track.item.end}`}>
              <button type="button" className="practice-track" ref={state.index === index ? activeRow : undefined}
                aria-current={state.index === index ? 'step' : undefined}
                aria-label={`Play step ${index + 1}: ${track.text}. ${track.pinyin}`}
                disabled={disabled} onClick={() => player.current?.select(index)}>
                <span className="practice-track-number">{index + 1}</span>
                <span className="practice-track-text">
                  {track.item.kind === 'selection' && <span className="practice-track-kind">Selected part</span>}
                  <span className="practice-track-hanzi" lang="zh-Hans">{track.parts.map((part, partIndex) => <span key={partIndex} className={part.added ? 'practice-addition' : undefined}>{part.text}</span>)}</span>
                  <span className="practice-track-pinyin" lang="zh-Latn">{track.parts.map((part, partIndex) => <span key={partIndex}>{partIndex > 0 ? ' ' : ''}<span className={part.added ? 'practice-addition' : undefined}>{part.pinyin}</span></span>)}</span>
                </span>
                {state.index === index && <span className="small muted">{playing ? 'Active' : 'Selected'}</span>}
              </button>
              <div className="practice-track-actions">
                <button type="button" className="icon-button" aria-label={`Move step ${index + 1} up`}
                  title="Move up" disabled={disabled || index === 0} onClick={() => move(index, index - 1)}><ChevronUp size={18} /></button>
                <button type="button" className="icon-button" aria-label={`Move step ${index + 1} down`}
                  title="Move down" disabled={disabled || index === tracks.length - 1} onClick={() => move(index, index + 1)}><ChevronDown size={18} /></button>
                {track.item.kind === 'selection' && <button type="button" className="icon-button" aria-label={`Remove step ${index + 1}`}
                  title="Remove selected part" disabled={disabled} onClick={() => remove(index)}><X size={16} /></button>}
              </div>
            </li>)}
          </ol>}
        </>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {recording && !draft && loaded && <section className="practice-playlist-recording" aria-label="Optional whole phrase recording">
        <p className="small muted">Optional: record the complete phrase for feedback. Recording is separate from the playlist.</p>
        {recording(options.rate)}
      </section>}
    </div>
    <footer className="practice-transport">
      <p className="small" role={state.status === 'error' ? 'alert' : 'status'}>{status}</p>
      <div className="practice-transport-buttons">
        <button type="button" className="button secondary" aria-label="Previous step" disabled={disabled || state.index === 0} onClick={() => player.current?.previous()}><SkipBack size={18} />Previous</button>
        <button type="button" className="button primary" aria-label={playing ? 'Pause practice' : 'Play practice'} disabled={disabled} onClick={() => playing ? player.current?.pause() : player.current?.play()}>
          {playing ? <Pause size={20} /> : <Play size={20} />}{playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="button secondary" aria-label="Next step" disabled={disabled || state.index >= tracks.length - 1} onClick={() => player.current?.next()}>Next<SkipForward size={18} /></button>
      </div>
      <p className="small muted">{tracks.length ? `Step ${state.index + 1} of ${tracks.length} / ` : ''}{options.pacing === 'self-paced' ? 'Self-paced' : 'Guided'}{!recording && ' / Microphone off'}. Practice is not proof of mastery.</p>
    </footer>
  </dialog>, document.body)
}
