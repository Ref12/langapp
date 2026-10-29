import type { ReactNode } from 'react'
import { useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MessageCircle, MoreHorizontal, PenLine, Repeat2, Square, Volume2, X } from 'lucide-react'
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
import { PhraseKnowledge } from './PhraseKnowledge'
import { WritePractice } from './WritePractice'
import { savePreferences } from '../../core/learning'

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

/** The phrase's actions, always beside the phrase: an icon Hear button and a "…" menu (Ask, Practice, Write, Learn). */
export function SnippetActions({ source, rate, onPrepared, onPractice, onWrite, practiceDisabled = false, practiceTitle = 'Practice repeating this phrase', knowledge = true, learn }: {
  source: AssistantSource; rate?: number; onPrepared?: () => void; onPractice?: () => void; onWrite?: () => void; practiceDisabled?: boolean; practiceTitle?: string
  knowledge?: boolean
  /** Replaces the Learn item (null hides it), e.g. a character is added to the character set. */
  learn?: ReactNode
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<string>()
  const speedSetup = useContext(LocalSpeechRateSetupContext)
  const [page, currentId] = window.location.hash.slice(1).replace(/^\/+/, '').split('/')
  const createsConversation = page !== 'conversation' || !currentId
  return <div className="snippet-actions" data-assistant-exclude>
    <div className="snippet-actions-row">
      {source.locale && <HearButton text={source.text} locale={source.locale} rate={rate} iconOnly label={`Hear ${source.text}`} />}
      <ActionMenu label="Phrase actions" trigger={<MoreHorizontal size={20} />}>{close => <div className="phrase-menu">
        <button type="button" className="button secondary snippet-button" disabled={pending || (createsConversation && speedSetup === 'loading')} onClick={() => {
          setPending(true)
          setError('')
          const [page, currentId] = window.location.hash.slice(1).replace(/^\/+/, '').split('/')
          void prepareAssistantDraft(source, page === 'conversation' ? currentId : undefined).then(id => {
            if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) setPrepared(id)
            else { close(false); onPrepared?.(); navigate(`conversation/${id}`) }
          }, reason => { setError(reason instanceof Error ? reason.message : 'The Assistant draft could not be saved.') })
            .finally(() => setPending(false))
        }}><MessageCircle size={15} />{pending ? 'Preparing draft...' : 'Ask'}</button>
        {onPractice && <button type="button" className="button secondary snippet-button" title={practiceTitle} disabled={practiceDisabled} onClick={() => { close(); onPractice() }}>
          <Repeat2 size={15} />Practice
        </button>}
        {onWrite && <button type="button" className="button secondary snippet-button" title="Practice writing this phrase" disabled={practiceDisabled} onClick={() => { close(); onWrite() }}>
          <PenLine size={15} />Write
        </button>}
        {learn !== undefined ? learn : knowledge && source.locale === 'zh-Hans' && <PhraseKnowledge text={source.text} />}
        {error && <p className="small" role="alert">{error}</p>}
        {prepared && <p className="small" role="status">Your draft is saved. <a className="text-link" href={`#conversation/${prepared}`}>Open Assistant</a> after finishing this dialog.</p>}
      </div>}</ActionMenu>
    </div>
  </div>
}

/** The Speak / Write switch of the Practice sheet; the last mode is remembered in the workspace preferences. */
function usePracticeWrite(text: string, route: string, romanization?: string, forced?: 'speak' | 'write') {
  const stored = useLiveQuery(() => db.preferences.get('workspace').then(item => item?.practiceMode ?? 'speak'), [])
  const [local, setLocal] = useState<'speak' | 'write'>()
  const mode = local ?? forced ?? stored ?? 'speak'
  const onMode = (next: 'speak' | 'write') => {
    setLocal(next)
    void savePreferences({ practiceMode: next }).catch(() => undefined)
  }
  return { mode, onMode, content: <WritePractice text={text} romanization={romanization} route={route} onSpeak={() => onMode('speak')} /> }
}

