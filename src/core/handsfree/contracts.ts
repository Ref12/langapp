import { z } from 'zod'
import { browserVoicePreferenceSchema, edgeVoicePreferenceSchema } from '../assistant/contracts'

const speechVoicePreferenceSchema = z.union([browserVoicePreferenceSchema, edgeVoicePreferenceSchema])

// Hands-free runs: a listen-and-answer audio program over a fixed list of study items (docs/programs.md).
// A run is stored in the local database (handsfreeRuns) and carried in backups.

export const PAUSE_LENGTHS = ['short', 'normal', 'long'] as const
export const handsfreeSettingsSchema = z.object({
  pause: z.enum(PAUSE_LENGTHS),
  /** Whole-phrase repeat-afters of each word and sentence, the first one included. */
  repeats: z.number().int().min(1).max(5),
  grammar: z.boolean(),
  /** A short spoken description at the start of each section (default on; a run saved without it gets them). */
  introductions: z.boolean().optional(),
  /** The wording around each item, "This is how you say ... in Mandarin" and "How do you say ...?" (default on). Off leaves just the gloss. */
  explain: z.boolean().optional(),
  /** English voice for the frame ("This is how you say"); unset follows the English voice in Settings. */
  frameVoice: speechVoicePreferenceSchema.optional(),
  /** English voice for the key word (the gloss) and explanations; unset picks an English voice other than the frame voice, where there is one. */
  emphasisVoice: speechVoicePreferenceSchema.optional(),
  emphasisRate: z.number().min(0.5).max(1.25).optional(),
  /** Chinese voice and speed; unset follows the Mandarin voice in Settings and the default speed. */
  zhVoice: speechVoicePreferenceSchema.optional(),
  zhRate: z.number().min(0.5).max(1.25).optional(),
}).strict()
export type HandsfreeSettings = z.infer<typeof handsfreeSettingsSchema>
export const DEFAULT_HANDSFREE_SETTINGS: HandsfreeSettings = { pause: 'normal', repeats: 3, grammar: true, introductions: true, explain: true, emphasisRate: 0.8, zhRate: 0.5 }
export const DEFAULT_EMPHASIS_RATE = 0.8
/** Half speed: the whole phrase, the build-up and the repeats all use the Chinese speed setting itself. */
export const DEFAULT_ZH_RATE = 0.5

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
  /** True once the user set an unfinished run aside from Practice home. */
  discarded: z.boolean().optional(),
  /** Set once, when completion added items; a replayed run never adds them again. */
  addedRefs: z.array(z.string().min(1).max(200)).max(200).optional(),
}).strict()
export type HandsfreeRun = z.infer<typeof handsfreeRunSchema>
export const handsfreeRunsBackupSchema = z.array(handsfreeRunSchema).max(2000)
