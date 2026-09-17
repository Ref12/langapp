import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { practicePhraseSchema, type AssistantMessage, type AssistantThread, type PracticeResult, type SpeechBlock } from '../../core/assistant/contracts'
import type { SpeechConnection } from '../../core/assistant/speech-contracts'
import { getPlaybackState, playBrowserSpeechToEnd, stopBrowserSpeech, subscribePlayback } from '../../core/assistant/speech'
import { prepareRecordingCue, type RecordingCue } from '../../core/assistant/recording-cue'
import { speechCaptureSupported, startSpeechCapture, type SpeechCaptureSession } from '../../core/assistant/speech-capture'
import { azureSpeechCaptureSupported, startAzurePracticeCapture, type SpeechAssessmentCaptureState } from '../../core/assistant/speech-assessment'
import { saveInlinePracticeResult, savePracticeResult } from '../../core/assistant/practice-results'
import { HearButton, SnippetActions } from './SnippetActions'
import { PracticeFeedback } from './PracticeFeedback'

interface PendingResult { id: string; result: PracticeResult }
interface InlinePractice {
  message: AssistantMessage
  blockIndex: number
  active: boolean
  activate: () => void
}

export function PhrasePractice({ thread, phrase, busy, speechConnection, connectionLoading, onClose, inline }: {
  thread: AssistantThread; phrase: SpeechBlock; busy: boolean; speechConnection?: SpeechConnection; connectionLoading: boolean
  onClose: () => Promise<void>; inline?: InlinePractice
}) {
  const [capture, setCapture] = useState<SpeechAssessmentCaptureState>({ phase: 'finished', transcript: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAttempt, setSavedAttempt] = useState(false)
  const [leadIn, setLeadIn] = useState<'phrase' | 'cue'>()
  const playbackId = useId()
  const panel = useRef<HTMLElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const session = useRef<SpeechCaptureSession>()
  const cue = useRef<RecordingCue>()
  const pendingResult = useRef<PendingResult>()
  const submitted = useRef(!inline)
  const lifecycle = useRef({ mounted: false, version: 0 })
  const closeAction = useRef(onClose)
  closeAction.current = onClose
  const isInline = Boolean(inline)
  const spoken = thread.practiceInput === 'spoken-feedback'
  const useProvider = (thread.speechFeedback ?? true) && !!speechConnection
  const supported = useProvider ? azureSpeechCaptureSupported() : speechCaptureSupported()
  const recording = ['starting', 'listening', 'stopping'].includes(capture.phase)
  const assessing = capture.phase === 'assessing'

  const releaseCue = useCallback(() => {
    const current = cue.current
    cue.current = undefined
    if (current) void current.cancel().catch(() => {
      const message = 'The recording sound could not be stopped. Close this page before trying again.'
      if (lifecycle.current.mounted) setError(message)
      else console.error(message)
    })
  }, [])
  const cancelCapture = useCallback(() => {
    lifecycle.current.version++
    releaseCue()
    session.current?.cancel()
    session.current = undefined
    if (getPlaybackState().activeId === playbackId) stopBrowserSpeech()
    setLeadIn(undefined)
    setCapture(previous => ({ ...previous, phase: 'finished', cancelled: true }))
  }, [playbackId, releaseCue])
  const closeInline = () => {
    cancelCapture()
    pendingResult.current = undefined
    void closeAction.current().catch(() => setError('Practice could not be closed.'))
  }
  const dismiss = useRef(closeInline)
  dismiss.current = closeInline
  useEffect(() => {
    const lifetime = lifecycle.current
    lifetime.mounted = true
    if (!isInline && !document.activeElement?.closest('.assistant-settings-popup')) panel.current?.focus()
    const unsubscribe = subscribePlayback(() => {
      const activeId = getPlaybackState().activeId
      if (activeId && activeId !== playbackId) {
        if (isInline) dismiss.current()
        else cancelCapture()
      }
    })
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingResult.current && submitted.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      lifetime.mounted = false
      lifetime.version++
      releaseCue()
      session.current?.cancel()
      if (getPlaybackState().activeId === playbackId) stopBrowserSpeech()
      if (isInline) void closeAction.current().catch(() => console.error('Practice could not be closed.'))
      unsubscribe()
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [isInline, playbackId, cancelCapture, releaseCue])
  useEffect(() => {
    if (busy || (isInline && !inline?.active)) {
      if (isInline) dismiss.current()
      else cancelCapture()
    }
  }, [busy, isInline, inline?.active, cancelCapture])
  useEffect(() => {
    if (isInline && !inline?.active) return
    if (inline?.active) submitButton.current?.focus()
    const cancel = () => { if (isInline) dismiss.current(); else cancelCapture() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    const hidden = () => { if (document.hidden) cancel() }
    const pagehide = cancel
    document.addEventListener('keydown', escape)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pagehide)
    return () => {
      document.removeEventListener('keydown', escape)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', pagehide)
    }
  }, [inline?.active, isInline, cancelCapture])

  const persist = async (attempt: PendingResult) => {
    setSaving(true)
    setError('')
    try {
      if (inline) await saveInlinePracticeResult(thread.id, inline.message.id, inline.blockIndex, attempt.result)
      else await savePracticeResult(thread.id, attempt.id, attempt.result)
      pendingResult.current = undefined
      if (lifecycle.current.mounted) {
        setSavedAttempt(true)
        if (inline) await closeAction.current()
      }
    } catch (reason) {
      if (lifecycle.current.mounted) setError(`Feedback not saved. ${reason instanceof Error ? reason.message : 'Check browser storage.'}`)
    } finally { if (lifecycle.current.mounted) setSaving(false) }
  }
  const startCapture = (version: number, reference: PracticeResult['phrase'], recordingCue: RecordingCue) => {
    const id = crypto.randomUUID()
    let finished = false
    let cued = false
    const soundCue = async () => {
      if (cued) return true
      cued = true
      setLeadIn('cue')
      try {
        await recordingCue.play()
        if (lifecycle.current.mounted && lifecycle.current.version === version && !finished) setLeadIn(undefined)
        return true
      } catch (reason) {
        if (lifecycle.current.mounted && lifecycle.current.version === version && !finished) {
          if (inline) closeInline()
          else cancelCapture()
          setError(reason instanceof Error ? reason.message : 'The recording start sound could not be played.')
        }
        return false
      }
    }
    const receive = (next: SpeechAssessmentCaptureState) => {
      if (!lifecycle.current.mounted || lifecycle.current.version !== version || finished) {
        if (next.cancelled && next.error) console.error(next.error)
        return
      }
      setCapture(next)
      if (!useProvider && next.phase === 'listening' && !cued) {
        // Browser recognition owns its microphone; signal readiness on its actual start.
        void soundCue()
      }
      if (next.phase !== 'finished' && next.phase !== 'error') return
      finished = true
      session.current = undefined
      releaseCue()
      setLeadIn(undefined)
      if (next.cancelled) {
        if (inline) void closeAction.current().catch(() => setError('Practice could not be closed.'))
        return
      }
      const result: PracticeResult = next.phase === 'error'
        ? { kind: 'error', service: useProvider ? 'azure' : 'browser', phrase: reference, transcript: next.transcript, error: next.error || 'Recording could not finish.' }
        : useProvider
          ? next.assessment
            ? { kind: 'azure', phrase: reference, transcript: next.transcript, assessment: next.assessment }
            : { kind: 'error', service: 'azure', phrase: reference, transcript: next.transcript, error: 'The speech provider returned no assessment.' }
          : { kind: 'transcript-diff', phrase: reference, transcript: next.transcript, reason: thread.speechFeedback === false ? 'disabled' : 'not-configured' }
      const attempt = { id, result }
      pendingResult.current = attempt
      if (submitted.current) void persist(attempt)
    }
    try {
      const handle = useProvider && speechConnection
        ? startAzurePracticeCapture(speechConnection, reference.text, receive, {
          automaticAssessment: !inline, audioContext: recordingCue.takeContext(), beforeListening: async () => {
            if (!await soundCue()) throw new Error('The recording start sound could not be played.')
          },
        })
        : startSpeechCapture(receive)
      if (!finished) session.current = handle
    } catch {
      receive({ phase: 'error', transcript: '', error: 'Recording could not start. Check microphone permissions.' })
    }
  }
  const start = () => {
    cancelCapture()
    const version = lifecycle.current.version
    submitted.current = !inline
    pendingResult.current = undefined
    setError('')
    setSavedAttempt(false)
    setCapture({ phase: 'finished', transcript: '' })
    const parsed = practicePhraseSchema.safeParse(phrase)
    if (!parsed.success) { setError('Choose a Mandarin translation before practicing.'); return }
    try { if (spoken) cue.current = prepareRecordingCue() } catch (reason) {
      if (inline) closeInline()
      setError(reason instanceof Error ? reason.message : 'The recording start sound could not be prepared.')
      return
    }
    setLeadIn('phrase')
    void playBrowserSpeechToEnd(playbackId, parsed.data.text, parsed.data.locale, thread.speechRate).then(outcome => {
      if (!lifecycle.current.mounted || lifecycle.current.version !== version) return
      setLeadIn(undefined)
      if (outcome.status !== 'completed') {
        if (inline) closeInline()
        else cancelCapture()
        if (outcome.status === 'error') setError(outcome.error)
        return
      }
      if (spoken && cue.current) startCapture(version, parsed.data, cue.current)
    })
  }
  const status = leadIn === 'phrase' ? 'Listen...' : leadIn === 'cue' ? 'Get ready...' : saving ? 'Saving feedback...' : assessing ? 'Assessing...' : capture.phase === 'stopping' ? 'Finishing recording...'
    : capture.phase === 'starting' ? 'Starting microphone...' : capture.phase === 'listening' ? 'Listening...'
      : capture.cancelled ? 'Attempt cancelled.' : 'Ready to submit.'
  const disclosure = useProvider ? 'Audio goes to Azure Speech, not the AI tutor.' : 'Your browser may use an online speech service. Comparison stays local.'

  if (inline) {
    const result = inline.message.practiceResults?.find(entry => entry.blockIndex === inline.blockIndex)?.result
    return <div className="inline-practice" data-assistant-exclude>
      {inline.active ? <div aria-label="Inline translation practice">
        <div className="button-row">
          <button ref={submitButton} type="button" className="button primary snippet-button" disabled={busy || saving || !!leadIn || assessing || capture.phase === 'starting' || capture.phase === 'stopping'}
            onClick={() => {
              if (!spoken) { closeInline(); return }
              submitted.current = true
              if (pendingResult.current) void persist(pendingResult.current)
              else session.current?.stop()
            }}>Submit</button>
          <button type="button" className="button secondary snippet-button" disabled={saving} onClick={closeInline}>Cancel</button>
        </div>
        <p className="small muted" role="status">{spoken || leadIn ? status : 'Repeat aloud. Microphone off.'}</p>
        {spoken && !assessing && !saving && <p className="small muted">{disclosure}</p>}
        {capture.transcript && !savedAttempt && <p className="small practice-live-transcript" lang="zh-Hans">{capture.transcript}</p>}
      </div> : <SnippetActions source={{ text: phrase.text, meaning: phrase.meaning, locale: phrase.locale, title: 'Assistant phrase', route: `conversation/${thread.id}` }}
        rate={thread.speechRate} practiceDisabled={busy || saving || (spoken && (connectionLoading || !supported))}
        practiceTitle={spoken ? connectionLoading ? 'Loading speech connection...' : !supported ? 'Recording unavailable in this browser.'
          : `Record this phrase. ${disclosure}` : 'Practice repeating this phrase'}
        onPractice={() => {
          inline.activate()
          setError('')
          start()
        }} />}
      {error && <p className="small connection-error" role="alert">{error}{pendingResult.current && inline.active ? ' Retry Submit to save.' : ''}</p>}
      {capture.error && inline.active && !error && <p className="small connection-error" role="alert">{capture.error}</p>}
      {!inline.active && result && <PracticeFeedback result={result} />}
    </div>
  }

  return <aside ref={panel} tabIndex={-1} className="panel phrase-practice" aria-label="Translation practice" data-assistant-exclude>
    <div className="button-row practice-heading"><h2>Practice this translation</h2>
      <button type="button" className="icon-button" aria-label="Close practice" disabled={saving} onClick={() => {
        cancelCapture()
        if (pendingResult.current) { setError('Retry saving before closing practice.'); return }
        void onClose().catch(() => setError('Practice could not be closed.'))
      }}><X size={18} /></button>
    </div>
    <p lang={phrase.locale} className="speech-native">{phrase.text}</p>
    {thread.romanization && phrase.romanization && <p className="pinyin">{phrase.romanization}</p>}
    {phrase.meaning && <p className="small muted">{phrase.meaning}</p>}
    <HearButton text={phrase.text} locale={phrase.locale} rate={thread.speechRate} />
    {!spoken ? <p className="small">Listen and repeat. Your microphone is off.</p> : <>
      <p className="small muted">{disclosure}</p>
      {connectionLoading && <p className="small" role="status">Loading speech connection...</p>}
      {!connectionLoading && !supported && <p className="small" role="status">Recording unavailable in this browser.</p>}
      <div className="button-row">
        {recording ? <button type="button" className="button secondary" disabled={!!leadIn || capture.phase === 'starting' || capture.phase === 'stopping'} onClick={() => session.current?.stop()}>
          <Square size={16} />Stop capture
        </button> : !assessing && !leadIn && <button type="button" className="button secondary"
          disabled={busy || saving || !!pendingResult.current || connectionLoading || !supported} onClick={start}>
          <Mic size={16} />{savedAttempt || capture.transcript ? 'Record again' : 'Start speaking'}
        </button>}
        {(recording || assessing || leadIn) && <button type="button" className="button secondary" onClick={cancelCapture}>Cancel attempt</button>}
      </div>
      {(recording || assessing || saving || leadIn) && <p role="status" className="small">{status}</p>}
      {capture.transcript && <p className="practice-live-transcript" lang="zh-Hans">{capture.transcript}</p>}
      {capture.cancelled && <p className="small" role="status">Attempt cancelled. No result was added.</p>}
      {capture.error && !savedAttempt && <p className="notice error" role="alert">{capture.error}</p>}
      {savedAttempt && <p className="small" role="status">Practice result added to the conversation.</p>}
    </>}
    {error && <div className="notice error" role="alert"><p>{error}</p>
      {pendingResult.current && <button type="button" className="button secondary" disabled={saving}
        onClick={() => { if (pendingResult.current) void persist(pendingResult.current) }}>Retry saving result</button>}
    </div>}
  </aside>
}
