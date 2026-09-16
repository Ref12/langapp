import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { MessageCircle, Square, Volume2, X } from 'lucide-react'
import { createConversation } from '../../core/assistant/store'
import { type AssistantSource, type SpeechLocale } from '../../core/assistant/contracts'
import { getPlaybackState, playLocalSpeech, stopLocalSpeech, subscribePlayback } from '../../core/assistant/speech'
import { selectedSnippet, snippetLocale } from '../../core/assistant/selection'
import { navigate } from '../../core/routing'

export function HearButton({ text, locale, rate = 1 }: { text: string; locale: SpeechLocale; rate?: number }) {
  const id = useId()
  const playback = useSyncExternalStore(subscribePlayback, getPlaybackState, getPlaybackState)
  const active = playback.activeId === id
  useEffect(() => () => { if (getPlaybackState().activeId === id) stopLocalSpeech() }, [id])
  return <button className="button secondary snippet-button" type="button" title={active ? 'Stop playback' : 'Hear with an installed local voice'}
    aria-label={active ? 'Stop playback' : 'Hear'} onClick={() => active ? stopLocalSpeech() : playLocalSpeech(id, text, locale, rate)}>
    {active ? <Square size={15} /> : <Volume2 size={15} />}{active ? 'Stop' : 'Hear'}
  </button>
}

export function SnippetActions({ source, rate = 1, onPrepared }: { source: AssistantSource; rate?: number; onPrepared?: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<string>()
  return <div className="snippet-actions" data-assistant-exclude>
    <div className="button-row">
      {source.locale && <HearButton text={source.text} locale={source.locale} rate={rate} />}
      <button type="button" className="button secondary snippet-button" disabled={pending} onClick={() => {
        setPending(true)
        setError('')
        void createConversation(source).then(id => {
          if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) setPrepared(id)
          else { onPrepared?.(); navigate(`conversation/${id}`) }
        }, reason => { setError(reason instanceof Error ? reason.message : 'The Assistant draft could not be saved.') })
          .finally(() => setPending(false))
      }}><MessageCircle size={15} />{pending ? 'Preparing draft...' : 'Ask Assistant'}</button>
    </div>
    {error && <p className="small" role="alert">{error}</p>}
    {prepared && <p className="small" role="status">Your draft is saved. <a className="text-link" href={`#conversation/${prepared}`}>Open Assistant</a> after finishing this dialog.</p>}
  </div>
}

export function PlaybackStatus() {
  const playback = useSyncExternalStore(subscribePlayback, getPlaybackState, getPlaybackState)
  useEffect(() => {
    const hidden = () => { if (document.hidden) stopLocalSpeech() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') stopLocalSpeech() }
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keydown', escape)
      stopLocalSpeech()
    }
  }, [])
  if (!playback.activeId && !playback.error) return null
  return <div className="playback-status" data-assistant-exclude role={playback.error ? 'alert' : 'status'}>
    <span>{playback.error ?? 'Playing with an installed local voice'}</span>
    <button className="icon-button" type="button" aria-label={playback.error ? 'Dismiss playback error' : 'Stop all playback'} onClick={stopLocalSpeech}>
      {playback.error ? <X size={18} /> : <Square size={18} />}
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
    onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault() }}>
    <SnippetActions key={`${route}:${text}`} source={{ text, title: `Selection from ${title}`, route, locale: snippetLocale(text) }} onPrepared={() => setText(undefined)} />
    <button type="button" className="icon-button" aria-label="Dismiss selected text actions" onClick={() => setText(undefined)}><X size={18} /></button>
  </div> : null
}
