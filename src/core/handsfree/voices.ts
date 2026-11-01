import type { SpeechVoicePreference, SpeechVoicePreferences } from '../assistant/contracts'
import { browserVoiceKey, browserVoiceMatches, preferredVoice, speechVoiceKey } from '../assistant/speech'
import type { HandsfreeSettings } from './contracts'
import type { HandsfreeVoices } from './player'

const toPreference = (voice: SpeechSynthesisVoice): SpeechVoicePreference => ({ voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang, localService: voice.localService })

/**
 * The English voice for the key word when none is chosen: an English voice other than the one the frame uses, where the device has one.
 * Returns undefined when there is only one English voice, so the key word then differs only by its slower speed.
 */
export function differentEnglishVoice(frame: SpeechVoicePreference | undefined, voices: readonly SpeechSynthesisVoice[]): SpeechVoicePreference | undefined {
  const english = [...voices].filter(voice => browserVoiceMatches(voice, 'en-US'))
  const automatic = frame ?? (() => { const found = preferredVoice(english, 'en-US', 'local') ?? preferredVoice(english, 'en-US', 'online'); return found ? toPreference(found) : undefined })()
  const taken = automatic ? speechVoiceKey(automatic) : undefined
  const sorted = english.sort((left, right) => Number(right.localService) - Number(left.localService) || Number(right.lang === 'en-US') - Number(left.lang === 'en-US') || left.name.localeCompare(right.name))
  const other = sorted.find(voice => browserVoiceKey(voice) !== taken)
  return other ? toPreference(other) : undefined
}

/** The voice each kind of segment asks for. Unset ones follow the saved voice for their language (Settings > Voices). */
export function resolveVoices(settings: HandsfreeSettings, saved: SpeechVoicePreferences | undefined, browserVoices: readonly SpeechSynthesisVoice[]): HandsfreeVoices {
  const frame = settings.frameVoice ?? saved?.['en-US']
  const emphasis = settings.emphasisVoice ?? differentEnglishVoice(frame, browserVoices)
  return { ...(settings.frameVoice ? { frame: settings.frameVoice } : {}), ...(emphasis ? { emphasis } : {}), ...(settings.zhVoice ? { zh: settings.zhVoice } : {}) }
}
