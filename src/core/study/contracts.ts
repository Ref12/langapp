import { z } from 'zod'

// Knowledge set, spaced-repetition cards and AI-generated exercise sessions
// over the v2 Chinese curriculum. Units are referenced by kind and v2 label.

export const STUDY_DOMAINS = ['reading'] as const
export type StudyDomain = typeof STUDY_DOMAINS[number]

export const unitLabelSchema = z.string().min(1).max(200).regex(/^[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/)
export const unitKindSchema = z.enum(['vocabulary', 'grammar'])
export const unitRefSchema = z.string().regex(/^(?:vocabulary|grammar):[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/)
export const bandSchema = z.enum(['1', '2', '3', '4', '5', '6'])
const timestamp = z.number().int().nonnegative()
const id = z.string().min(1).max(200)

export const knowledgeEntrySchema = z.object({
  ref: unitRefSchema,
  kind: unitKindSchema,
  lb: unitLabelSchema,
  band: bandSchema,
  addedAt: timestamp,
  source: z.enum(['new', 'dictionary']),
}).strict()

export const studyCardSchema = z.object({
  id: z.string().min(1).max(260),
  ref: unitRefSchema,
  domain: z.enum(STUDY_DOMAINS),
  due: timestamp,
  stability: z.number().nonnegative(),
  difficulty: z.number().min(0).max(10),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.enum(['new', 'learning', 'review', 'relearning']),
  lastReview: timestamp.optional(),
  updatedAt: timestamp,
}).strict()

const han = /\p{Script=Han}/u
const chineseTile = z.string().trim().min(1).max(12).refine(value => han.test(value), 'Chinese text is required')
const englishText = z.string().trim().min(1).max(400).refine(value => !han.test(value), 'English text is required')
// English prose that may quote the Chinese words it explains.
const explanationText = z.string().trim().min(1).max(400)

export const choiceExerciseSchema = z.object({
  id: id,
  type: z.literal('choice'),
  targets: z.array(unitRefSchema).min(1).max(6),
  direction: z.enum(['zh-to-en', 'en-to-zh']),
  question: z.string().trim().min(1).max(400),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
  answer: z.number().int().min(0).max(3),
  explanation: explanationText,
}).strict()

export const tilesExerciseSchema = z.object({
  id: id,
  type: z.literal('tiles'),
  targets: z.array(unitRefSchema).min(1).max(6),
  translation: englishText,
  tiles: z.array(chineseTile).min(2).max(16),
  distractors: z.array(chineseTile).max(3),
  shuffled: z.array(z.number().int().nonnegative()).min(2).max(19),
  explanation: explanationText,
}).strict()

export const exerciseSchema = z.discriminatedUnion('type', [choiceExerciseSchema, tilesExerciseSchema])
  .superRefine((exercise, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message })
    if (exercise.type === 'choice') {
      if (exercise.answer >= exercise.options.length) issue('Answer index is out of range')
      if (new Set(exercise.options.map(option => option.trim())).size !== exercise.options.length) issue('Options must be distinct')
    } else {
      const total = exercise.tiles.length + exercise.distractors.length
      if (exercise.shuffled.length !== total || new Set(exercise.shuffled).size !== total || exercise.shuffled.some(index => index >= total)) {
        issue('Shuffled order must be a permutation of all tiles')
      }
    }
  })

export const exerciseSessionSchema = z.object({
  id,
  mode: z.enum(['new', 'review']),
  domain: z.enum(STUDY_DOMAINS),
  groupId: id.optional(),
  targetRefs: z.array(unitRefSchema).min(1).max(40),
  reviewRefs: z.array(unitRefSchema).max(40),
  exercises: z.array(exerciseSchema).min(1).max(30),
  cursor: z.number().int().nonnegative(),
  status: z.enum(['active', 'completed', 'abandoned']),
  model: z.string().max(200),
  rejected: z.array(z.string().max(300)).max(60),
  createdAt: timestamp,
  completedAt: timestamp.optional(),
}).strict()

export const exerciseAttemptSchema = z.object({
  id: z.string().min(1).max(260),
  sessionId: id,
  index: z.number().int().nonnegative(),
  refs: z.array(unitRefSchema).min(1).max(6),
  response: z.string().max(2000),
  correct: z.boolean(),
  createdAt: timestamp,
}).strict()

export const studyBackupSchema = z.object({
  knowledge: z.array(knowledgeEntrySchema).max(20000),
  cards: z.array(studyCardSchema).max(80000),
  sessions: z.array(exerciseSessionSchema).max(20000),
  attempts: z.array(exerciseAttemptSchema).max(200000),
}).strict()

export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>
export type StudyCard = z.infer<typeof studyCardSchema>
export type ChoiceExercise = z.infer<typeof choiceExerciseSchema>
export type TilesExercise = z.infer<typeof tilesExerciseSchema>
export type Exercise = ChoiceExercise | TilesExercise
export type ExerciseSession = z.infer<typeof exerciseSessionSchema>
export type ExerciseAttempt = z.infer<typeof exerciseAttemptSchema>
export type StudyBackup = z.infer<typeof studyBackupSchema>
export type UnitKind = z.infer<typeof unitKindSchema>
export type Band = z.infer<typeof bandSchema>

export function unitRef(kind: UnitKind, lb: string): string {
  return `${kind}:${lb}`
}

export function parseUnitRef(ref: string): { kind: UnitKind; lb: string } {
  const [kind, lb] = unitRefSchema.parse(ref).split(':') as [UnitKind, string]
  return { kind, lb }
}

export function cardId(ref: string, domain: StudyDomain): string {
  return `${ref}:${domain}`
}
