import type { SpeechLocale, SpeechSegment } from './voice/contracts'

let activeUtterance: SpeechSynthesisUtterance | undefined
let cancelQueue: (() => void) | undefined

export type PlaybackPreferences = Partial<Record<SpeechLocale, { voiceURI?: string; rate: number }>>
export interface PlaybackService {
  play(segments: SpeechSegment[], signal: AbortSignal, preferences?: PlaybackPreferences): Promise<void>
  stop(): void
}

export function stopSpeech(): void {
  cancelQueue?.()
  if (activeUtterance) {
    activeUtterance.onstart = null
    activeUtterance.onend = null
    activeUtterance.onerror = null
    activeUtterance = undefined
  }
  if (canReadAloud()) window.speechSynthesis.cancel()
}

export function playSpeechSegments(
  segments: SpeechSegment[],
  signal: AbortSignal,
  preferences: PlaybackPreferences = {},
): Promise<void> {
  stopSpeech()
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Playback stopped.', 'AbortError')); return }
    if (!canReadAloud()) { reject(new Error('Speech synthesis is unavailable. Your reply is still readable.')); return }
    const synthesis = window.speechSynthesis
    let index = 0
    let done = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (cancelQueue === abort) cancelQueue = undefined
      if (activeUtterance) {
        activeUtterance.onstart = activeUtterance.onend = activeUtterance.onerror = null
        activeUtterance = undefined
      }
      if (error) synthesis.cancel()
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new DOMException('Playback stopped.', 'AbortError'))
    cancelQueue = abort
    signal.addEventListener('abort', abort, { once: true })
    const next = () => {
      if (done || signal.aborted) return
      const segment = segments[index++]
      if (!segment) { finish(); return }
      const voices = synthesis.getVoices()
      const preference = preferences[segment.locale]
      const matching = voices.filter(voice => voice.lang.toLowerCase().split('-')[0] === segment.locale.split('-')[0])
      const voice = matching.find(voice => voice.voiceURI === preference?.voiceURI) ??
        matchingSpeechVoice(matching, segment.locale)
      if (!voice) { finish(new Error(`No ${segment.locale} voice is available. Install a system voice, then tap Play reply.`)); return }
      const utterance = new SpeechSynthesisUtterance(segment.text)
      utterance.lang = segment.locale
      utterance.voice = voice
      utterance.rate = Math.max(0.25, Math.min(1.25, preference?.rate ?? 0.9))
      activeUtterance = utterance
      timer = setTimeout(() => finish(new Error('Playback did not start. Tap Play reply to try again.')), 5000)
      utterance.onstart = () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(new Error('Playback stalled. Tap Play reply to try again.')), 120_000)
      }
      utterance.onend = () => { clearTimeout(timer); next() }
      utterance.onerror = event => finish(new Error(speechErrorMessage(event.error, segment.locale)))
      if (synthesis.paused) synthesis.resume()
      try { synthesis.speak(utterance) } catch { finish(new Error('Playback was blocked. Tap Play reply to try again.')) }
    }
    next()
  })
}

export const browserPlayback: PlaybackService = { play: playSpeechSegments, stop: stopSpeech }

export interface SpeechPlaybackHandlers {
  onStart?: (voiceName: string) => void
  onEnd?: (voiceName: string) => void
  onError?: (message: string) => void
}

export function canReadAloud(): boolean {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function matchingSpeechVoice(
  voices: SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice | undefined {
  const normalized = language.toLocaleLowerCase()
  const prefix = normalized.split('-')[0]
  return (
    voices.find((voice) => voice.lang.toLocaleLowerCase() === normalized) ??
    voices.find((voice) =>
      voice.lang.toLocaleLowerCase().startsWith(`${prefix}-`),
    )
  )
}

export function availableSpeechVoice(language: string): string {
  if (!canReadAloud()) return ''
  return (
    matchingSpeechVoice(window.speechSynthesis.getVoices(), language)?.name ??
    ''
  )
}

export function watchSpeechVoices(
  language: string,
  onChange: (voiceName: string) => void,
): () => void {
  if (!canReadAloud()) return () => undefined
  const synthesis = window.speechSynthesis
  const update = () => onChange(availableSpeechVoice(language))
  update()
  synthesis.addEventListener('voiceschanged', update)
  return () => synthesis.removeEventListener('voiceschanged', update)
}

function speechErrorMessage(error: string, language: string): string {
  if (error === 'language-unavailable' || error === 'voice-unavailable') {
    return `No ${language} voice is available. On Android, install or enable this language under Settings > Text-to-speech output > Speech Services by Google.`
  }
  if (error === 'not-allowed') {
    return 'Speech was blocked by the browser. Tap Read aloud again and check site sound permissions.'
  }
  if (error === 'canceled' || error === 'interrupted') {
    return 'Speech playback was interrupted.'
  }
  return error ? `Speech playback failed: ${error}.` : 'Speech playback failed.'
}

export function readAloud(
  text: string,
  language: string,
  rate: number,
  handlers: SpeechPlaybackHandlers = {},
): string {
  if (!canReadAloud()) {
    throw new Error('Read aloud is not supported by this browser.')
  }

  const synthesis = window.speechSynthesis
  const voice = matchingSpeechVoice(synthesis.getVoices(), language)
  const voiceName = voice?.name ?? `Android/system ${language} voice`

  cancelQueue?.()
  if (activeUtterance) {
    activeUtterance.onstart = null
    activeUtterance.onend = null
    activeUtterance.onerror = null
  }
  if (synthesis.speaking || synthesis.pending) synthesis.cancel()
  if (synthesis.paused) synthesis.resume()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language
  if (voice) utterance.voice = voice
  utterance.rate = Math.max(0.25, Math.min(1, rate))
  utterance.volume = 1
  activeUtterance = utterance

  utterance.onstart = () => handlers.onStart?.(voiceName)
  utterance.onend = () => {
    activeUtterance = undefined
    handlers.onEnd?.(voiceName)
  }
  utterance.onerror = (event) => {
    activeUtterance = undefined
    handlers.onError?.(speechErrorMessage(event.error, language))
  }

  // This must happen synchronously inside the user's tap handler on Android.
  synthesis.speak(utterance)
  return voiceName
}
