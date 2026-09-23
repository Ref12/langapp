import { z } from 'zod'
import { aiConnectionInputSchema, speechRateSchema, speechVoicePreferencesSchema } from './assistant/contracts'
import { speechConnectionInputSchema } from './assistant/speech-contracts'

export const LOCAL_SETTINGS_FILE = 'default.yaml'
export const LOCAL_SETTINGS_DIRECTORY = 'data'
export const LOCAL_SETTINGS_PATH = '/__dev/app-settings'
export const LOCAL_SETTINGS_HEADER = 'x-linguaweave-local-settings'

export const localSettingsSchema = z.object({
  aiConnection: aiConnectionInputSchema.optional(),
  speechConnection: speechConnectionInputSchema.optional(),
  defaultSpeechRate: speechRateSchema.optional(),
  speechVoices: speechVoicePreferencesSchema.optional(),
}).strict()
