import { speechVoicePreferencesSchema, type BrowserVoicePreference, type SpeechLocale, type SpeechVoicePreferences } from './contracts'

interface PlaybackState {
  activeId?: string
  phase?: 'loading-voices' | 'starting' | 'speaking'
  voiceKind?: 'local' | 'online'
  error?: string
}
interface PlaybackRequest {
  id: string
  locale: SpeechLocale
  synthesis: SpeechSynthesis
  utterance?: SpeechSynthesisUtterance
  clearDiscovery?: () => void
  playbackTimer?: ReturnType<typeof setTimeout>
  onFinished?: (result: SpeechResult) => void
}

export type SpeechResult = { kind: 'ended' | 'cancelled' } | { kind: 'error'; message: string }

const voiceWaitMs = 3000
const voiceRecheckMs = 100
const playbackStartWaitMs = 10_000
let state: PlaybackState = {}
let current: PlaybackRequest | undefined
let generation = 0
const listeners = new Set<() => void>()
const interruptionListeners = new Set<(nextId?: string) => void>()
let voiceCache = new WeakMap<SpeechSynthesis, Map<SpeechLocale, string>>()
let voicePreferences: SpeechVoicePreferences = {}

export interface BrowserVoiceState {
  voices: SpeechSynthesisVoice[]
  loading: boolean
  error?: string
}

export function browserVoiceKey(voice: BrowserVoicePreference) {
  return JSON.stringify([voice.voiceURI, voice.name, voice.lang, voice.localService])
}

export function clearVoiceCache() {
  voiceCache = new WeakMap()
}

export function setSpeechVoicePreferences(preferences: SpeechVoicePreferences = {}) {
  const next = speechVoicePreferencesSchema.parse(preferences)
  const changed = speechVoicePreferencesSchema.keyof().options.some(locale => {
    const previousVoice = voicePreferences[locale]
    const nextVoice = next[locale]
    return (previousVoice && browserVoiceKey(previousVoice)) !== (nextVoice && browserVoiceKey(nextVoice))
  })
  if (!changed) return
  voicePreferences = next
  clearVoiceCache()
  stopBrowserSpeech()
}

function publish(next: PlaybackState) {
  state = next
  listeners.forEach(listener => listener())
}

export function subscribePlayback(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPlaybackState() { return state }

// Also notifies between utterances, while a guided response timer owns no speech.
export function subscribeSpeechInterruption(listener: (nextId?: string) => void) {
  interruptionListeners.add(listener)
  return () => { interruptionListeners.delete(listener) }
}

function voiceLocale(language: string) {
  const normalized = language.trim().replace(/_/g, '-').toLowerCase()
  try {
    return {
      tag: new Intl.Locale(normalized.replace(/^zh-cmn(?=-|$)/, 'cmn')),
      explicitMandarin: /^(?:cmn|zh-cmn)(?:-|$)/.test(normalized),
    }
  } catch {
    // A malformed browser voice tag cannot establish a safe language match.
    return undefined
  }
}

function languageMatches(language: string, locale: SpeechLocale) {
  const parsed = voiceLocale(language)
  if (!parsed) return false
  if (locale === 'en-US') return parsed.tag.language === 'en'
  if (locale !== 'zh-Hans' || !['zh', 'cmn'].includes(parsed.tag.language)) return false
  // Mandarin is not script-exclusive; unqualified HK/MO Chinese may be Cantonese.
  return parsed.explicitMandarin || !parsed.tag.region || ['CN', 'SG', 'TW'].includes(parsed.tag.region)
}

export function localVoiceMatches(voice: Pick<SpeechSynthesisVoice, 'lang' | 'localService'>, locale: SpeechLocale) {
  return voice.localService === true && languageMatches(voice.lang, locale)
}

export function browserVoiceMatches(voice: Pick<SpeechSynthesisVoice, 'lang' | 'localService'>, locale: SpeechLocale) {
  return typeof voice.localService === 'boolean' && languageMatches(voice.lang, locale)
}

export function watchBrowserVoices(listener: (state: BrowserVoiceState) => void): () => void {
  const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synthesis) {
    listener({ voices: [], loading: false, error: 'Speech playback is not available in this browser.' })
    return () => {}
  }
  let closed = false
  let loading = true
  let lastSnapshot: string | undefined
  const canListen = typeof synthesis.addEventListener === 'function' && typeof synthesis.removeEventListener === 'function'
  const dispose = () => {
    closed = true
    clearInterval(recheck)
    clearTimeout(timeout)
    if (canListen) synthesis.removeEventListener('voiceschanged', read)
  }
  const read = () => {
    if (closed) return
    let voices: SpeechSynthesisVoice[]
    try {
      voices = synthesis.getVoices()
    } catch {
      dispose()
      listener({ voices: [], loading: false, error: 'The browser could not list speech voices. Check your browser speech settings, then refresh the voice list.' })
      return
    }
    const snapshot = JSON.stringify([loading, voices.map(browserVoiceKey)])
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot
      listener({ voices, loading })
    }
  }
  const recheck = setInterval(read, voiceRecheckMs)
  const timeout = setTimeout(() => {
    loading = false
    clearInterval(recheck)
    read()
  }, voiceWaitMs)
  if (canListen) {
    try {
      synthesis.addEventListener('voiceschanged', read)
    } catch {
      dispose()
      listener({ voices: [], loading: false, error: 'The browser could not watch for speech voices. Refresh the voice list to try again.' })
      return dispose
    }
  }
  read()
  return dispose
}

