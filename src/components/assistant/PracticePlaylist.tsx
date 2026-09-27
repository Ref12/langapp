import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ListMusic, Mic, Minus, Pause, Play, Plus, Quote, Repeat2, SkipBack, SkipForward, SlidersHorizontal, TrendingUp, WholeWord, X } from 'lucide-react'
import { type SpeechBlock, type SpeechRate } from '../../core/assistant/contracts'
import { MAX_PRACTICE_CHUNKS, type PracticePlan, type PracticeMode, type PracticePlaylistItem } from '../../core/assistant/practice-chain-contracts'
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
  recording?: (rate: number) => ReactNode
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
  const initialMode = useRef<PracticeMode>(savedEnds || savedItems ? 'backward' : 'words')
  const initialOptions = useRef<PracticePlaybackOptions>({
    pacing: initialMode.current === 'words' ? 'guided' : 'self-paced', rate,
    pauseSeconds: initialMode.current === 'words' ? 1.5 : 3, repetitions: 1,
    loop: true, autoRamp: false, maxRate: 1, minPauseSeconds: 0.75,
  })
  const [options, setOptions] = useState(initialOptions.current)
  const [direction, setDirection] = useState<PracticeMode>(initialMode.current)
  const mode = useRef(direction)
  const pauses = useRef<Record<PracticeMode, number>>({ words: 1.5, phrase: 4, forward: 3, backward: 3 })
  const [round, setRound] = useState(1)
  const [responseSeconds, setResponseSeconds] = useState(0)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [recordingOpen, setRecordingOpen] = useState(false)
  const [showPinyin, setShowPinyin] = useState(true)
  const [showMeaning, setShowMeaning] = useState(true)
  const editToggle = useRef<HTMLButtonElement>(null)
  const optionToggle = useRef<HTMLButtonElement>(null)
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
      let plan = engine.createPracticePlan(phrase.text, phrase.romanization, !saved.current.ends)
      if (saved.current.ends) plan = engine.applyPracticeEnds(plan, saved.current.ends)
      if (saved.current.items) plan = { ...plan, items: saved.current.items }
      const tracks = engine.buildPracticeModeTracks(plan, initialMode.current)
      player.current = createPracticePlayback(id, tracks.map(track => track.text), initialOptions.current, next => {
        if (alive.current && active) {
          setState(next)
          const settings = player.current?.getOptions()
          if (settings) {
            setOptions(settings)
            pauses.current[mode.current] = settings.pauseSeconds
          }
          setRound(player.current?.getRound() ?? 1)
          setResponseSeconds(player.current?.getResponseSeconds() ?? 0)
        }
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
  useEffect(() => { if (editing) activeRow.current?.scrollIntoView?.({ block: 'nearest' }) }, [state.index, loaded, direction, editing])

  const tracks = useMemo(() => loaded?.engine.buildPracticeModeTracks(loaded.plan, direction) ?? [], [loaded, direction])
  const chunks = useMemo(() => loaded?.engine.getPracticeChunks(loaded.plan) ?? [], [loaded])
  const chainMode = direction === 'forward' || direction === 'backward'
  const disabled = !loaded || busy || saving || recordingActive || !!draft
  const playing = state.status === 'playing' || state.status === 'responding'
  const configure = (nextOptions: PracticePlaybackOptions, nextDirection = direction) => {
    if (!loaded) return
    const nextTracks = loaded.engine.buildPracticeModeTracks(loaded.plan, nextDirection)
    if (nextDirection === direction) player.current?.updateSettings(nextOptions)
    else player.current?.configure(nextTracks.map(track => track.text), nextOptions, 0)
    if (player.current?.getState().status === 'error') return
    mode.current = nextDirection
    pauses.current[nextDirection] = nextOptions.pauseSeconds
    setOptions(nextOptions)
    setDirection(nextDirection)
  }
  const changeMode = (next: PracticeMode) => {
    const previousPause = options.pauseSeconds
    configure({ ...options, pauseSeconds: pauses.current[next] }, next)
    pauses.current[direction] = previousPause
  }
  const showEditor = () => {
    player.current?.pause()
    if (player.current?.getState().status === 'error') return
    if (!chainMode) changeMode('backward')
    setEditing(true)
    setOptionsOpen(false)
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
      const nextTracks = loaded.engine.buildPracticeModeTracks(next, direction)
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
    const nextTracks = loaded.engine.buildPracticeModeTracks(draft, direction)
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
  const status = state.status === 'error' ? 'Playback needs attention' : state.status === 'playing' ? 'Listen'
    : state.status === 'responding' ? 'Your turn'
      : state.status === 'completed' ? 'Round complete' : state.status === 'paused' ? 'Paused' : 'Ready when you are'
  const currentTrack = tracks[state.index]
  const rates = Array.from({ length: 21 }, (_, index) => Number((0.25 + index * 0.05).toFixed(2)))
  const pauseValues = [...new Set([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 8, 10, 15, 20, 30, options.pauseSeconds])].sort((a, b) => a - b)

  return createPortal(<dialog ref={dialog} className="practice-playlist" aria-labelledby={`${id}-title`}
    data-mode={direction} data-phase={state.status}
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
      <h2 id={`${id}-title`}>Phrase practice</h2>
      <div className="practice-header-actions">
        <button ref={editToggle} type="button" className="icon-button" aria-label="Edit playlist" title="Edit playlist" disabled={disabled}
          aria-expanded={editing} aria-controls={`${id}-editor`} onClick={() => editing ? setEditing(false) : showEditor()}><ListMusic size={18} /></button>
        {recording && <button type="button" className="icon-button" aria-label="Recording and feedback" title="Recording and feedback"
          aria-expanded={recordingOpen || recordingActive} onClick={() => setRecordingOpen(!recordingOpen)}><Mic size={18} /></button>}
        <button ref={optionToggle} type="button" className="icon-button" aria-label="Practice options" title="Practice options"
          aria-expanded={optionsOpen} aria-controls={`${id}-options`} onClick={() => { setOptionsOpen(!optionsOpen); setEditing(false) }} disabled={!!draft}><SlidersHorizontal size={18} /></button>
        <button type="button" className="icon-button" aria-label="Close practice" disabled={saving} autoFocus onClick={() => void requestClose()}><X size={22} /></button>
      </div>
    </header>
    <div className="practice-mode-switch" role="group" aria-label="Practice mode">
      {([
        ['words', 'Word by word', WholeWord], ['phrase', 'Whole phrase', Quote],
        ['forward', 'Build from start', ArrowRight], ['backward', 'Build from end', ArrowLeft],
      ] as const).map(([value, label, Icon]) => <button type="button" key={value} disabled={disabled}
        aria-pressed={direction === value} onClick={() => { changeMode(value); if (value === 'words' || value === 'phrase') setEditing(false) }}><Icon size={15} />{label}</button>)}
    </div>
    <div className="practice-playlist-content">
      <section id={`${id}-options`} className="practice-options" aria-label="Practice options" hidden={!optionsOpen}>
        <div className="practice-panel-heading"><h3>Make it yours</h3><button type="button" className="text-link" onClick={() => { setOptionsOpen(false); optionToggle.current?.focus() }}>Done</button></div>
        <div className="practice-playlist-controls">
          <label>Pacing<select value={options.pacing} disabled={disabled} onChange={event => configure({ ...options, pacing: event.target.value === 'guided' ? 'guided' : 'self-paced' })}>
            <option value="self-paced">Self-paced</option><option value="guided">Guided</option>
          </select></label>
          <label>Repetitions per step<select value={options.repetitions} disabled={disabled} onChange={event => configure({ ...options, repetitions: Number(event.target.value) })}>
            {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}
          </select></label>
          <label>Fastest speech<select value={options.maxRate} disabled={disabled} onChange={event => configure({ ...options, maxRate: Number(event.target.value) })}>
            {[0.75, 1, 1.25].map(value => <option key={value} value={value}>{value}x</option>)}
          </select></label>
          <label>Shortest pause<select title="Auto-ramp's lower pause limit. No effect when Auto-ramp is off." value={options.minPauseSeconds} disabled={disabled} onChange={event => configure({ ...options, minPauseSeconds: Number(event.target.value) })}>
            {[0, 0.25, 0.5, 0.75, 1, 1.5].map(value => <option key={value} value={value}>{value}s</option>)}
          </select></label>
        </div>
        <div className="practice-display-options">
          <label><input type="checkbox" checked={showPinyin} onChange={event => setShowPinyin(event.target.checked)} />Pinyin</label>
          <label><input type="checkbox" checked={showMeaning} onChange={event => setShowMeaning(event.target.checked)} />Meaning</label>
        </div>
        <p className="small muted">Fastest speech and Shortest pause only limit Auto-ramp: +0.05x speech speed and -0.25s pause per complete round. Zero pause adds no wait after speech. Pace changes apply to the next step or pause; Self-paced waits for your tap.</p>
        <details><summary>About phrase practice</summary>
          <p className="small muted">Chunks and pinyin are suggested on this device. Your selected speech voice may be online. Opening Practice does not play or record audio. Practice is not proof of mastery.</p>
          {saveNotice && <p className="small muted">{saveNotice}</p>}
          {loaded?.plan.warnings.map((warning, index) => <p key={index} className="small muted">{warning}</p>)}
        </details>
      </section>
      <p id={`${id}-privacy`} className="visually-hidden">Opening is silent. Your selected speech voice may be online. Recording is optional and separate. {saveNotice}</p>
      <div id={`${id}-editor`} hidden={!editing} className="practice-editor">
        <div className="practice-panel-heading"><h3>Build playlist</h3><button type="button" className="text-link" disabled={!!draft || saving}
          onClick={() => { setEditing(false); editToggle.current?.focus() }}>Done editing</button></div>
        <p className="small muted">Custom steps and their order apply to the build modes. Word by word follows your chunk boundaries in sentence order; Whole phrase plays the complete text.</p>
        <div className="practice-target">
        <p className="small muted">Full phrase</p>
        {loaded && !draft ? <PracticePhraseSelection text={phrase.text} units={loaded.plan.units} disabled={disabled}
          preview={(start, end) => loaded.engine.getPracticePart(loaded.plan, start, end)} add={addSelection} />
          : <p lang="zh-Hans">{phrase.text}</p>}
        {phrase.meaning && <p className="small muted">{phrase.meaning}</p>}
      </div>
      {loaded && <>
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
      </div>
      {loadError ? <div role="alert" className="notice error"><p>{loadError}</p><button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>Retry loading practice</button></div>
        : !loaded ? <p>Preparing chunks and pinyin...</p> : !editing && !optionsOpen && currentTrack && <section className="practice-rehearsal" aria-label="Current practice step">
          <div className="practice-phrase-strip" role="group" aria-label="Words in the phrase" hidden={direction === 'phrase'}>
            {chunks.map((chunk, index) => <button type="button" key={chunk.start} disabled={disabled} lang="zh-Hans"
              aria-pressed={currentTrack.parts.some(part => part.start <= chunk.start && part.end >= chunk.end)}
              onClick={() => {
                const step = direction === 'words' ? index : tracks.findIndex(track => track.item.kind === 'chain' && track.item.step === (direction === 'backward' ? chunks.length - 1 - index : index))
                if (step >= 0) player.current?.seek(step)
              }}><span>{chunk.text}</span>{showPinyin && <span className="practice-word-pinyin" lang="zh-Latn">{chunk.pinyin}</span>}</button>)}
          </div>
          <div className="practice-phase"><span>{status}</span><span>Round {round}</span></div>
          <div className="practice-current">
            <p className="practice-track-hanzi" lang="zh-Hans">{currentTrack.parts.map((part, index) => <span key={index} className={part.added ? 'practice-addition' : undefined}>{part.text}</span>)}</p>
            {showPinyin && <p className="practice-track-pinyin" lang="zh-Latn">{currentTrack.pinyin}</p>}
            {showMeaning && currentTrack.text === phrase.text && phrase.meaning && <p className="small muted">{phrase.meaning}</p>}
          </div>
          <div className="practice-response-track" aria-hidden="true">
            {state.status === 'responding' && <span key={`${round}:${state.index}:${state.repetition}`} style={{ animationDuration: `${responseSeconds}s` }} />}
          </div>
          <div className="practice-phase"><span>{direction === 'phrase' ? 'Whole phrase' : `${direction === 'words' ? 'Word' : 'Step'} ${state.index + 1} of ${tracks.length}`}</span>
            <span>{state.status === 'responding' ? `${responseSeconds}s to repeat` : options.pacing === 'self-paced' ? 'Self-paced' : ''}</span></div>
          <div className="practice-step-markers" role="group" aria-label="Practice steps">
            {tracks.map((track, index) => <button type="button" key={index} disabled={disabled} aria-current={state.index === index ? 'step' : undefined}
              aria-label={`Select step ${index + 1}: ${track.text}`} onClick={() => player.current?.seek(index)}><span /></button>)}
          </div>
        </section>}
      {recording && !draft && loaded && <section className="practice-playlist-recording" aria-label="Optional whole phrase recording" hidden={!recordingOpen && !recordingActive}>
        {recording(options.rate)}
      </section>}
    </div>
    <footer className="practice-transport">
      <div className="practice-pace-controls">
        <div className="practice-pace-control"><span>Speech speed</span><div className="practice-stepper">
          <button type="button" className="icon-button" aria-label="Slower speech" disabled={disabled || options.rate <= 0.25} onClick={() => configure({ ...options, rate: Number((options.rate - 0.05).toFixed(2)) })}><Minus size={16} /></button>
          <select aria-label="Practice speed" value={options.rate} disabled={disabled} onChange={event => configure({ ...options, rate: Number(event.target.value) })}>
            {rates.map(value => <option key={value} value={value}>{value}x</option>)}
          </select>
          <button type="button" className="icon-button" aria-label="Faster speech" disabled={disabled || options.rate >= 1.25} onClick={() => configure({ ...options, rate: Number((options.rate + 0.05).toFixed(2)) })}><Plus size={16} /></button>
        </div></div>
        <div className="practice-pace-control"><span>Repeat pause</span><div className="practice-stepper">
          <button type="button" className="icon-button" aria-label="Shorter repeat pause" disabled={disabled || options.pauseSeconds <= 0} onClick={() => configure({ ...options, pauseSeconds: Number(Math.max(0, options.pauseSeconds - 0.25).toFixed(2)) })}><Minus size={16} /></button>
          <select aria-label="Repetition pause" value={options.pauseSeconds} disabled={disabled} onChange={event => configure({ ...options, pauseSeconds: Number(event.target.value) })}>
            {pauseValues.map(value => <option key={value} value={value}>{value}s</option>)}
          </select>
          <button type="button" className="icon-button" aria-label="Longer repeat pause" disabled={disabled || options.pauseSeconds >= 30} onClick={() => configure({ ...options, pauseSeconds: Math.min(30, options.pauseSeconds + 0.25) })}><Plus size={16} /></button>
        </div></div>
      </div>
      <p className="visually-hidden" role="status">{status}</p>
      <div className="practice-transport-buttons">
        <button type="button" className="icon-button" aria-label="Previous step" disabled={disabled || state.index === 0} onClick={() => player.current?.seek(state.index - 1)}><SkipBack size={18} /></button>
        <button type="button" className="button primary" aria-label={playing ? 'Pause practice' : 'Play practice'} disabled={disabled} onClick={() => playing ? player.current?.pause() : player.current?.play()}>
          {playing ? <Pause size={20} /> : <Play size={20} />}{playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="icon-button" aria-label="Next step" disabled={disabled || state.index >= tracks.length - 1} onClick={() => player.current?.seek(state.index + 1)}><SkipForward size={18} /></button>
      </div>
      <div className="practice-repeat-controls">
        <button type="button" disabled={disabled || options.pacing !== 'guided'} aria-pressed={Boolean(options.loop)} onClick={() => configure({ ...options, loop: !options.loop })}><Repeat2 size={15} />Loop <span>{options.loop ? 'On' : 'Off'}</span></button>
        <button type="button" disabled={disabled || !options.loop || options.pacing !== 'guided'} aria-pressed={Boolean(options.autoRamp)}
          title={options.pacing !== 'guided' ? 'Choose Guided pacing in Practice options to use Auto-ramp' : !options.loop ? 'Turn on Loop to use Auto-ramp' : 'Accelerate after each complete round'}
          onClick={() => configure({ ...options, autoRamp: !options.autoRamp })}><TrendingUp size={15} />Auto-ramp <span>{options.autoRamp ? 'On' : 'Off'}</span></button>
      </div>
      {(error || state.error) && <p className="practice-error" role="alert">{error || state.error}</p>}
    </footer>
  </dialog>, document.body)
}
