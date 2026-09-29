import { useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MessageCircle, MoreHorizontal, Repeat2, Square, Volume2, X } from 'lucide-react'
import { prepareAssistantDraft } from '../../core/assistant/draft-actions'
import { practicePhraseSchema, type AssistantSource, type SpeechBlock, type SpeechLocale, type SpeechRate } from '../../core/assistant/contracts'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech, subscribePlayback } from '../../core/assistant/speech'
import { selectedSnippet, selectionPracticeUnavailable, snippetLocale } from '../../core/assistant/selection'
import { navigate } from '../../core/routing'
import { LocalSpeechRateSetupContext } from './local-ai-setup-context'
import { interruptAudio } from '../../core/assistant/audio-owner'
import { db } from '../../core/database'
import { practiceChainSchema, type PracticePlaylistItem } from '../../core/assistant/practice-chain-contracts'
import { PracticePlaylist } from './PracticePlaylist'
import { ActionMenu } from './ActionMenu'

export function HearButton({ text, locale, rate, label = 'Hear', iconOnly = false, buttonText = 'Hear', disabled = false }: { text: string; locale: SpeechLocale; rate?: number; label?: string; iconOnly?: boolean; buttonText?: string; disabled?: boolean }) {
  const id = useId()
  const playback = useSyncExternalStore(subscribePlayback, getPlaybackState, getPlaybackState)
  const active = playback.activeId === id
  const stopLabel = playback.phase === 'loading-voices' ? 'Cancel voice discovery' : 'Stop playback'
  useEffect(() => () => { if (getPlaybackState().activeId === id) stopBrowserSpeech() }, [id])
  return <button className={`button secondary snippet-button${iconOnly ? ' icon-only' : ''}`} type="button" title={active ? stopLabel : 'Hear with your selected voice; Automatic prefers local voices before online voices'}
    disabled={disabled && !active}
    aria-label={active ? stopLabel : label} onClick={() => active ? stopBrowserSpeech() : playBrowserSpeech(id, text, locale, rate)}>
    {active ? <Square size={15} /> : <Volume2 size={15} />}{!iconOnly && (active ? 'Stop' : buttonText)}
  </button>
}

export function SnippetActions({ source, rate, onPrepared, onPractice, practiceDisabled = false, practiceTitle = 'Practice repeating this phrase', compact = false }: {
  source: AssistantSource; rate?: number; onPrepared?: () => void; onPractice?: () => void; practiceDisabled?: boolean; practiceTitle?: string
  compact?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<string>()
  const speedSetup = useContext(LocalSpeechRateSetupContext)
  const [page, currentId] = window.location.hash.slice(1).replace(/^\/+/, '').split('/')
  const createsConversation = page !== 'conversation' || !currentId
  const content = (close?: (restoreFocus?: boolean) => void) => <div className="snippet-actions" data-assistant-exclude>
    <div className="button-row">
      {source.locale && <HearButton text={source.text} locale={source.locale} rate={rate} />}
      <button type="button" className="button secondary snippet-button" disabled={pending || (createsConversation && speedSetup === 'loading')} onClick={() => {
        setPending(true)
        setError('')
        const [page, currentId] = window.location.hash.slice(1).replace(/^\/+/, '').split('/')
        void prepareAssistantDraft(source, page === 'conversation' ? currentId : undefined).then(id => {
          if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) setPrepared(id)
          else { close?.(false); onPrepared?.(); navigate(`conversation/${id}`) }
        }, reason => { setError(reason instanceof Error ? reason.message : 'The Assistant draft could not be saved.') })
          .finally(() => setPending(false))
      }}><MessageCircle size={15} />{pending ? 'Preparing draft...' : 'Ask'}</button>
      {onPractice && <button type="button" className="button secondary snippet-button" title={practiceTitle} disabled={practiceDisabled} onClick={() => { close?.(); onPractice() }}>
        <Repeat2 size={15} />Practice
      </button>}
    </div>
    {error && <p className="small" role="alert">{error}</p>}
    {prepared && <p className="small" role="status">Your draft is saved. <a className="text-link" href={`#conversation/${prepared}`}>Open Assistant</a> after finishing this dialog.</p>}
  </div>
  return compact ? <ActionMenu label="Phrase actions" trigger={<MoreHorizontal size={20} />}>{close => content(close)}</ActionMenu> : content()
}