function preferredVoice(voices: SpeechSynthesisVoice[], locale: SpeechLocale, voiceKind: 'local' | 'online') {
  const preference = (voice: SpeechSynthesisVoice) => {
    const tag = voiceLocale(voice.lang)!.tag
    if (tag.baseName === locale) return 0
    if (locale === 'en-US') return tag.region === 'US' ? 1 : 2
    if (tag.script === 'Hans') return 1
    if (tag.region === 'CN') return 2
    if (tag.region === 'SG') return 3
    if (!tag.region && tag.script !== 'Hant') return 4
    return 5
  }
  return voices.filter(voice => voice.localService === (voiceKind === 'local') && languageMatches(voice.lang, locale))
    .sort((left, right) => preference(left) - preference(right))[0]
}

function clearRequest(request: PlaybackRequest) {
  request.clearDiscovery?.()
  clearTimeout(request.playbackTimer)
  if (request.utterance) {
    request.utterance.onstart = null
    request.utterance.onend = null
    request.utterance.onerror = null
  }
}

function cancelSynthesis(synthesis: SpeechSynthesis | undefined) {
  try {
    synthesis?.cancel()
  } catch {
    return 'The browser could not stop speech playback. Try Stop again or close this page.'
  }
}

function cancelCurrent() {
  const request = current
  current = undefined
  if (request) clearRequest(request)
  const error = cancelSynthesis(request?.synthesis ?? (typeof window !== 'undefined' ? window.speechSynthesis : undefined))
  request?.onFinished?.(error ? { kind: 'error', message: error } : { kind: 'cancelled' })
  return error
}

export function stopBrowserSpeech() {
  interruptionListeners.forEach(listener => listener())
  const version = ++generation
  const error = cancelCurrent()
  if (version === generation) publish(error ? { error } : {})
}

function fail(request: PlaybackRequest, error: string) {
  if (current !== request) return
  voiceCache.get(request.synthesis)?.delete(request.locale)
  const version = generation
  current = undefined
  clearRequest(request)
  const cancelError = cancelSynthesis(request.synthesis)
  const message = cancelError ? `${error} ${cancelError}` : error
  if (version === generation) publish({ error: message })
  request.onFinished?.({ kind: 'error', message })
}

function missingVoiceMessage(voices: SpeechSynthesisVoice[], locale: SpeechLocale) {
  const language = locale === 'zh-Hans' ? 'Mandarin' : 'English'
  if (!voices.length) {
    return 'The browser has not exposed any speech voices yet. Try Hear again, or check your browser speech settings.'
  }
  return `The browser has not exposed a matching ${language} voice, either local or online. Try Hear again, or check your browser speech settings.`
}

