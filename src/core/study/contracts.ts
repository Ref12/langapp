import { z } from 'zod'

// Knowledge set, spaced-repetition cards and AI-generated exercise sessions
// over the v2 Chinese curriculum. Units are referenced by kind and v2 label.

export const STUDY_DOMAINS = ['reading'] as const
export type StudyDomain = typeof STUDY_DOMAINS[number]

export const unitLabelSchema = z.string().min(1).max(200).regex(/^[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/)
export const unitKindSchema = z.enum(['vocabulary', 'grammar'])
// `phrase:` refs name a collection's free phrase (see core/collections); they have no curriculum record.
// `source:` refs name an entry drawn from a media source (see core/media/entries); it has no curriculum record either.
export const unitRefSchema = z.string().regex(/^(?:vocabulary|grammar|phrase|source):[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/)
export const bandSchema = z.enum(['1', '2', '3', '4', '5', '6'])
const timestamp = z.number().int().nonnegative()
const id = z.string().min(1).max(200)

export const knowledgeEntrySchema = z.object({
  ref: unitRefSchema,
  kind: z.enum(['vocabulary', 'grammar', 'source']),
  lb: unitLabelSchema,
  /** Source entries sit beyond the curriculum bands and use '6'. */
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
  /** Other natural answers built from the same words (spaces and punctuation ignored); the learner's answer may match any of them or the tiles in order. */
  acceptedAnswers: z.array(z.string().trim().min(1).max(80)).max(4).optional(),
  shuffled: z.array(z.number().int().nonnegative()).min(2).max(19),
  explanation: explanationText,
}).strict()

export const MATCH_MODE_VALUES = ['zh-en', 'zh-py', 'py-en'] as const

/** Built in code, never by the AI: 4 or 5 pairs; the left column is the pairs in order, the right column shows each pair's right text in `order`. */
export const matchExerciseSchema = z.object({
  id: id,
  type: z.literal('match'),
  targets: z.array(unitRefSchema).min(1).max(6),
  mode: z.enum(MATCH_MODE_VALUES),
  pairs: z.array(z.object({ ref: unitRefSchema, left: z.string().trim().min(1).max(200), right: z.string().trim().min(1).max(200) }).strict()).min(4).max(5),
  /** A permutation of the pair indexes: the order the right column is shown in. */
  order: z.array(z.number().int().min(0).max(4)).min(4).max(5),
  explanation: explanationText,
}).strict()

export const exerciseSchema = z.discriminatedUnion('type', [choiceExerciseSchema, tilesExerciseSchema, matchExerciseSchema])
  .superRefine((exercise, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message })
    if (exercise.type === 'match') {
      const count = exercise.pairs.length
      if (exercise.order.length !== count || new Set(exercise.order).size !== count || exercise.order.some(index => index >= count)) issue('Order must be a permutation of the pairs')
    } else if (exercise.type === 'choice') {
      if (exercise.answer >= exercise.options.length) issue('Answer index is out of range')
      if (new Set(exercise.options.map(option => option.trim())).size !== exercise.options.length) issue('Options must be distinct')
    } else {
      const total = exercise.tiles.length + exercise.distractors.length
      if (exercise.shuffled.length !== total || new Set(exercise.shuffled).size !== total || exercise.shuffled.some(index => index >= total)) {
        issue('Shuffled order must be a permutation of all tiles')
      }
    }
  })

/** A missed exercise queued to be played again at the end of the session; the position after the exercises is the redo's place in this list. */
export const redoSchema = z.object({
  /** Index into the session's exercises. */
  exercise: z.number().int().nonnegative(),
  /** 1 for the first redo, 2 for the second (the most any exercise gets). */
  round: z.number().int().min(1).max(2),
  /** A fresh tile order for a tiles exercise. */
  shuffled: z.array(z.number().int().nonnegative()).max(19).optional(),
}).strict()

export const exerciseSessionSchema = z.object({
  id,
  mode: z.enum(['new', 'review']),
  domain: z.enum(STUDY_DOMAINS),
  groupId: id.optional(),
  targetRefs: z.array(unitRefSchema).min(1).max(40),
  reviewRefs: z.array(unitRefSchema).max(40),
  exercises: z.array(exerciseSchema).max(140),
  cursor: z.number().int().nonnegative(),
  /** Missed exercises queued after the last one. The cursor runs on through them; redos are never graded or scheduled again. */
  redos: z.array(redoSchema).max(160).optional(),
  status: z.enum(['active', 'completed', 'abandoned']),
  model: z.string().max(200),
  rejected: z.array(z.string().max(300)).max(60),
  createdAt: timestamp,
  completedAt: timestamp.optional(),
  redoOf: id.optional(),
  /** Set while the exercises are being written ('running') or after the attempt failed; absent once the exercises are filled in. */
  generation: z.enum(['running', 'failed']).optional(),
  generationError: z.string().max(600).optional(),
  /** Set when the AI could not finish its part of a lesson that already had programmatic exercises; shown once, quietly. */
  aiNotice: z.string().max(600).optional(),
  /** The number of exercises asked for, from the lesson preference when the session was saved. */
  exerciseCount: z.number().int().min(1).max(80).optional(),
  /** Set when the session practises a collection; such sessions never count as the daily New/Review session. */
  collectionId: id.optional(),
  /** Set when the session practises lines picked from media without any study set: the items the lesson is made of. */
  lines: z.array(z.object({ ref: unitRefSchema, text: z.string().max(2000).optional(), translation: z.string().max(2000).optional() }).strict()).max(40).optional(),
  /** A collection lesson's order: the exercise index where each phase (words, grammar, the line itself) starts. */
  phases: z.array(z.object({ kind: z.enum(['words', 'grammar', 'line']), start: z.number().int().nonnegative() }).strict()).max(3).optional(),
}).strict()

export const exerciseAttemptSchema = z.object({
  id: z.string().min(1).max(260),
  sessionId: id,
  index: z.number().int().nonnegative(),
  refs: z.array(unitRefSchema).min(1).max(6),
  response: z.string().max(2000),
  correct: z.boolean(),
  /** True for the answer to a redo: it only has to be right and changes no card or score. */
  redo: z.boolean().optional(),
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
export type MatchExercise = z.infer<typeof matchExerciseSchema>
export type MatchMode = MatchExercise['mode']
export type Exercise = ChoiceExercise | TilesExercise | MatchExercise
export type Redo = z.infer<typeof redoSchema>
export type ExerciseSession = z.infer<typeof exerciseSessionSchema>
export type ExerciseAttempt = z.infer<typeof exerciseAttemptSchema>
export type StudyBackup = z.infer<typeof studyBackupSchema>
export type UnitKind = z.infer<typeof unitKindSchema>
export type Band = z.infer<typeof bandSchema>

export function unitRef(kind: UnitKind | 'source', lb: string): string {
  return `${kind}:${lb}`
}

export function isSourceRef(ref: string): boolean {
  return ref.startsWith('source:')
}

export function isPhraseRef(ref: string): boolean {
  return ref.startsWith('phrase:')
}

export function parseUnitRef(ref: string): { kind: UnitKind; lb: string } {
  const [kind, lb] = unitRefSchema.parse(ref).split(':') as [UnitKind, string]
  return { kind, lb }
}

export function cardId(ref: string, domain: StudyDomain): string {
  return `${ref}:${domain}`
}
