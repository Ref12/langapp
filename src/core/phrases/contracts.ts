import { z } from 'zod'

// The phrase bank: phrases that use vocabulary words and grammar patterns. The shipped part (src/data/phrases/hsk-N.json, a flat list per band, generated from
// curriculum/chinese/authoring/phrases/hsk-N.yaml, which scripts/build-phrase-bank.mjs writes offline), the catalog's
// authored examples and the sentences the drills already generated make up the bank; nothing in the app writes phrases. The only per-device state is the log of
// which phrases were heard, so later runs prefer others (phraseHeard, carried in backups).

/** user: a phrase the learner added from an Assistant phrase block (userPhrases, carried in backups). book and media are reserved for phrases imported later from books and media (no importer yet); they may carry a ref to where the phrase came from. */
export const PHRASE_SOURCES = ['catalog', 'drill', 'ai', 'book', 'media', 'user'] as const
export type PhraseSource = typeof PHRASE_SOURCES[number]

/** Where an imported phrase came from: the title, and a chapter, page or timestamp. */
export const phraseRefSchema = z.object({ title: z.string().min(1), chapter: z.union([z.string(), z.number()]).optional(), page: z.union([z.string(), z.number()]).optional(), timestamp: z.union([z.string(), z.number()]).optional() }).strict()
export type PhraseRef = z.infer<typeof phraseRefSchema>

export interface BankPhrase {
  /** The number in its band file (shipped phrases only). Nothing keys on it. */
  id?: number
  zh: string
  py: string
  en: string
  /** The vocabulary refs the phrase uses. */
  words: string[]
  /** The grammar refs it demonstrates, where known. Phrases that are not catalog examples are used only once these are known too. */
  grammar?: string[]
  /** A catalog example, a drill sentence, written by the offline AI pipeline, or imported from a book or media. */
  source: PhraseSource
  /** Where a book or media phrase came from. */
  ref?: PhraseRef
  /** The look-ahead pass that wrote it (0 = strict) and the lesson by which all its words are introduced. readyAt counts words and grammar. Informational: the app gates on the words and grammar lists. */
  lookahead?: number
  readyAt?: number
  /** Passed a model check (authored catalog examples count as checked). */
  checked: boolean
}

/** A band file of the shipped bank (generated from the YAML by scripts/generate-app-curriculum.mjs): one flat list of phrases. */
export const shippedBandSchema = z.object({
  schemaVersion: z.literal(2),
  band: z.string(),
  phrases: z.array(z.object({
    id: z.number().int().positive(),
    zh: z.string().min(1), py: z.string().min(1), en: z.string().min(1), words: z.array(z.string().min(1)).min(1),
    grammar: z.array(z.string()).optional(), lookahead: z.number().int().nonnegative().optional(), readyAt: z.number().int().nonnegative().optional(),
    source: z.enum(PHRASE_SOURCES), ref: phraseRefSchema.optional(), checked: z.boolean(),
  }).strict()),
}).passthrough()

/** How often a phrase was heard in Hands-free, and when last. */
export const phraseHeardSchema = z.object({
  zh: z.string().min(1).max(300),
  heard: z.number().int().positive(),
  lastHeardAt: z.number().int().nonnegative(),
}).strict()
export type PhraseHeard = z.infer<typeof phraseHeardSchema>
export const phraseHeardBackupSchema = z.array(phraseHeardSchema).max(20000)

/** A phrase the learner added to their bank themselves (the Assistant's phrase blocks): no AI is involved in making it. words are vocabulary refs; characters the split could not map to a catalog word are not listed. */
export const userPhraseSchema = z.object({
  zh: z.string().min(1).max(300),
  py: z.string().max(1000),
  en: z.string().max(1000),
  words: z.array(z.string().min(1)).max(100),
  grammar: z.array(z.string().min(1)).max(20),
  source: z.literal('user'),
  addedAt: z.number().int().nonnegative(),
}).strict()
export type UserPhrase = z.infer<typeof userPhraseSchema>
export const userPhrasesBackupSchema = z.array(userPhraseSchema).max(20000)