function startSpeaking(request: PlaybackRequest, voice: SpeechSynthesisVoice, text: string, locale: SpeechLocale, rate: number) {
  if (current !== request) return
  request.clearDiscovery?.()
  let utterance: SpeechSynthesisUtterance
  try {
    utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = voiceLocale(voice.lang)!.tag.toString()
    utterance.rate = locale === 'en-US' || !Number.isFinite(rate) ? 1 : Math.max(0.1, Math.min(10, rate))
  } catch {
    fail(request, 'The browser could not prepare speech playback. Try Hear again.')
    return
  }
  request.utterance = utterance
  const voiceKind = voice.localService === true ? 'local' : 'online'
  utterance.onstart = () => {
    if (current !== request) return
    clearTimeout(request.playbackTimer)
    // Allow slow, long passages, but do not leave playback active forever if onend is lost.
    request.playbackTimer = setTimeout(() => {
      fail(request, 'Browser speech playback timed out. Try Hear again with a shorter passage.')
    }, Math.max(30_000, text.length * 2000 / utterance.rate + 15_000))
    publish({ activeId: request.id, phase: 'speaking', voiceKind })
  }
  utterance.onend = () => {
    if (current !== request) return
    current = undefined
    clearRequest(request)
    publish({})
    request.onFinished?.({ kind: 'ended' })
  }
  utterance.onerror = () => {
    fail(request, voiceKind === 'online'
      ? 'Online browser speech could not be played. Check your network connection and browser speech settings, then try Hear again.'
      : 'Local browser speech could not be played. Try Hear again, or check your browser speech settings.')
  }
  request.playbackTimer = setTimeout(() => {
    fail(request, 'The browser did not start speech in time. Try Hear again.')
  }, playbackStartWaitMs)
  publish({ activeId: request.id, phase: 'starting', voiceKind })
  if (current !== request) return
  try {
    request.synthesis.speak(utterance)
  } catch {
    fail(request, 'The browser blocked speech playback. Try Hear again after checking your voice settings.')
  }
}

export function playBrowserSpeech(id: string, text: string, locale: SpeechLocale, rate = 1,
  onFinished?: (result: SpeechResult) => void) {
  interruptionListeners.forEach(listener => listener(id))
  const version = ++generation
  const cancelError = cancelCurrent()
  if (version !== generation) {
    onFinished?.({ kind: 'cancelled' })
    return
  }
  if (cancelError) {
    publish({ error: cancelError })
    onFinished?.({ kind: 'error', message: cancelError })
    return
  }
  if (!text.trim() || text.length > 8000) {
    const message = 'Choose a non-empty passage of at most 8,000 characters to hear.'
    publish({ error: message })
    onFinished?.({ kind: 'error', message })
    return
  }
  const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    const message = 'Speech playback is not available in this browser.'
    publish({ error: message })
    onFinished?.({ kind: 'error', message })
    return
  }
  const request: PlaybackRequest = { id, locale, synthesis, onFinished }
  current = request
  const deadline = performance.now() + voiceWaitMs
  let expired = false
  const discover = () => {
    if (current !== request || request.utterance) return
    let voices: SpeechSynthesisVoice[]
    try {
      voices = synthesis.getVoices()
    } catch {
      fail(request, 'The browser could not list speech voices. Try Hear again, or check your browser speech settings.')
      return
    }
    if (current !== request) return
    const finishedWaiting = expired || performance.now() >= deadline
    const selected = voicePreferences[locale]
    const cachedKey = voiceCache.get(synthesis)?.get(locale)
    const cached = voices.find(voice => browserVoiceMatches(voice, locale) && browserVoiceKey(voice) === cachedKey)
    if (!cached) voiceCache.get(synthesis)?.delete(locale)
    const voice = selected
      ? voices.find(voice => browserVoiceMatches(voice, locale) && browserVoiceKey(voice) === browserVoiceKey(selected))
      : preferredVoice(voices, locale, 'local') ?? cached
        ?? (finishedWaiting ? preferredVoice(voices, locale, 'online') : undefined)
    if (voice) {
      // Cache identifiers, not native objects: revalidate against the current browser list on every Hear.
      const cache = voiceCache.get(synthesis) ?? new Map<SpeechLocale, string>()
      cache.set(locale, browserVoiceKey(voice))
      voiceCache.set(synthesis, cache)
      startSpeaking(request, voice, text, locale, rate)
    } else if (finishedWaiting) {
      fail(request, selected
        ? `The selected ${locale === 'zh-Hans' ? 'Mandarin' : 'English'} voice is not available. Choose another voice or Automatic in Settings.`
        : missingVoiceMessage(voices, locale))
    }
  }
  // Allow partial local lists to settle before online fallback; some browsers miss voiceschanged.
  const recheck = setInterval(discover, voiceRecheckMs)
  const timeout = setTimeout(() => { expired = true; discover() }, voiceWaitMs)
  const canListen = typeof synthesis.addEventListener === 'function' && typeof synthesis.removeEventListener === 'function'
  request.clearDiscovery = () => {
    clearInterval(recheck)
    clearTimeout(timeout)
    if (canListen) synthesis.removeEventListener('voiceschanged', discover)
    request.clearDiscovery = undefined
  }
  if (canListen) {
    try {
      synthesis.addEventListener('voiceschanged', discover)
    } catch {
      fail(request, 'The browser could not watch for speech voices. Try Hear again, or check your browser speech settings.')
      return
    }
  }
  publish({ activeId: id, phase: 'loading-voices' })
  discover()
}
