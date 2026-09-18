import { MAX_DRAFT_LENGTH, speechLocaleSchema, type SpeechLocale } from './contracts'

export interface SpeechCaptureState {
  phase: 'starting' | 'listening' | 'stopping' | 'finished' | 'error'
  transcript: string
  error?: string
  cancelled?: boolean
}

export interface SpeechCaptureSession {
  stop(): void
  cancel(): void
}

interface RecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: { readonly transcript: string }
}

interface RecognitionEvent {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    readonly [index: number]: RecognitionResult
  }
}

interface BrowserRecognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserRecognition
    webkitSpeechRecognition?: new () => BrowserRecognition
  }
}

let activeCapture: SpeechCaptureSession | undefined

function recognitionConstructor() {
  if (typeof window === 'undefined') return undefined
  if (typeof window.SpeechRecognition === 'function') return window.SpeechRecognition
  if (typeof window.webkitSpeechRecognition === 'function') return window.webkitSpeechRecognition
  return undefined
}

export function speechCaptureSupported(): boolean {
  return recognitionConstructor() !== undefined
}

function nativeErrorMessage(error: string, locale: SpeechLocale): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone or speech recognition permission was denied. Check browser site permissions before trying again.'
    case 'no-speech':
      return 'No speech was recognized. Check your microphone and try again.'
    case 'network':
      return 'The browser speech service could not connect to the network. Check your connection and try again.'
    case 'audio-capture':
      return 'The browser could not capture microphone audio. Check that a microphone is available and not in use.'
    case 'language-not-supported':
    case 'language-unavailable':
      return `The browser speech service does not support ${locale === 'zh-Hans' ? 'Mandarin (zh-CN)' : 'English (en-US)'}. Try a browser that supports speech recognition in that language.`
    case 'aborted':
      return 'Speech capture was interrupted by the browser. Start again when ready.'
    default:
      return `Browser speech recognition failed${error ? `: ${error}` : ''}.`
  }
}

function exceptionMessage(action: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `The browser could not ${action} speech capture${detail ? `: ${detail}` : '.'}`
}