export function PlaybackStatus({ debug = false }: { debug?: boolean }) {
  const playback = useSyncExternalStore(subscribePlayback, getPlaybackState, getPlaybackState)
  const [error, setError] = useState('')
  const stop = useCallback(() => {
    try { interruptAudio(); setError('') } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audio could not be stopped. Close this page before trying again.')
    }
    stopBrowserSpeech()
  }, [])
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') stop() }
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keydown', escape)
      try { interruptAudio() } catch (reason) { console.error('Audio could not be stopped when leaving the app.', reason) }
      stopBrowserSpeech()
    }
  }, [stop])
  if (!playback.activeId && !playback.error && !error) return null
  const showMessage = debug || Boolean(playback.error || error)
  return <div className={`playback-status${showMessage ? '' : ' playback-status-compact'}`} data-assistant-exclude role={playback.error || error ? 'alert' : debug ? 'status' : undefined}>
    {showMessage && <span>{error || playback.error || (playback.phase === 'loading-audio' ? 'Preparing Edge speech...'
      : playback.phase === 'loading-voices' ? 'Looking for a voice...'
      : playback.voiceKind === 'edge' ? playback.phase === 'starting' ? 'Starting Edge speech...' : 'Playing with Edge TTS (online)'
      : playback.voiceKind === 'system' ? playback.phase === 'starting' ? 'Starting system-selected speech (may be online)...' : 'Playing with a system-selected voice (may be online)'
      : playback.phase === 'starting' ? `Starting ${playback.voiceKind === 'online' ? 'online' : 'local'} speech...`
        : playback.voiceKind === 'online' ? 'Playing with an online browser voice' : 'Playing with an installed local voice')}</span>}
    <button className="icon-button" type="button" aria-label={error ? 'Retry stopping audio' : playback.error ? 'Dismiss playback error' : 'Stop all playback'} onClick={stop}>
      {playback.error && !error ? <X size={18} /> : <Square size={18} />}
    </button>
  </div>
}

export function SelectionActions({ route, title, rate = 1 }: { route: string; title: string; rate?: SpeechRate }) {
  const [text, setText] = useState<string>()
  const [practice, setPractice] = useState<{ phrase: SpeechBlock; rate: SpeechRate }>()
  const [practiceError, setPracticeError] = useState('')
  const [savedPractice, setSavedPractice] = useState<{ text: string; ends: number[]; items?: PracticePlaylistItem[] }>()
  const toolbar = useRef<HTMLDivElement>(null)
  const [page, threadId] = route.split('/')
  const threadRate = useLiveQuery(async () => page === 'conversation' && threadId
    ? (await db.assistantThreads.get(threadId))?.speechRate
    : undefined, [page, threadId])
  useEffect(() => {
    const read = () => {
      if (toolbar.current?.contains(document.activeElement) || document.querySelector('dialog[open]')) return
      const root = document.getElementById('main')
      setText(root ? selectedSnippet(window.getSelection(), root) : undefined)
      setPracticeError('')
    }
    const keys = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape') setText(undefined)
      if (event.altKey && event.key === 'Enter' && toolbar.current) {
        event.preventDefault()
        toolbar.current.querySelector('button')?.focus()
      }
    }
    document.addEventListener('selectionchange', read)
    document.addEventListener('keydown', keys)
    return () => { document.removeEventListener('selectionchange', read); document.removeEventListener('keydown', keys) }
  }, [])
  useEffect(() => {
    setText(undefined); setPractice(undefined); setSavedPractice(undefined); setPracticeError('')
  }, [route])
  const unavailable = text ? selectionPracticeUnavailable(text) : undefined
  const openPractice = () => {
    if (!text) return
    setPracticeError('')
    try {
      if (unavailable) throw new Error(unavailable)
      if (document.querySelector('dialog[open]')) throw new Error('Close the current dialog before opening selection practice.')
      const phrase = practicePhraseSchema.parse({ type: 'speech', text, locale: 'zh-Hans' })
      interruptAudio()
      const failure = stopBrowserSpeech()
      if (failure) throw new Error(failure)
      setPractice({ phrase, rate: threadRate ?? rate })
    } catch (reason) {
      setPracticeError(reason instanceof Error ? reason.message : 'Selection practice could not be opened.')
    }
  }
  return <>
    {text && <div className="selection-actions" ref={toolbar} role="toolbar" aria-label="Selected text actions" data-assistant-exclude
      hidden={Boolean(practice)} onMouseDown={event => event.preventDefault()}>
      <SnippetActions key={`${route}:${text}`} source={{ text, title: `Selection from ${title}`, route, locale: snippetLocale(text) }}
        onPrepared={() => setText(undefined)} onPractice={openPractice} practiceDisabled={Boolean(unavailable)}
        practiceTitle={unavailable ?? 'Practice the selected Mandarin text'} />
      <button type="button" className="icon-button" aria-label="Dismiss selected text actions" onClick={() => setText(undefined)}><X size={18} /></button>
      {unavailable && <p className="small muted selection-actions-note">{unavailable}</p>}
      {practiceError && <p role="alert" className="small connection-error selection-actions-note">{practiceError}</p>}
    </div>}
    {practice && <PracticePlaylist key={`${route}:${practice.phrase.text}`} phrase={practice.phrase} rate={practice.rate}
      savedEnds={savedPractice?.text === practice.phrase.text ? savedPractice.ends : undefined}
      savedItems={savedPractice?.text === practice.phrase.text ? savedPractice.items : undefined}
      busy={false} recordingActive={false}
      saveNotice="This phrase and its edited playlist are saved in History. No conversation or learning progress is changed."
      onSave={async (ends, items) => {
        setSavedPractice(practiceChainSchema.parse({ text: practice.phrase.text, ends, ...(items ? { items } : {}) }))
      }}
      onClose={async () => { setPractice(undefined) }} />}
  </>
}
