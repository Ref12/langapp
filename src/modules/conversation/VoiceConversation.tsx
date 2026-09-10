import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import type { ConversationMessage, LanguageProfile } from '../../core/domain'
import { createId, nowIso } from '../../core/ids'
import { invokeAIOperation } from '../../core/ai/operations'
import { getAIConfigurationVersion } from '../../core/ai/provider'
import { playSpeechSegments, stopSpeech } from '../../core/speech'
import { transcriptionService, pronunciationService } from '../../core/voice/services'
import { targetLocales, type CaptureResult, type CaptureSession, type PronunciationAttempt, type SpeechLocale, type SpeechSegment, type VoiceRecording } from '../../core/voice/contracts'
import { deleteRecording, deleteThreadVoiceData, deleteVoiceThread, requestVoiceStoragePersistence, saveAttempt, saveRecording } from '../../core/voice/storage'
import { loadPlaybackPreferences, speechConnectionStatus } from '../../core/voice/connection'
import { voiceHistory } from '../../core/voice/history'
import { submitVoiceMessage } from '../../core/voice/messages'
import { AudioReplay } from './AudioReplay'

type Phase = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'saving' | 'review' | 'generating' | 'speaking' | 'assessing'
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation failed. Please retry.'
const nextMessageTime = (history: ConversationMessage[]) =>
  new Date(Math.max(Date.now(), ...history.map(message => Date.parse(message.createdAt) || 0)) + 1).toISOString()