export function startSpeechCapture(
  listener: (state: SpeechCaptureState) => void,
  options: { locale?: SpeechLocale } = {},
): SpeechCaptureSession {
  const locale = options.locale === undefined ? 'zh-Hans' : options.locale
  let recognition: BrowserRecognition | undefined
  let phase: SpeechCaptureState['phase'] = 'starting'
  let transcript = ''
  let done = false
  let started = false
  let abortAttempted = false
  let nativeCallDepth = 0
  let completion: SpeechCaptureState | undefined
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let captureTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  const publishCompletion = () => {
    if (nativeCallDepth || !completion) return
    const state = completion
    completion = undefined
    listener(state)
  }

  const cleanup = () => {
    clearTimeout(startTimer)
    clearTimeout(captureTimer)
    clearTimeout(stopTimer)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityChanged)
      document.removeEventListener('keydown', keyDown, true)
    }
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', cancel)
    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
    }
    if (activeCapture === session) activeCapture = undefined
  }

  const abortRecognition = (error?: string) => {
    if (recognition && !abortAttempted) {
      abortAttempted = true
      try {
        recognition.abort()
      } catch (cause) {
        error = [error, exceptionMessage('abort', cause)].filter(Boolean).join(' ')
        // A failed abort must remain visible, even if stop can release the microphone.
        try {
          recognition.stop()
        } catch (stopCause) {
          error += ` ${exceptionMessage('stop', stopCause)}`
        }
      }
    }
    return error
  }

  const finish = (nextPhase: 'finished' | 'error', error?: string, abort = false, cancelled = false) => {
    if (done) return
    done = true
    cleanup()
    if (abort) error = abortRecognition(error)
    phase = error ? 'error' : nextPhase
    completion = { phase, transcript, ...(error ? { error } : {}), ...(cancelled ? { cancelled: true } : {}) }
    publishCompletion()
  }

  const invokeNative = (action: 'start' | 'stop') => {
    if (done || !recognition) return
    nativeCallDepth++
    try {
      recognition[action]()
    } catch (cause) {
      const error = exceptionMessage(action, cause)
      if (done) {
        // Native APIs may synchronously dispatch end/error and then throw.
        completion = { ...completion, phase: 'error', transcript, error: abortRecognition([completion?.error, error].filter(Boolean).join(' ')) }
      } else {
        finish('error', error, true)
      }
    } finally {
      nativeCallDepth--
      publishCompletion()
    }
  }

  const stop = () => {
    if (done || phase === 'stopping') return
    phase = 'stopping'
    clearTimeout(startTimer)
    clearTimeout(captureTimer)
    stopTimer = setTimeout(() => {
      finish('error', 'Speech capture did not finish after Stop. Capture was cancelled; review the available transcript before trying again.', true)
    }, 5000)
    listener({ phase, transcript })
    invokeNative('stop')
  }

  const cancel = () => finish('finished', undefined, true, true)
  const visibilityChanged = () => {
    if (document.visibilityState === 'hidden') cancel()
  }
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancel()
  }
  const session: SpeechCaptureSession = { stop, cancel }
  const previous = activeCapture
  activeCapture = session
  previous?.cancel()
  if (done) return session

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', visibilityChanged)
    document.addEventListener('keydown', keyDown, true)
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', cancel)
  listener({ phase, transcript })
  if (done) return session
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    cancel()
    return session
  }

  if (!speechLocaleSchema.safeParse(locale).success) {
    finish('error', 'Speech capture supports only English (en-US) and Mandarin (zh-Hans). Choose a supported input language.')
    return session
  }
  const Recognition = recognitionConstructor()
  if (!Recognition) {
    finish('error', 'Speech capture is not supported by this browser. Type instead, choose listen-and-repeat, or use a browser with speech recognition.')
    return session
  }

  nativeCallDepth++
  try {
    recognition = new Recognition()
    if (done) {
      // Cancellation can occur while a browser constructor is still running.
      cleanup()
      const error = abortRecognition(completion?.error)
      if (error) completion = { ...completion, phase: 'error', transcript, error }
      return session
    }
    recognition.lang = locale === 'zh-Hans' ? 'zh-CN' : 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1
    if (done) return session
    recognition.onstart = () => {
      if (done || started) return
      started = true
      clearTimeout(startTimer)
      if (phase === 'stopping') {
        // Some browsers ignore stop while their permission prompt is pending.
        invokeNative('stop')
        return
      }
      phase = 'listening'
      captureTimer = setTimeout(stop, 60_000)
      listener({ phase, transcript })
    }
    recognition.onresult = event => {
      if (done) return
      // results is the complete current snapshot; resultIndex is not an append offset.
      // Rebuilding also removes retracted interim results without duplicating final text.
      let nextTranscript = ''
      for (let index = 0; index < event.results.length; index++) {
        const text = event.results[index][0]?.transcript.trim() ?? ''
        if (!text) continue
        const separator = nextTranscript ? ' ' : ''
        if (nextTranscript.length + separator.length + text.length > MAX_DRAFT_LENGTH) {
          finish('error', `The speech transcript exceeds the ${MAX_DRAFT_LENGTH}-character limit. Capture was cancelled; shorten the attempt and try again.`, true)
          return
        }
        nextTranscript += separator + text
      }
      transcript = nextTranscript
      listener({ phase, transcript })
    }
    recognition.onerror = event => {
      if (!done) finish('error', nativeErrorMessage(event.error, locale), true)
    }
    recognition.onend = () => {
      if (done) return
      if (!started && phase !== 'stopping') {
        finish('error', 'Speech capture ended before listening started. Check microphone permissions and try again.')
      } else if (!transcript && phase !== 'stopping') {
        finish('error', nativeErrorMessage('no-speech', locale))
      } else {
        finish('finished')
      }
    }
    startTimer = setTimeout(() => {
      finish('error', 'Speech capture did not start within 10 seconds. Check microphone permissions and try again.', true)
    }, 10_000)
  } catch (cause) {
    const error = exceptionMessage('prepare', cause)
    if (done) {
      completion = { ...completion, phase: 'error', transcript, error: abortRecognition([completion?.error, error].filter(Boolean).join(' ')) }
    } else {
      finish('error', error, true)
    }
    return session
  } finally {
    nativeCallDepth--
    publishCompletion()
  }
  invokeNative('start')
  return session
}
