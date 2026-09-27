import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantMessage, AssistantThread, SpeechBlock } from '../../core/assistant/contracts'
import type { SpeechConnection } from '../../core/assistant/speech-contracts'
import { interruptAudio } from '../../core/assistant/audio-owner'
import { stopBrowserSpeech } from '../../core/assistant/speech'
import { savePracticeChain } from '../../core/assistant/practice-chain-store'
import { SnippetActions } from './SnippetActions'
import { PracticeFeedback } from './PracticeFeedback'
import { PracticeRecording } from './PracticeRecording'
import { PracticePlaylist } from './PracticePlaylist'

interface PhrasePracticeProps {
  thread: AssistantThread
  phrase: SpeechBlock
  busy: boolean
  speechConnection?: SpeechConnection
  connectionLoading: boolean
  onClose: () => Promise<void>
  open?: boolean
  inline?: {
    message: AssistantMessage
    blockIndex: number
    active: boolean
    activate: () => void
  }
}

export function PhrasePractice({ thread, phrase, busy, speechConnection, connectionLoading, onClose, inline, open = false }: PhrasePracticeProps) {
  const [localOpen, setLocalOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const recordingClose = useRef<() => void>()
  const closeAction = useRef(onClose)
  closeAction.current = onClose
  const registerClose = useCallback((guard?: () => void) => { recordingClose.current = guard }, [])
  const isInline = Boolean(inline)
  useEffect(() => () => {
    if (isInline) void closeAction.current().catch(() => console.error('Practice could not be closed.'))
  }, [isInline])
  const visible = inline ? inline.active : open || localOpen
  const result = inline?.message.practiceResults?.find(entry => entry.blockIndex === inline.blockIndex)?.result
  const saved = inline
    ? inline.message.practiceChains?.find(entry => entry.blockIndex === inline.blockIndex)?.chain
    : thread.practiceChain
  const close = async () => {
    recordingClose.current?.()
    await onClose()
    setLocalOpen(false)
    setRecording(false)
  }
  const closePopup = useRef(close)
  closePopup.current = close
  const connection = useRef<{ loaded: boolean; revision?: string }>({ loaded: false })
  useEffect(() => {
    if (connectionLoading) return
    const previous = connection.current
    connection.current = { loaded: true, revision: speechConnection?.revision }
    if (visible && previous.loaded && previous.revision !== speechConnection?.revision) {
      void closePopup.current().catch(cause => setError(cause instanceof Error ? cause.message : 'Practice could not be closed.'))
    }
  }, [connectionLoading, speechConnection?.revision, visible])
  const activate = () => {
    setError('')
    try {
      interruptAudio()
      const failure = stopBrowserSpeech()
      if (failure) throw new Error(failure)
      if (inline) inline.activate()
      else setLocalOpen(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Other audio could not be stopped. Try Practice again.')
    }
  }
  const recordingControls = thread.practiceInput === 'spoken-feedback' ? (rate: number) => <PracticeRecording
    thread={thread} playbackRate={rate} phrase={phrase} busy={busy}
    speechConnection={speechConnection} connectionLoading={connectionLoading}
    inline={inline ? { ...inline, active: recording, activate: () => setRecording(true) } : undefined}
    onActiveChange={inline ? undefined : setRecording}
    onCloseGuard={registerClose}
    onClose={inline ? async () => setRecording(false) : close}
  /> : undefined

  return <div className={inline ? 'inline-practice' : 'panel phrase-practice'} data-assistant-exclude>
    {!inline && <>
      <h2>Practice this translation</h2>
      <p className="speech-native" lang="zh-Hans">{phrase.text}</p>
      {phrase.meaning && <p className="small muted">{phrase.meaning}</p>}
    </>}
    <SnippetActions source={{
      text: phrase.text, meaning: phrase.meaning, locale: phrase.locale,
      title: 'Assistant phrase', route: `conversation/${thread.id}`,
    }} rate={thread.speechRate} onPractice={activate} practiceDisabled={busy}
      practiceTitle="Open the phrase practice playlist" />
    {error && <p role="alert" className="small connection-error">{error}</p>}
    {inline && result && !visible && <PracticeFeedback result={result} />}
    {visible && <PracticePlaylist phrase={phrase} rate={thread.speechRate}
      savedEnds={saved?.text === phrase.text ? saved.ends : undefined}
      savedItems={saved?.text === phrase.text ? saved.items : undefined}
      busy={busy} recordingActive={recording} recording={recordingControls}
      onSave={(ends, items) => savePracticeChain(thread.id, phrase, ends, inline ? {
        messageId: inline.message.id, blockIndex: inline.blockIndex,
      } : undefined, items)}
      onClose={close} />}
  </div>
}