export function VoiceConversation({ threadId, profile }: { threadId: string; profile: LanguageProfile }) {
  const messages = useLiveQuery(() => db.conversationMessages.where('threadId').equals(threadId).sortBy('createdAt'), [threadId])
  const recordings = useLiveQuery(() => db.voiceRecordings.where('threadId').equals(threadId).sortBy('createdAt'), [threadId])
  const attempts = useLiveQuery(() => db.pronunciationAttempts.where('threadId').equals(threadId).sortBy('createdAt'), [threadId])
  const connection = useLiveQuery(speechConnectionStatus, [])
  const aiVersion = useLiveQuery(getAIConfigurationVersion, [])
  const [phase, setPhase] = useState<Phase>('idle')
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState<VoiceRecording>()
  const [saved, setSaved] = useState(false)
  const [attempt, setAttempt] = useState<PronunciationAttempt>()
  const [reference, setReference] = useState<SpeechSegment>()
  const [captureMode, setCaptureMode] = useState<'conversation' | 'practice'>('conversation')
  const [recognitionLocale, setRecognitionLocale] = useState<SpeechLocale | ''>('')
  const [elapsed, setElapsed] = useState(0)
  const [partial, setPartial] = useState('')
  const [error, setError] = useState('')
  const [playbackError, setPlaybackError] = useState('')
  const [consent, setConsent] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const mounted = useRef(true)
  const busy = useRef(false)
  const operation = useRef<AbortController>()
  const capture = useRef<CaptureSession>()
  const opening = useRef(false)
  const captureDone = useRef(false)
  const configVersion = useRef<string>()
  const targetLocale = targetLocales[profile.targetLanguage]
  const capturing = ['requesting', 'recording', 'finalizing'].includes(phase)
  const locked = capturing || phase === 'saving' || phase === 'generating' || phase === 'assessing'

  useEffect(() => {
    mounted.current = true
    void db.conversationMessages.where('threadId').equals(threadId)
      .filter(message => message.status === 'pending')
      .modify({ status: 'failed', error: 'Reply interrupted by navigation or reload. Retry when ready.', cancelled: true })
      .then(() => { if (mounted.current) setRecovered(true) })
      .catch(() => { if (mounted.current) setError('Conversation recovery failed. Reload and try again.') })
    return () => {
      mounted.current = false
      operation.current?.abort()
      capture.current?.cancel()
      stopSpeech()
    }
  }, [threadId])

  useEffect(() => {
    if (connection === undefined || aiVersion === undefined) return
    const version = `${connection?.configurationVersion ?? 0}:${aiVersion}`
    if (configVersion.current !== undefined && configVersion.current !== version) {
      operation.current?.abort()
      capture.current?.cancel()
      stopSpeech()
      busy.current = false
      setPhase('idle')
      setError('Connection settings changed. The active operation was cancelled; saved recordings are unchanged.')
    }
    configVersion.current = version
  }, [connection, aiVersion])

  const play = useCallback(async (segments: SpeechSegment[], messageId?: string, slow = false) => {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    setPlaybackError('')
    setPhase('speaking')
    const preferences = loadPlaybackPreferences()
    if (slow) for (const segment of segments) preferences[segment.locale] = { ...preferences[segment.locale], rate: 0.65 }
    const savePlaybackStatus = async (playbackStatus: ConversationMessage['playbackStatus']) => {
      if (!messageId) return
      try { await db.conversationMessages.update(messageId, { playbackStatus }) }
      catch { if (mounted.current) setPlaybackError('The reply is saved, but its playback status could not be saved.') }
    }
    try {
      // Start synchronously in the tap path; persist playback status without delaying it.
      const playback = playSpeechSegments(segments, controller.signal, preferences)
      void savePlaybackStatus('playing')
      await playback
      await savePlaybackStatus('completed')
    } catch (caught) {
      await savePlaybackStatus(controller.signal.aborted ? 'interrupted' : 'failed')
      if (mounted.current && !controller.signal.aborted) setPlaybackError(errorText(caught))
    } finally {
      if (mounted.current && operation.current === controller) {
        setPhase('idle')
        operation.current = undefined
      }
    }
  }, [])

  const generate = useCallback(async (history: ConversationMessage[]) => {
    if (busy.current) return
    busy.current = true
    operation.current?.abort()
    stopSpeech()
    const controller = new AbortController()
    operation.current = controller
    setPhase('generating')
    setError('')
    const assistant: ConversationMessage = {
      id: createId('message'), threadId, role: 'assistant', canonicalContent: '',
      annotations: [], status: 'pending', createdAt: nextMessageTime(history),
    }
    try {
      await db.conversationMessages.add(assistant)
      if (controller.signal.aborted) return
      const generated = await invokeAIOperation('conversation.generateVoiceTurn', {
        targetLanguage: profile.targetLanguage, messages: voiceHistory(history),
      }, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      await db.transaction('rw', db.conversationMessages, async () => {
        if (controller.signal.aborted || !mounted.current) return
        await db.conversationMessages.update(assistant.id, {
          canonicalContent: generated.segments.map(segment => segment.text).join(' '),
          speechSegments: generated.segments, status: 'completed',
        })
      })
      if (!mounted.current || controller.signal.aborted) return
      busy.current = false
      await play(generated.segments, assistant.id)
    } catch (caught) {
      await db.conversationMessages.where('id').equals(assistant.id).filter(message => message.status === 'pending')
        .modify({ status: 'failed', error: controller.signal.aborted ? 'Reply stopped.' : errorText(caught), cancelled: controller.signal.aborted }).catch(() => undefined)
      if (mounted.current && !controller.signal.aborted) setError(errorText(caught))
    } finally {
      // A stopped placeholder never enters the bounded history.
      await db.conversationMessages.where('id').equals(assistant.id).filter(message => message.status === 'pending')
        .modify({ status: 'failed', error: 'Reply stopped.', cancelled: true }).catch(() => undefined)
      if (operation.current === controller) {
        busy.current = false
        if (mounted.current) { setPhase('idle'); operation.current = undefined }
      }
    }
  }, [threadId, profile.targetLanguage, play])

  useEffect(() => {
    if (recovered && messages && messages.length === 0 && !opening.current) {
      opening.current = true
      void generate([])
    }
  }, [messages, generate, recovered])

  const stopReply = () => {
    operation.current?.abort()
    stopSpeech()
  }

  const persistReview = async (value: VoiceRecording, practice?: PronunciationAttempt) => {
    const current = operation.current
    busy.current = true
    setPhase('saving')
    try {
      await saveRecording(value, practice)
      if (mounted.current && operation.current === current) setSaved(true)
    } finally {
      if (mounted.current && operation.current === current) { busy.current = false; setPhase('review') }
    }
  }

  const record = async (mode: 'conversation' | 'practice') => {
    if (busy.current || capturing || !consent || !connection?.configured || (mode === 'practice' && !reference)) return
    if (recording && !saved && !window.confirm('This take has not been saved. Starting another recording will discard its audio. Continue?')) return
    operation.current?.abort()
    stopSpeech()
    const controller = new AbortController()
    operation.current = controller
    busy.current = true
    captureDone.current = false
    setCaptureMode(mode)
    setPhase('requesting')
    setElapsed(0)
    setError('')
    setPartial('')
    setRecording(undefined)
    setAttempt(undefined)
    setSaved(false)
    const selectedReference = reference
    const finish = async (result: CaptureResult) => {
      if (!mounted.current || controller.signal.aborted || captureDone.current) return
      captureDone.current = true
      capture.current = undefined
      const value: VoiceRecording = {
        id: createId('recording'), profileId: profile.id, threadId, purpose: mode,
        locale: mode === 'practice' ? targetLocale : recognitionLocale || targetLocale,
        durationMs: result.durationMs, audio: result.audio,
        mimeType: 'audio/wav', encoding: 'pcm-s16le-16000-mono',
        recognizedTranscript: result.recognizedTranscript, provider: result.provider, createdAt: nowIso(),
        transcriptSegments: result.segments,
      }
      const practice: PronunciationAttempt | undefined = mode === 'practice' && selectedReference ? {
        id: createId('pronunciation'), profileId: profile.id, threadId, recordingId: value.id,
        referenceText: selectedReference.text, locale: selectedReference.locale,
        provider: result.provider, createdAt: nowIso(),
      } : undefined
      setRecording(value)
      setAttempt(practice)
      setDraft(mode === 'conversation' ? result.recognizedTranscript : '')
      setPartial('')
      setPhase('saving')
      if (result.interruption) setError(result.interruption)
      try { await persistReview(value, practice) }
      catch (caught) { if (mounted.current && operation.current === controller) setError(`Not saved on this device. ${errorText(caught)}`) }
      finally {
        if (mounted.current && operation.current === controller) { setPhase('review'); busy.current = false }
      }
    }
    try {
      void requestVoiceStoragePersistence()
      const session = await transcriptionService.start({
        mode, targetLocale, recognitionLocale: mode === 'conversation' ? recognitionLocale || undefined : targetLocale,
        signal: controller.signal,
        onElapsed: seconds => { if (mounted.current && !controller.signal.aborted) setElapsed(seconds) },
        onPartial: text => { if (mounted.current && !controller.signal.aborted) setPartial(text) },
        onTranscript: segments => { if (mounted.current && !controller.signal.aborted) setDraft(segments.map(segment => segment.text).join(' ')) },
        onFinished: result => { void finish(result) },
      })
      if (!mounted.current || controller.signal.aborted) { session.cancel(); return }
      if (!captureDone.current) {
        capture.current = { ...session, stop: async () => {
          const result = await session.stop()
          await finish(result)
          return result
        } }
        setPhase('recording')
      }
    } catch (caught) {
      if (mounted.current && operation.current === controller) {
        setPhase('idle')
        if (!controller.signal.aborted) setError(errorText(caught))
        busy.current = false
      }
    }
  }

  const stopRecording = async () => {
    const current = operation.current
    if (phase === 'requesting') {
      operation.current?.abort()
      busy.current = false
      setPhase('idle')
      return
    }
    setPhase('finalizing')
    try { await capture.current?.stop() }
    catch (caught) {
      if (mounted.current && operation.current === current) { setError(errorText(caught)); setPhase('idle'); busy.current = false }
    }
  }

  const send = async () => {
    if (busy.current || locked || !draft.trim() || (recording && !saved) || attempt) return
    busy.current = true
    const message: ConversationMessage = {
      id: createId('message'), threadId, role: 'user', canonicalContent: draft.trim(),
      annotations: [], status: 'completed', createdAt: nextMessageTime(messages ?? []),
    }
    try {
      await submitVoiceMessage(message, profile.id, recording?.id)
      if (!mounted.current) { busy.current = false; return }
      setDraft('')
      setRecording(undefined)
      setSaved(false)
      busy.current = false
      void generate([...(messages ?? []), message])
    } catch (caught) { busy.current = false; if (mounted.current) setError(errorText(caught)) }
  }

  const assess = async () => {
    if (!recording?.audio || !attempt || !saved || busy.current) return
    busy.current = true
    operation.current?.abort()
    stopSpeech()
    const controller = new AbortController()
    operation.current = controller
    setPhase('assessing')
    setError('')
    try {
      const assessed = await pronunciationService.assess(recording.audio, attempt.referenceText, attempt.locale, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      const next = { ...attempt, ...assessed, error: undefined }
      await saveAttempt(next)
      if (mounted.current && !controller.signal.aborted && operation.current === controller) setAttempt(next)
    } catch (caught) {
      if (mounted.current && !controller.signal.aborted) {
        const next = { ...attempt, error: errorText(caught) }
        setAttempt(next)
        setError(next.error)
        await saveAttempt(next).catch(() => setError('Feedback could not be saved. Keep this page open and retry.'))
      }
    } finally {
      if (operation.current === controller) {
        busy.current = false
        if (mounted.current) setPhase('review')
      }
    }
  }

  const discard = async () => {
    try {
      if (recording && saved) await deleteRecording(recording.id, profile.id)
      setRecording(undefined); setAttempt(undefined); setDraft(''); setSaved(false); setPhase('idle')
    } catch (caught) { setError(errorText(caught)) }
  }
  const resume = (value: VoiceRecording) => {
    if (busy.current || locked) return
    if (recording && !saved && !window.confirm('This take has not been saved. Resuming another recording will discard its audio and transcript. Continue?')) return
    stopReply()
    setRecording(value)
    setSaved(true)
    setDraft(value.submittedTranscript ?? value.recognizedTranscript)
    const practice = attempts?.find(item => item.recordingId === value.id)
    setAttempt(practice)
    if (practice) setReference({ text: practice.referenceText, locale: practice.locale })
    setPhase('review')
  }
  const perform = async (action: () => Promise<void>) => {
    try { await action() } catch (caught) { setError(errorText(caught)) }
  }
  const cap = captureMode === 'practice' ? 30 : 120

  return <div className="conversation voice-conversation">
    <div className="voice-toolbar">
      <strong>Voice tutor · English + {targetLocale}</strong>
      <button onClick={stopReply} disabled={phase !== 'generating' && phase !== 'speaking'}>Stop reply</button>
    </div>
    <div className="messages" aria-live="polite">
      {(messages ?? []).map(message => <article className={`message ${message.role}`} key={message.id}>
        <div className="message-label">{message.role === 'user' ? 'You' : 'LinguaWeave'}</div>
        <p>{message.status === 'pending' ? 'Thinking…' : message.canonicalContent || message.error}</p>
        {message.speechSegments && <div className="button-row">
          <button disabled={locked} onClick={() => void play(message.speechSegments!, message.id)}>Play reply</button>
          {message.speechSegments.filter(segment => segment.locale === targetLocale).map((segment, index) =>
            <button disabled={locked || (!!recording && !saved)} key={index} onClick={() => {
              setReference(segment); setError('')
              if (attempt) { setAttempt(undefined); setRecording(undefined); setDraft(''); setPhase('idle') }
            }}>
              Practice: {segment.text.slice(0, 36)}{segment.text.length > 36 ? '…' : ''}
            </button>)}
        </div>}
        {message.playbackStatus === 'interrupted' && <small>Playback stopped; reply saved.</small>}
        {message.recordingId && <AudioReplay audio={recordings?.find(item => item.id === message.recordingId)?.audio} disabled={capturing} />}
      </article>)}
      {messages?.at(-1)?.status === 'failed' && <button disabled={locked} onClick={() => void generate(messages)}>Retry tutor reply (does not resend a user turn)</button>}
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {playbackError && <div className="error-banner" role="status">{playbackError} The reply is saved. Use Play reply above.</div>}
    <section className="voice-controls" aria-label="Voice recording">
      <p>Conversation audio goes to Azure while you record, before review. Only Send submits your text to the configured AI. Recordings are stored on this device.</p>
      <details>
        <summary>Privacy and microphone setup</summary>
        <p>Audio is sent to Azure during conversation recording, before review. Practice audio is sent when you choose Assess. Only submitted text goes to your configured AI endpoint. Recordings are saved on this device. Browser/system speech may use remote services.</p>
        <p>Phrase-to-phrase language switching is supported; switching languages within a sentence may be misidentified. Review and correct before Send.</p>
      </details>
      <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={capturing}
        onChange={event => setConsent(event.target.checked)} />I understand audio goes to Azure and recordings stay on this device. Enable microphone recording.</label>
      {!connection?.configured && <p>Configure Azure Speech in Settings to record. Typed conversation is still available.</p>}
      <label>Recognition language
        <select value={recognitionLocale} disabled={capturing} onChange={event => setRecognitionLocale(event.target.value as SpeechLocale | '')}>
          <option value="">Detect English + {targetLocale}</option><option value="en-US">English</option><option value={targetLocale}>{targetLocale}</option>
        </select>
      </label>
      {capturing ? <div className="button-row">
        <p role="status">{phase === 'requesting' ? 'Requesting microphone…' : phase === 'finalizing' ? 'Finishing transcript…' : `Recording ${Math.floor(elapsed)} / ${cap}s`}
          {elapsed >= cap - 10 && ' · Stopping soon for review, not sending.'}</p>
        <button onClick={() => void stopRecording()} disabled={phase === 'finalizing'}>{phase === 'requesting' ? 'Cancel microphone request' : 'Stop recording'}</button>
      </div> : <button disabled={locked || !consent || !connection?.configured} onClick={() => void record('conversation')}>Record a turn (up to 2 minutes)</button>}
      {partial && <p className="muted">{partial}</p>}
      {recording && <div className="recording-review">
        <h3>{attempt ? 'Practice recording review' : 'Review your turn'}</h3>
        <AudioReplay audio={recording.audio} disabled={capturing} />
        <p>{phase === 'saving' ? 'Saving recording…' : saved ? recording.audioUnavailable ? 'Transcript saved on this device; audio was not included in the backup.' : 'Saved on this device.' : 'Not saved — keep this page open to retain this audio.'}</p>
        {recording.recognizedTranscript && <details><summary>Original recognized transcript</summary><p>{recording.recognizedTranscript}</p></details>}
        {!!recording.transcriptSegments?.length && <p>Detected phrases: {recording.transcriptSegments.map(segment => segment.locale).join(' → ')}</p>}
        {!saved && <button disabled={locked} onClick={() => void perform(() => persistReview(recording, attempt))}>Retry saving recording</button>}
        <button disabled={locked} onClick={() => void discard()}>Discard this recording</button>
        <button disabled={locked || !consent || !connection?.configured} onClick={() => void record(attempt ? 'practice' : 'conversation')}>Re-record (keeps saved take)</button>
      </div>}
      {!attempt && <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
        <label>Review/edit transcript or type a message
          <textarea value={draft} maxLength={20_000} disabled={capturing || phase === 'generating'} rows={3}
            onChange={event => setDraft(event.target.value)} />
        </label>
        {recording && saved && <button type="button" disabled={locked} onClick={() => void perform(async () => {
          await saveRecording({ ...recording, submittedTranscript: draft }); setRecording({ ...recording, submittedTranscript: draft })
        })}>Save draft edit</button>}
        <button className="primary-button" disabled={locked || !draft.trim() || (!!recording && !saved)}>Send</button>
      </form>}
    </section>
    {reference && <section className="voice-controls" aria-label="Pronunciation practice">
      <h3>Repeat after the tutor</h3>
      <p lang={reference.locale}>{reference.text}</p>
      <p>Say one short phrase. Stop and review, then explicitly Assess. Scores describe this recording, not overall proficiency. No tone or prosody scoring is promised.</p>
      <div className="button-row">
        <button disabled={locked} onClick={() => void play([reference])}>Hear reference</button>
        <button disabled={locked} onClick={() => void play([reference], undefined, true)}>Hear slowly</button>
        <button disabled={locked || !consent || !connection?.configured} onClick={() => void record('practice')}>Record practice (up to 30 seconds)</button>
      </div>
      {attempt && <>
        <p>Assessment reference: {attempt.referenceText}</p>
        <button disabled={locked || !saved || !recording?.audio} onClick={() => void assess()}>Assess saved audio</button>
        {phase === 'assessing' && <button onClick={() => operation.current?.abort()}>Cancel assessment</button>}
        <AssessmentFeedback attempt={attempt} />
        <button disabled={locked || !saved} onClick={() => { setAttempt(undefined); setRecording(undefined); setDraft(''); setPhase('idle') }}>Return to conversation (keep attempt)</button>
      </>}
    </section>}
    <details className="voice-controls">
      <summary>Saved recordings and practice ({recordings?.length ?? 0})</summary>
      <p>Unsent takes can be resumed after reload. Deleting a recording also deletes its practice feedback.</p>
      {(recordings ?? []).map(value => <div className="saved-recording" key={value.id}>
        <p>{value.purpose === 'practice' ? 'Practice' : value.messageId ? 'Sent turn' : 'Unsent turn'} · {new Date(value.createdAt).toLocaleString()} · {(value.durationMs / 1000).toFixed(1)}s · Azure config {value.provider.configurationVersion}</p>
        <AudioReplay audio={value.audio} disabled={capturing} />
        {attempts?.filter(item => item.recordingId === value.id).map(item => <div key={item.id}><p>{item.referenceText}</p><AssessmentFeedback attempt={item} /></div>)}
        {(!value.messageId || value.purpose === 'practice') && <button disabled={locked} onClick={() => resume(value)}>Resume review</button>}
        <button disabled={locked} onClick={() => void perform(async () => { await deleteRecording(value.id, profile.id); if (recording?.id === value.id) { setRecording(undefined); setAttempt(undefined); setDraft('') } })}>Delete recording</button>
      </div>)}
      <div className="button-row">
        <button disabled={locked} onClick={() => { if (window.confirm('Delete all recordings and pronunciation feedback for this conversation? Text messages are kept.')) void perform(async () => { stopReply(); await deleteThreadVoiceData(threadId, profile.id); setRecording(undefined); setAttempt(undefined); setDraft('') }) }}>Delete this thread’s voice data</button>
        <button disabled={locked} onClick={() => { if (window.confirm('Delete this conversation and its recordings? Dictionary evidence is kept.')) void perform(() => deleteVoiceThread(threadId, profile.id)) }}>Delete conversation</button>
      </div>
    </details>
  </div>
}

function AssessmentFeedback({ attempt }: { attempt: PronunciationAttempt }) {
  const result = attempt.result
  if (attempt.error) return <p role="status">{attempt.error}</p>
  if (!result) return null
  return <div className="assessment-feedback">
    <p>{result.status === 'no-speech' ? 'No speech was detected. Record another attempt.' : result.status === 'incomplete' ? 'Incomplete assessment. Available measurements are shown; try a single short phrase.' : 'Azure assessment of your original recording.'}</p>
    <dl>{(['accuracy', 'fluency', 'completeness'] as const).map(metric => result[metric] === undefined ? null :
      <div key={metric}><dt>{metric}</dt><dd>{result[metric]?.toFixed(0)} / 100</dd></div>)}</dl>
    {result.words.length > 0 && <ul>{result.words.map((word, index) => <li key={index}>
      <strong>{word.text}</strong>{word.accuracy !== undefined && ` · Accuracy ${word.accuracy.toFixed(0)}`}
      {word.errorType && word.errorType !== 'None' && ` · ${word.errorType}`}
      {word.phonemes?.length ? <small> · Returned phonemes: {word.phonemes.map(phoneme => `${phoneme.text}${phoneme.accuracy === undefined ? '' : ` ${phoneme.accuracy.toFixed(0)}`}`).join(', ')}</small> : null}
    </li>)}</ul>}
    {result.words.some(word => word.errorType === 'Omission' || word.errorType === 'Insertion') && <p>Omission and Insertion labels compare recognized text with the reference; recognition errors can affect these labels. They are not acoustic scores.</p>}
    {result.words.some(word => word.errorType === 'Omission') && <p>Try including the words marked Omission when you repeat the reference.</p>}
    {result.words.some(word => word.errorType === 'Insertion') && <p>Words marked Insertion were extra compared with the reference.</p>}
    {result.words.some(word => word.errorType === 'Mispronunciation') && <p>Listen again to the model for words marked Mispronunciation, then try another take.</p>}
  </div>
}
