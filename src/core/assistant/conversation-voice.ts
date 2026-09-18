import { acquireAudio, type AudioLease } from './audio-owner'
import { assistantReplySchema, speechLocaleSchema, speechRateSchema, type AssistantBlock, type SpeechLocale, type SpeechRate } from './contracts'
import { prepareRecordingCue, type RecordingCue } from './recording-cue'
import { speechCaptureSupported, startSpeechCapture, type SpeechCaptureSession, type SpeechCaptureState } from './speech-capture'
import { playBrowserSpeechToEnd, stopBrowserSpeech, type PlaybackOutcome } from './speech'

export type ConversationCaptureState = Omit<SpeechCaptureState, 'phase'> & {
  phase: SpeechCaptureState['phase'] | 'cue'
}

function errorMessage(action: string, cause: unknown) {
  return `${action}${cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : '.'}`
}

function onPageCancellation(cancel: () => void) {
  const hidden = () => { if (document.visibilityState === 'hidden') cancel() }
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keydown', escape, true)
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', cancel)
  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keydown', escape, true)
    }
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', cancel)
  }
}

function pageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function conversationCaptureSupported(): boolean {
  return speechCaptureSupported() && typeof globalThis.AudioContext === 'function'
}

export function startConversationCapture(
  locale: SpeechLocale,
  listener: (state: ConversationCaptureState) => void,
): SpeechCaptureSession {
  let lease: AudioLease | undefined
  let capture: SpeechCaptureSession | undefined
  let cue: RecordingCue | undefined
  let initializing = true
  let terminal: ConversationCaptureState | undefined
  let publishing = false
  let phase: ConversationCaptureState['phase'] = 'starting'
  let transcript = ''
  let nativeFinished = false
  let cancellingNative = false
  let stopRequested = false
  let cueStarted = false
  let cueFinished = false
  let cueCleanup: Promise<void> | undefined
  let cueCleanupError: string | undefined

  const addError = (error: string) => {
    if (terminal) terminal = { ...terminal, phase: 'error', error: [terminal.error, error].filter(Boolean).join(' ') }
  }
  const publishTerminal = () => {
    if (!terminal || initializing || publishing) return
    publishing = true
    void Promise.resolve(cueCleanup).then(() => {
      if (cueCleanupError) addError(cueCleanupError)
      try {
        listener(terminal!)
      } catch (cause) {
        // No further callback can safely report failure in a terminal listener.
        console.error(errorMessage('Conversation capture listener failed', cause))
      }
    })
  }
  const closeCue = () => {
    if (!cue || cueCleanup) return
    try {
      cueCleanup = Promise.resolve(cue.cancel()).catch(cause => {
        cueCleanupError = errorMessage('Recording cue cleanup failed', cause)
        if (!terminal) finish({ phase: 'error', transcript, error: cueCleanupError })
      })
    } catch (cause) {
      cueCleanupError = errorMessage('Recording cue cleanup failed', cause)
      cueCleanup = Promise.resolve()
    }
  }
  const cancelNative = () => {
    if (!capture || nativeFinished || cancellingNative) return
    cancellingNative = true
    try {
      capture.cancel()
    } catch (cause) {
      addError(errorMessage('Speech capture could not be cancelled', cause))
    } finally {
      cancellingNative = false
      nativeFinished = true
    }
  }
  const finish = (state: ConversationCaptureState) => {
    if (terminal) return
    terminal = state
    removePageListeners()
    lease?.release()
    cancelNative()
    closeCue()
    publishTerminal()
  }
  const notify = (state: ConversationCaptureState) => {
    if (terminal) return
    phase = state.phase
    try {
      listener(state)
    } catch (cause) {
      finish({ phase: 'error', transcript, error: errorMessage('Conversation capture listener failed', cause) })
    }
  }
  const cancel = () => finish({ phase: 'finished', transcript, cancelled: true })
  const stop = () => {
    if (terminal || stopRequested) return
    stopRequested = true
    closeCue()
    notify({ phase: 'stopping', transcript })
    if (!terminal && capture) {
      try {
        capture.stop()
      } catch (cause) {
        finish({ phase: 'error', transcript, error: errorMessage('Speech capture could not be stopped', cause) })
      }
    }
  }
  const session: SpeechCaptureSession = { stop, cancel }
  const removePageListeners = onPageCancellation(cancel)
  const receive = (state: SpeechCaptureState) => {
    if (terminal) {
      if (cancellingNative && state.error) addError(state.error)
      return
    }
    transcript = state.transcript
    if (state.phase === 'finished' || state.phase === 'error') {
      nativeFinished = true
      finish(state)
      return
    }
    if (state.phase === 'stopping') {
      stopRequested = true
      closeCue()
      notify({ ...state, phase: 'stopping' })
      return
    }
    if (stopRequested || state.phase !== 'listening') return
    if (!cueStarted) {
      cueStarted = true
      notify({ phase: 'cue', transcript: '' })
      if (terminal || stopRequested) return
      try {
        void cue!.play().then(() => {
          if (terminal || stopRequested) return
          cueFinished = true
          // Browser recognition may already be open during the cue. Suppress
          // interim display, not microphone buffers, and keep its full snapshot.
          notify({ phase: 'listening', transcript })
        }, cause => {
          if (!terminal && !stopRequested) {
            finish({ phase: 'error', transcript, error: errorMessage('Recording cue could not be played', cause) })
          }
        })
      } catch (cause) {
        finish({ phase: 'error', transcript, error: errorMessage('Recording cue could not be played', cause) })
      }
    } else if (cueFinished) {
      notify({ phase: 'listening', transcript })
    }
  }

  try {
    lease = acquireAudio(cancel)
    if (!lease.isCurrent() || terminal || pageHidden()) {
      cancel()
      return session
    }
    notify({ phase, transcript })
    if (terminal) return session
    if (!speechLocaleSchema.safeParse(locale).success) {
      throw new Error('Voice input supports only English (en-US) and Mandarin (zh-Hans).')
    }
    if (!speechCaptureSupported()) throw new Error('Browser speech recognition is not supported. Type your message instead.')
    const stopError = stopBrowserSpeech()
    if (stopError) throw new Error(stopError)
    if (terminal || !lease.isCurrent()) return session
    // Preserve the click's activation: prepare/resume audio before any await.
    cue = prepareRecordingCue()
    if (terminal || !lease.isCurrent()) return session
    capture = startSpeechCapture(receive, { locale })
    if (!terminal && stopRequested) capture.stop()
  } catch (cause) {
    if (terminal) addError(errorMessage('Voice input could not start', cause))
    else finish({ phase: 'error', transcript, error: errorMessage('Voice input could not start', cause) })
  } finally {
    initializing = false
    if (terminal) {
      lease?.release()
      cancelNative()
      closeCue()
      publishTerminal()
    }
  }
  return session
}

