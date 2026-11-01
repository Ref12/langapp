import { z } from 'zod'

// Hands-free runs: a listen-and-answer audio program over a fixed list of study items (docs/programs.md).
// A run is stored in the local database (handsfreeRuns) and carried in backups.

export const PAUSE_LENGTHS = ['short', 'normal', 'long'] as const
export const handsfreeSettingsSchema = z.object({
  pause: z.enum(PAUSE_LENGTHS),
  repeats: z.number().int().min(1).max(3),
  grammar: z.boolean(),
}).strict()
export type HandsfreeSettings = z.infer<typeof handsfreeSettingsSchema>
export const DEFAULT_HANDSFREE_SETTINGS: HandsfreeSettings = { pause: 'normal', repeats: 1, grammar: true }

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
}).strict()
export type HandsfreeRun = z.infer<typeof handsfreeRunSchema>
export const handsfreeRunsBackupSchema = z.array(handsfreeRunSchema).max(2000)
