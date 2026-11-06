import { z } from 'zod'

// The phrase bank: several phrases per vocabulary word. The shipped part (src/data/phrases, written offline by scripts/build-phrase-bank.mjs), the catalog's
// authored examples and the sentences the drills already generated make up the bank; nothing in the app writes phrases. The only per-device state is the log of
// which phrases were heard, so later runs prefer others (phraseHeard, carried in backups).

export const PHRASE_SOURCES = ['catalog', 'drill', 'ai'] as const
export type PhraseSource = typeof PHRASE_SOURCES[number]

export interface BankPhrase {
  zh: string
  py: string
  en: string
  /** The vocabulary refs the phrase uses. */
  words: string[]
  /** The grammar refs it demonstrates, where known. */
  grammar?: string[]
  /** A catalog example, a drill sentence, or written by the offline AI pipeline. */
  source: PhraseSource
  /** Passed a model check (authored catalog examples count as checked). */
  checked: boolean
}

/** A band file of the shipped bank: phrases by the word's catalog label. */
export const shippedBandSchema = z.object({
  schemaVersion: z.literal(1),
  band: z.string(),
  phrases: z.record(z.string(), z.array(z.object({
    zh: z.string().min(1), py: z.string().min(1), en: z.string().min(1), words: z.array(z.string().min(1)).min(1),
    grammar: z.array(z.string()).optional(), source: z.enum(PHRASE_SOURCES), checked: z.boolean(),
  }).strict())),
}).passthrough()

/** How often a phrase was heard in Hands-free, and when last. */
export const phraseHeardSchema = z.object({
  zh: z.string().min(1).max(300),
  heard: z.number().int().positive(),
  lastHeardAt: z.number().int().nonnegative(),
}).strict()
export type PhraseHeard = z.infer<typeof phraseHeardSchema>
export const phraseHeardBackupSchema = z.array(phraseHeardSchema).max(20000)
