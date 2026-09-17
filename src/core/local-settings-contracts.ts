import { z } from 'zod'
import { aiConnectionInputSchema } from './assistant/contracts'

export const LOCAL_SETTINGS_FILE = 'app.settings.jsonc'
export const LOCAL_SETTINGS_DIRECTORY = 'settings'
export const LOCAL_SETTINGS_PATH = '/__dev/app-settings'
export const LOCAL_SETTINGS_HEADER = 'x-linguaweave-local-settings'

export const localSettingsSchema = z.object({
  aiConnection: aiConnectionInputSchema.optional(),
}).strict()