export function PracticeSheet({ route, ...props }: { route: string } & Omit<Parameters<typeof PracticePlaylist>[0], 'write'> & { forced?: 'speak' | 'write' }) {
  const { forced, ...rest } = props
  const write = usePracticeWrite(rest.phrase.text, route, rest.phrase.romanization, forced)
  return <PracticePlaylist {...rest} write={write} />
}

/** The Practice sheet in Write mode for a phrase: its words, each a link into writing practice. Closing returns to `route`. */
export function WritePracticeSheet({ route, phrase, rate, onClose }: { route: string; phrase: SpeechBlock; rate: SpeechRate; onClose: () => void }) {
  const [saved, setSaved] = useState<{ ends: number[]; items?: PracticePlaylistItem[] }>()
  return <PracticeSheet route={route} forced="write" phrase={phrase} rate={rate} savedEnds={saved?.ends} savedItems={saved?.items} busy={false} recordingActive={false}
    saveNotice="This phrase and its edited playlist are saved in History. No conversation or learning progress is changed."
    onSave={async (ends, items) => { setSaved({ ends, ...(items ? { items } : {}) }) }}
    onClose={async () => onClose()} />
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

/** Hear / Ask / Practice for a fixed Mandarin text, with the same standalone practice playlist the selection toolbar opens. */
export function PracticeSnippet({ source, knowledge = true, learn, practiceMode, onWrite }: {
    source: AssistantSource; knowledge?: boolean; learn?: ReactNode
    /** Open Practice in this mode instead of the remembered one. */
    practiceMode?: 'speak' | 'write'
    /** Replaces the Write item's default (the Practice sheet in Write mode). */
    onWrite?: () => void
  }) {
  const [practice, setPractice] = useState<SpeechBlock>()
  const [mode, setMode] = useState<'speak' | 'write'>()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{ text: string; ends: number[]; items?: PracticePlaylistItem[] }>()
  const preferences = useLiveQuery(() => db.preferences.get('workspace'), [])
  const unavailable = selectionPracticeUnavailable(source.text)
  const open = (next?: 'speak' | 'write') => {
    setError('')
    try {
      if (unavailable) throw new Error(unavailable)
      if (document.querySelector('dialog[open]')) throw new Error('Close the current dialog before opening practice.')
      const phrase = practicePhraseSchema.parse({ type: 'speech', text: source.text, locale: 'zh-Hans' })
      interruptAudio()
      const failure = stopBrowserSpeech()
      if (failure) throw new Error(failure)
      setMode(next)
      setPractice(phrase)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Practice could not be opened.')
    }
  }
  return <>
    <SnippetActions source={source} knowledge={knowledge} learn={learn} rate={preferences?.defaultSpeechRate} onPractice={() => open(practiceMode)} onWrite={onWrite ?? (() => open('write'))} practiceDisabled={Boolean(unavailable)} practiceTitle={unavailable ?? 'Practice repeating this phrase'} />
    {error && <p role="alert" className="small connection-error">{error}</p>}
    {practice && <PracticeSheet route={source.route} forced={mode} phrase={practice} rate={preferences?.defaultSpeechRate ?? 1}
      savedEnds={saved?.text === practice.text ? saved.ends : undefined} savedItems={saved?.text === practice.text ? saved.items : undefined}
      busy={false} recordingActive={false}
      saveNotice="This phrase and its edited playlist are saved in History. No conversation or learning progress is changed."
      onSave={async (ends, items) => { setSaved(practiceChainSchema.parse({ text: practice.text, ends, ...(items ? { items } : {}) })) }}
      onClose={async () => { setPractice(undefined) }} />}
  </>
}

export function SelectionActions({ route, title, rate = 1 }: { route: string; title: string; rate?: SpeechRate }) {
  const [text, setText] = useState<string>()
  const [practice, setPractice] = useState<{ phrase: SpeechBlock; rate: SpeechRate; mode?: 'speak' | 'write' }>()
  const [practiceError, setPracticeError] = useState('')
  const [savedPractice, setSavedPractice] = useState<{ text: string; ends: number[]; items?: PracticePlaylistItem[] }>()
  const toolbar = useRef<HTMLDivElement>(null)
  const pointerHeld = useRef(false)
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>()
  const outsideTap = useRef(false)
  const [page, threadId] = route.split('/')
  const threadRate = useLiveQuery(async () => page === 'conversation' && threadId
    ? (await db.assistantThreads.get(threadId))?.speechRate
    : undefined, [page, threadId])
  useEffect(() => {
    const read = () => {
      if (toolbar.current?.contains(document.activeElement) || document.querySelector('dialog[open]')) return
      // A touch on the toolbar collapses the selection before focus moves; keep the text while it is pressed or its menu is open.
      if (pointerHeld.current) return
      if (!outsideTap.current && toolbar.current?.querySelector('[aria-expanded="true"]')) return
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
    const outside = (event: PointerEvent) => {
      outsideTap.current = !(event.target instanceof Node && toolbar.current?.contains(event.target))
      if (outsideTap.current) { clearTimeout(releaseTimer.current); pointerHeld.current = false }
    }
    document.addEventListener('selectionchange', read)
    document.addEventListener('keydown', keys)
    document.addEventListener('pointerdown', outside, true)
    return () => {
      document.removeEventListener('selectionchange', read); document.removeEventListener('keydown', keys)
      document.removeEventListener('pointerdown', outside, true)
      clearTimeout(releaseTimer.current)
    }
  }, [])
  useEffect(() => {
    setText(undefined); setPractice(undefined); setSavedPractice(undefined); setPracticeError('')
  }, [route])
  const unavailable = text ? selectionPracticeUnavailable(text) : undefined
  const openPractice = (mode?: 'speak' | 'write') => {
    if (!text) return
    setPracticeError('')
    try {
      if (unavailable) throw new Error(unavailable)
      if (document.querySelector('dialog[open]')) throw new Error('Close the current dialog before opening selection practice.')
      const phrase = practicePhraseSchema.parse({ type: 'speech', text, locale: 'zh-Hans' })
      interruptAudio()
      const failure = stopBrowserSpeech()
      if (failure) throw new Error(failure)
      setPractice({ phrase, rate: threadRate ?? rate, mode })
    } catch (reason) {
      setPracticeError(reason instanceof Error ? reason.message : 'Selection practice could not be opened.')
    }
  }
  return <>
    {text && <div className="selection-actions" ref={toolbar} role="toolbar" aria-label="Selected text actions" data-assistant-exclude
      hidden={Boolean(practice)} onMouseDown={event => event.preventDefault()}
      onPointerDownCapture={() => {
        clearTimeout(releaseTimer.current)
        pointerHeld.current = true
      }}
      onPointerUpCapture={() => { clearTimeout(releaseTimer.current); releaseTimer.current = setTimeout(() => { pointerHeld.current = false }, 400) }}
      onPointerCancelCapture={() => { clearTimeout(releaseTimer.current); releaseTimer.current = setTimeout(() => { pointerHeld.current = false }, 400) }}
      onClickCapture={() => { clearTimeout(releaseTimer.current); releaseTimer.current = setTimeout(() => { pointerHeld.current = false }, 400) }}>
      <SnippetActions key={`${route}:${text}`} source={{ text, title: `Selection from ${title}`, route, locale: snippetLocale(text) }}
        onPrepared={() => setText(undefined)} onPractice={() => openPractice()} onWrite={() => openPractice('write')} practiceDisabled={Boolean(unavailable)}
        practiceTitle={unavailable ?? 'Practice the selected Mandarin text'} />
      <button type="button" className="icon-button" aria-label="Dismiss selected text actions" onClick={() => setText(undefined)}><X size={18} /></button>
      {unavailable && <p className="small muted selection-actions-note">{unavailable}</p>}
      {practiceError && <p role="alert" className="small connection-error selection-actions-note">{practiceError}</p>}
    </div>}
    {practice && <PracticeSheet route={route} forced={practice.mode} key={`${route}:${practice.phrase.text}`} phrase={practice.phrase} rate={practice.rate}
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
