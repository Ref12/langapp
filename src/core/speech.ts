let activeUtterance: SpeechSynthesisUtterance | undefined

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
