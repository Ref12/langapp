import { z } from 'zod'

export const characterSchema = z.string().refine(
  value => Array.from(value).length === 1 && /\p{Script=Han}/u.test(value),
  'Choose exactly one Han character.',
)

const timestamp = z.number().int().nonnegative()

export const characterStateSchema = z.object({
  character: characterSchema,
  manualAddedAt: timestamp.optional(),
  practiceCompletions: z.number().int().nonnegative().safe(),
  lastPracticedAt: timestamp.optional(),
}).strict().superRefine((state, context) => {
  if ((state.practiceCompletions > 0) !== (state.lastPracticedAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Character practice history must include both a completion count and its last practice time.' })
  }
})

export type CharacterState = z.infer<typeof characterStateSchema>
