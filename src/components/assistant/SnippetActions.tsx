import { useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { MessageCircle, Repeat2, Square, Volume2, X } from 'lucide-react'
import { prepareAssistantDraft } from '../../core/assistant/draft-actions'
import { type AssistantSource, type SpeechLocale } from '../../core/assistant/contracts'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech, subscribePlayback } from '../../core/assistant/speech'
import { selectedSnippet, snippetLocale } from '../../core/assistant/selection'
import { navigate } from '../../core/routing'
import { LocalSpeechRateSetupContext } from './local-ai-setup-context'
import { interruptAudio } from '../../core/assistant/audio-owner'

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

export function SnippetActions({ source, rate, onPrepared, onPractice, practiceDisabled = false, practiceTitle = 'Practice repeating this phrase' }: {
  source: AssistantSource; rate?: number; onPrepared?: () => void; onPractice?: () => void; practiceDisabled?: boolean; practiceTitle?: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<string>()
  const speedSetup = useContext(LocalSpeechRateSetupContext)
  const [page, currentId] = window.location.hash.slice(1).replace(/^\/+/, '').split('/')
  const createsConversation = page !== 'conversation' || !currentId
  return <div className="snippet-actions" data-assistant-exclude>
    <div className="button-row">
      {source.locale && <HearButton text={source.text} locale={source.locale} rate={rate} />}
      <button type="button" className="button secondary snippet-button" disabled={pending || (createsConversation && speedSetup === 'loading')} onClick={() => {
        setPending(true)
        setError('')
        const [page, currentId] = window.location.hash.slice(1).replace(/^\/+/, '').split('/')
        void prepareAssistantDraft(source, page === 'conversation' ? currentId : undefined).then(id => {
          if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) setPrepared(id)
          else { onPrepared?.(); navigate(`conversation/${id}`) }
        }, reason => { setError(reason instanceof Error ? reason.message : 'The Assistant draft could not be saved.') })
          .finally(() => setPending(false))
      }}><MessageCircle size={15} />{pending ? 'Preparing draft...' : 'Ask'}</button>
      {onPractice && <button type="button" className="button secondary snippet-button" title={practiceTitle} disabled={practiceDisabled} onClick={onPractice}>
        <Repeat2 size={15} />Practice
      </button>}
    </div>
    {error && <p className="small" role="alert">{error}</p>}
    {prepared && <p className="small" role="status">Your draft is saved. <a className="text-link" href={`#conversation/${prepared}`}>Open Assistant</a> after finishing this dialog.</p>}
  </div>
}

export function PlaybackStatus() {
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
  return <div className="playback-status" data-assistant-exclude role={playback.error || error ? 'alert' : 'status'}>
    <span>{error || playback.error || (playback.phase === 'loading-audio' ? 'Preparing Edge speech...'
      : playback.phase === 'loading-voices' ? 'Looking for a voice...'
      : playback.voiceKind === 'edge' ? playback.phase === 'starting' ? 'Starting Edge speech...' : 'Playing with Edge TTS (online)'
      : playback.voiceKind === 'system' ? playback.phase === 'starting' ? 'Starting system-selected speech (may be online)...' : 'Playing with a system-selected voice (may be online)'
      : playback.phase === 'starting' ? `Starting ${playback.voiceKind === 'online' ? 'online' : 'local'} speech...`
        : playback.voiceKind === 'online' ? 'Playing with an online browser voice' : 'Playing with an installed local voice')}</span>
    <button className="icon-button" type="button" aria-label={error ? 'Retry stopping audio' : playback.error ? 'Dismiss playback error' : 'Stop all playback'} onClick={stop}>
      {playback.error && !error ? <X size={18} /> : <Square size={18} />}
    </button>
  </div>
}

export function SelectionActions({ route, title }: { route: string; title: string }) {
  const [text, setText] = useState<string>()
  const toolbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const read = () => {
      if (toolbar.current?.contains(document.activeElement)) return
      const root = document.getElementById('main')
      setText(root ? selectedSnippet(window.getSelection(), root) : undefined)
    }
    const keys = (event: KeyboardEvent) => {
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
  useEffect(() => { setText(undefined) }, [route])
  return text ? <div className="selection-actions" ref={toolbar} role="toolbar" aria-label="Selected text actions" data-assistant-exclude
    onMouseDown={event => event.preventDefault()}>
    <SnippetActions key={`${route}:${text}`} source={{ text, title: `Selection from ${title}`, route, locale: snippetLocale(text) }} onPrepared={() => setText(undefined)} />
    <button type="button" className="icon-button" aria-label="Dismiss selected text actions" onClick={() => setText(undefined)}><X size={18} /></button>
  </div> : null
}
