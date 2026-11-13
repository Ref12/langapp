import { z } from 'zod'

const tone = z.number().int().min(1).max(5)
export const trainerAnswerSchema = z.object({
  stage: z.union([z.literal(1), z.literal(2), z.literal(3)]), item: z.string().min(1).max(80), voice: z.string().min(1).max(40),
  heard: z.array(tone).min(1).max(2), chosen: z.array(tone).min(1).max(2), correct: z.boolean(), at: z.number().int().nonnegative(),
}).strict()
/** The one row of tone trainer progress a profile keeps (backed up with the profile). */
export const trainerProgressSchema = z.object({
  id: z.literal('progress'),
  answers: z.array(trainerAnswerSchema).max(300),
  confusion: z.record(z.string().regex(/^[1-5]$/), z.record(z.string().regex(/^[1-5]$/), z.number().int().nonnegative())),
  voices: z.record(z.string().max(40), z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])),
  stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
}).strict()
export const toneTrainerBackupSchema = z.array(trainerProgressSchema).max(1)
