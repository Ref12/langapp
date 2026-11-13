import { db } from '../database'
import type { Catalog } from '../study/catalog'
import { pickSentences } from '../phrases/sentences'
import type { Sentence } from './contracts'
import type { ItemInfo } from './items'

// Write it never asks a model for anything: each word gets a sentence the learner can read from what ships (the catalog's examples, then the shipped phrase bank, as Practice does)
// and a word with none is written on its own, with its meaning. Nothing here reads the AI connection.

/** The shipped sentence for each word that has a fully known one, known words first. A word missing from the result is shown alone. */
export async function writeSentences(catalog: Catalog, items: readonly ItemInfo[], knownRefs: Iterable<string>, setRefs: Iterable<string> = []): Promise<Record<string, Sentence>> {
  const picked = await pickSentences(catalog, items, new Set([...knownRefs, ...setRefs]))
  return Object.fromEntries(Object.entries(picked).filter(([, sentence]) => !sentence.unknown?.length))
}

/** The same, reading the learner's knowledge from the workspace. */
export async function loadWriteSentences(catalog: Catalog, items: readonly ItemInfo[], setRefs: readonly string[]): Promise<Record<string, Sentence>> {
  const knowledge = await db.knowledge.toArray()
  return writeSentences(catalog, items, knowledge.map(entry => entry.ref), setRefs)
}
