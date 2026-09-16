import type { SpeechLocale } from './contracts'

interface PlaybackState { activeId?: string; error?: string }
let state: PlaybackState = {}
let current: SpeechSynthesisUtterance | undefined
const listeners = new Set<() => void>()

function publish(next: PlaybackState) {
  state = next
  listeners.forEach(listener => listener())
}

export function subscribePlayback(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPlaybackState() { return state }

export function localVoiceMatches(voice: Pick<SpeechSynthesisVoice, 'lang' | 'localService'>, locale: SpeechLocale) {
  if (!voice.localService) return false
  const language = voice.lang.toLowerCase().replace(/_/g, '-')
  return locale === 'en-US'
    ? /^en(?:-|$)/.test(language)
    : /^(zh|zh-cn|zh-sg|zh-hans(?:-[a-z]+)?)$/.test(language)
}

export function stopLocalSpeech() {
  current = undefined
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  publish({})
}

export function playLocalSpeech(id: string, text: string, locale: SpeechLocale, rate = 1) {
  stopLocalSpeech()
  if (!text.trim() || text.length > 8000) {
    publish({ error: 'Choose a non-empty passage of at most 8,000 characters to hear.' })
    return
  }
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    publish({ error: 'Local speech playback is not available in this browser.' })
    return
  }
  const voice = window.speechSynthesis.getVoices().find(item => localVoiceMatches(item, locale))
  if (!voice) {
    publish({ error: `No installed local ${locale === 'zh-Hans' ? 'Mandarin' : 'English'} voice is available. Install an offline voice in your device settings, then try Hear again.` })
    return
  }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  utterance.rate = locale === 'en-US' ? 1 : rate
  utterance.onend = () => { if (current === utterance) { current = undefined; publish({}) } }
  utterance.onerror = () => {
    if (current !== utterance) return
    current = undefined
    publish({ error: 'Local speech could not be played. Try Hear again, or check your installed voices.' })
  }
  current = utterance
  publish({ activeId: id })
  try {
    window.speechSynthesis.speak(utterance)
  } catch {
    current = undefined
    publish({ error: 'The browser blocked local speech playback. Try Hear again after checking your voice settings.' })
  }
}
