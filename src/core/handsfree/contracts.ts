import { z } from 'zod'
import { browserVoicePreferenceSchema, edgeVoicePreferenceSchema } from '../assistant/contracts'

const speechVoicePreferenceSchema = z.union([browserVoicePreferenceSchema, edgeVoicePreferenceSchema])

// Hands-free runs: a listen-and-answer audio program over a fixed list of study items (docs/programs.md).
// A run is stored in the local database (handsfreeRuns) and carried in backups.

export const PAUSE_LENGTHS = ['short', 'normal', 'long'] as const
/** The wording around each item: the full frame with an example, a one-word frame, or the bare gloss. */
export const ITEM_WORDINGS = ['full', 'abridged', 'off'] as const
/** The section introductions: a short header and a description, the header alone, or nothing. */
export const SECTION_INTROS = ['full', 'header', 'off'] as const
/** How the English word is stressed: by the pauses around it inside one utterance, or as its own slower, louder utterance. */
export const EMPHASIS_MODES = ['pauses', 'loud'] as const
const baseSettingsSchema = z.object({
  pause: z.enum(PAUSE_LENGTHS),
  /** Whole-phrase repeat-afters of each word and sentence, the first one included. */
  repeats: z.number().int().min(1).max(5),
  /** "This is how you say, rest. As in, let's rest. In Mandarin." (full, the default), "English, rest. Mandarin." (abridged) or just "rest" (off). */
  itemWording: z.enum(ITEM_WORDINGS).optional(),
  /** The start of each section: header and description (full, the default), the header only, or nothing. */
  sectionIntros: z.enum(SECTION_INTROS).optional(),
  /** Pauses only (default): one English utterance per frame. Loud: the English word is its own utterance, slower and louder (adds a short start-up delay). */
  emphasis: z.enum(EMPHASIS_MODES).optional(),
  /** English voice for the frame and the gloss; unset follows the English voice in Settings. */
  frameVoice: speechVoicePreferenceSchema.optional(),
  /** The speed of the English word when emphasis is Slower and louder. */
  emphasisRate: z.number().min(0.5).max(1.25).optional(),
  /** Chinese voice and speed; unset follows the Mandarin voice in Settings and the default speed. */
  zhVoice: speechVoicePreferenceSchema.optional(),
  zhRate: z.number().min(0.5).max(1.25).optional(),
}).strict()
/** Saved settings from before: the explain and introductions switches become Full (on) or Off, the grammar switch and the emphasis voice are dropped. */
function migrateSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const { explain, introductions, ...rest } = raw as Record<string, unknown>
  delete rest.grammar
  delete rest.emphasisVoice
  return { ...rest,
    ...(rest.itemWording === undefined && typeof explain === 'boolean' ? { itemWording: explain ? 'full' : 'off' } : {}),
    ...(rest.sectionIntros === undefined && typeof introductions === 'boolean' ? { sectionIntros: introductions ? 'full' : 'off' } : {}) }
}
export const handsfreeSettingsSchema = z.preprocess(migrateSettings, baseSettingsSchema)
export type HandsfreeSettings = z.infer<typeof baseSettingsSchema>
/** Settings as stored (possibly from before the switches became three-way), with the three wording choices filled in. */
export function normalizeHandsfreeSettings(raw: HandsfreeSettings): HandsfreeSettings & Required<Pick<HandsfreeSettings, 'itemWording' | 'sectionIntros' | 'emphasis'>> {
  const settings = migrateSettings(raw) as HandsfreeSettings
  return { ...settings, itemWording: settings.itemWording ?? 'full', sectionIntros: settings.sectionIntros ?? 'full', emphasis: settings.emphasis ?? 'pauses' }
}
export const DEFAULT_HANDSFREE_SETTINGS: HandsfreeSettings = { pause: 'normal', repeats: 3, itemWording: 'full', sectionIntros: 'full', emphasis: 'pauses', emphasisRate: 0.8, zhRate: 0.5 }
export const DEFAULT_EMPHASIS_RATE = 0.8
/** Half speed: the whole phrase, the build-up and the repeats all use the Chinese speed setting itself. */
export const DEFAULT_ZH_RATE = 0.5
/** The English frame's volume when the key word is its own, louder utterance (the word itself is at 1). */
export const FRAME_VOLUME = 0.8

export const handsfreeRunSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  refs: z.array(z.string().min(1).max(200)).min(1).max(200),
  /** Where the items came from, as for practice sets. */
  source: z.enum(['new', 'review', 'study-set', 'lesson', 'drill', 'handsfree']),
  originId: z.string().max(100).optional(),
  /** Fixes the scrambled order, so a resumed or replayed run is the same run. */
  seed: z.number().int().min(0).max(2 ** 31),
  settings: handsfreeSettingsSchema,
  status: z.enum(['active', 'completed', 'abandoned']),
  /** True once Play was pressed; a run that was only opened is not shown in History. */
  started: z.boolean(),
  /** Index of the prompt to resume at. */
  position: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  /** Items that join the knowledge set when the run is completed (a New items run's own items). */
  addOnComplete: z.array(z.string().min(1).max(200)).max(200).optional(),
  /** Study-set item ids to promote into the knowledge set on completion, as a lesson does. */
  promote: z.array(z.string().min(1).max(200)).max(200).optional(),
  /** Practice-count pairs ("ref|skill") this run has already counted, so a replay adds nothing. */
  practiced: z.array(z.string().max(220)).max(500).optional(),
  /** True once the user set an unfinished run aside from Practice home. */
  discarded: z.boolean().optional(),
  /** Set once, when completion added items; a replayed run never adds them again. */
  addedRefs: z.array(z.string().min(1).max(200)).max(200).optional(),
}).strict()
export type HandsfreeRun = z.infer<typeof handsfreeRunSchema>
export const handsfreeRunsBackupSchema = z.array(handsfreeRunSchema).max(2000)
