import { z } from 'zod'

export const characterSchema = z.string().refine(
  value => Array.from(value).length === 1 && /\p{Script=Han}/u.test(value),
  'Choose exactly one Han character.',
)

const timestamp = z.number().int().nonnegative()

/** The learner's explicit answer to "can you write this?". Unset means "go by practice history" (practiceCompletions > 0). */
export const writeStateSchema = z.enum(['can', 'cannot'])
export type WriteChoice = z.infer<typeof writeStateSchema>

/** Older data stored `writeKnown: true`; it reads as writeState 'can'. */
export function normalizeCharacterState<T>(value: T): T {
  if (!value || typeof value !== 'object' || !('writeKnown' in value)) return value
  const { writeKnown, ...rest } = value as Record<string, unknown>
  return (writeKnown === true && !('writeState' in rest) ? { ...rest, writeState: 'can' } : rest) as T
}

const characterStateObject = z.object({
  character: characterSchema,
  manualAddedAt: timestamp.optional(),
  /** History only ("Practised 3×"). Not a state of its own. */
  practiceCompletions: z.number().int().nonnegative().safe(),
  lastPracticedAt: timestamp.optional(),
  writeState: writeStateSchema.optional(),
}).strict()

export const characterStateSchema = z.preprocess(normalizeCharacterState, characterStateObject.superRefine((state, context) => {
  if ((state.practiceCompletions > 0) !== (state.lastPracticedAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Character practice history must include both a completion count and its last practice time.' })
  }
}))

export type CharacterState = z.infer<typeof characterStateObject>