let replyId = 0

export function speakConversationReply(
  blocks: readonly AssistantBlock[],
  rate: SpeechRate,
): { cancel(): void; done: Promise<PlaybackOutcome> } {
  let lease: AudioLease | undefined
  let finished = false
  let playing = false
  let resolve!: (outcome: PlaybackOutcome) => void
  const done = new Promise<PlaybackOutcome>(complete => { resolve = complete })
  const finish = (outcome: PlaybackOutcome, stop = false) => {
    if (finished) return
    finished = true
    removePageListeners()
    lease?.release()
    if (stop && playing) {
      try {
        const error = stopBrowserSpeech()
        if (error) outcome = { status: 'error', error }
      } catch (cause) {
        outcome = { status: 'error', error: errorMessage('Speech playback could not be stopped', cause) }
      }
    }
    resolve(outcome)
  }
  const cancel = () => finish({ status: 'cancelled' }, true)
  const removePageListeners = onPageCancellation(cancel)
  const id = ++replyId
  try {
    lease = acquireAudio(cancel)
    if (finished || !lease.isCurrent() || pageHidden()) {
      cancel()
      lease.release()
      return { cancel, done }
    }
    const stopError = stopBrowserSpeech()
    if (stopError) throw new Error(stopError)
    if (finished || !lease.isCurrent()) return { cancel, done }
    const parsed = assistantReplySchema.safeParse({ blocks })
    if (!parsed.success || !speechRateSchema.safeParse(rate).success) {
      throw new Error('The tutor reply contains invalid speech blocks or an unsupported speech rate.')
    }
    const speech = parsed.data.blocks.filter(block => block.type === 'speech')
    if (!speech.length) throw new Error('The tutor reply has no locale-tagged speech blocks to play.')
    const play = async () => {
      for (const [index, block] of speech.entries()) {
        if (finished) return
        if (!lease!.isCurrent()) { cancel(); return }
        playing = true
        const outcome = await playBrowserSpeechToEnd(`conversation-reply-${id}-${index}`, block.text, block.locale, block.locale === 'en-US' ? 1 : rate)
        if (finished) return
        playing = false
        if (!lease!.isCurrent()) { cancel(); return }
        if (outcome.status !== 'completed') { finish(outcome); return }
      }
      finish({ status: 'completed' })
    }
    void play().catch(cause => {
      finish({ status: 'error', error: errorMessage('The tutor reply could not be spoken', cause) }, true)
    })
  } catch (cause) {
    finish({ status: 'error', error: errorMessage('The tutor reply could not be spoken', cause) }, true)
    lease?.release()
  }
  return { cancel, done }
}
