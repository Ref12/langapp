import type { SpeechVoicePreferences } from '../assistant/contracts'
import type { HandsfreeSettings } from './contracts'
import type { HandsfreeVoices } from './player'

/** The voice each kind of segment asks for: one English voice for everything English, and the Chinese voice. Unset ones follow the saved voice for their language (Settings > Voices). */
export function resolveVoices(settings: HandsfreeSettings, saved?: SpeechVoicePreferences): HandsfreeVoices {
  return { ...(settings.frameVoice ?? saved?.['en-US'] ? { frame: settings.frameVoice ?? saved!['en-US'] } : {}), ...(settings.zhVoice ? { zh: settings.zhVoice } : {}) }
}
