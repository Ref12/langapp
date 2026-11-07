import { z } from 'zod'

/** The pre-generated practice dataset (scripts/build-practice-dataset.mjs, Ideas #202 sections 6 and 6a). One JSON file per band and kind in src/data/practice. */
export const PRACTICE_KINDS = ['accepted', 'exchanges', 'grammar', 'conversations'] as const
export type PracticeKind = (typeof PRACTICE_KINDS)[number]
export const PRACTICE_BANDS = ['1', '2', '3', '4', '5', '6'] as const

/** The voice of a spoken line, so audio can be added without a format change. */
export const speakerSchema = z.enum(['female', 'male'])
export type Speaker = z.infer<typeof speakerSchema>

const readyAt = z.number().int().min(0)
const refs = z.array(z.string().min(1))
const han = /\p{Script=Han}/u
const chinese = z.string().min(1).refine(value => han.test(value), 'no Chinese')
const english = z.string().min(1).refine(value => !han.test(value), 'Chinese in English')
const unique = (values: string[]) => new Set(values.map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())).size === values.length

const line = z.object({ zh: chinese, py: z.string().min(1), en: english })
const spokenLine = line.extend({ speaker: speakerSchema })

/** Other ways to answer a Translate or Tiles exercise for one shipped phrase. */
export const acceptedItemSchema = z.object({
  /** The phrase's key: its Han characters only (phraseKey). */
  key: z.string().min(1), zh: chinese, en: english,
  /** Other natural Chinese wordings and word orders for the same English. */
  zhAlt: z.array(chinese), enAlt: z.array(english),
  /** Words (1-2 characters) of the phrase that may be left out or added without changing the meaning. */
  optional: z.array(z.string().min(1).max(2)), readyAt,
})
export type AcceptedItem = z.infer<typeof acceptedItemSchema>

/** A question and a fitting reply, with 2-3 plausible wrong replies for the pick-a-reply form. */
export const exchangeSchema = z.object({
  id: z.string().min(1), lesson: z.number().int().min(1).optional(),
  q: spokenLine, a: spokenLine, wrong: z.array(line).min(2).max(3),
  words: refs, grammar: refs, readyAt,
}).refine(item => item.wrong.every(wrong => wrong.zh !== item.a.zh), { message: 'a wrong reply equals the right one' })
  .refine(item => new Set(item.wrong.map(wrong => wrong.zh)).size === item.wrong.length, { message: 'duplicate wrong replies' })
export type Exchange = z.infer<typeof exchangeSchema>

/** A near-miss wrong version of a real bank phrase, with the one-line reason. */
export const nearMissSchema = z.object({
  id: z.string().min(1), ref: z.string().min(1), phrase: z.string().min(1), zh: chinese, en: english, wrong: chinese, wrongPy: z.string().optional(),
  kind: z.enum(['order', 'particle', 'missing-particle', 'adverb', 'measure', 'negation', 'other']), why: z.string().min(1).max(220), readyAt,
}).refine(item => item.wrong !== item.zh, { message: 'the near miss equals the phrase' })
export type NearMiss = z.infer<typeof nearMissSchema>

/** A grammar pattern's short explanation and its near misses. */
export const grammarPointSchema = z.object({ ref: z.string().min(1), note: z.string().min(1).max(500).optional(), readyAt, items: z.array(nearMissSchema) })
  .refine(point => point.items.every(item => item.ref === point.ref), { message: 'a near miss belongs to another grammar point' })
export type GrammarPoint = z.infer<typeof grammarPointSchema>

const questionSchema = z.object({ q: english, options: z.array(english).min(3).max(4), answer: z.number().int().min(0) })
  .refine(question => question.answer < question.options.length, { message: 'the answer is not one of the options' })
  .refine(question => unique(question.options), { message: 'duplicate options' })

/** A 4-8 line conversation with named speakers and exactly 2 comprehension questions, each with exactly one right option (answer is its index). */
export const conversationSchema = z.object({
  id: z.string().min(1), lesson: z.number().int().min(1).optional(),
  speakers: z.array(z.object({ name: z.string().min(1), speaker: speakerSchema })).min(2).max(3),
  lines: z.array(spokenLine.extend({ name: z.string().min(1) })).min(4).max(8),
  questions: z.array(questionSchema).length(2), words: refs, grammar: refs, readyAt,
}).refine(item => item.lines.every(entry => item.speakers.some(speaker => speaker.name === entry.name && speaker.speaker === entry.speaker)), { message: 'a line has a speaker that is not listed, or with another voice' })
export type Conversation = z.infer<typeof conversationSchema>

const fileOf = <K extends PracticeKind, T extends z.ZodTypeAny>(kind: K, item: T) => z.object({ schemaVersion: z.literal(1), kind: z.literal(kind), band: z.string().min(1), items: z.array(item) })
export const acceptedFileSchema = fileOf('accepted', acceptedItemSchema)
export const exchangesFileSchema = fileOf('exchanges', exchangeSchema)
export const grammarFileSchema = fileOf('grammar', grammarPointSchema)
export const conversationsFileSchema = fileOf('conversations', conversationSchema)
export const practiceFileSchemas = { accepted: acceptedFileSchema, exchanges: exchangesFileSchema, grammar: grammarFileSchema, conversations: conversationsFileSchema } as const

export interface PracticeFiles {
  accepted: AcceptedItem[]
  exchanges: Exchange[]
  grammar: GrammarPoint[]
  conversations: Conversation[]
}

export const practiceIndexSchema = z.object({
  schemaVersion: z.literal(1),
  bands: z.record(z.object({ accepted: z.number(), exchanges: z.number(), grammar: z.object({ points: z.number(), nearMisses: z.number() }), conversations: z.number() })),
  totals: z.object({ accepted: z.number(), exchanges: z.number(), grammarPoints: z.number(), nearMisses: z.number(), conversations: z.number() }),
})
export type PracticeIndex = z.infer<typeof practiceIndexSchema>
