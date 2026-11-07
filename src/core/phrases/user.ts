import { loadPracticeChain } from '../assistant/practice-chain-load'
import { db } from '../database'
import type { Catalog } from '../study/catalog'
import { tagGrammar } from './grammar-match'
import { userPhraseSchema, type UserPhrase } from './contracts'

// Phrases the learner added to their bank from an Assistant phrase block. Everything here is code: the split into catalog words is the one Learn uses, grammar tags come
// from grammar-match.ts, and nothing calls an AI.

const HAN = /\p{Script=Han}/u

/** The vocabulary of the catalog by written form (the first entry of a form wins, as for Learn). */
export function vocabularyByForm(catalog: Catalog): Map<string, string> {
  const index = new Map<string, string>()
  for (const unit of catalog.units.values()) if (unit.kind === 'vocabulary' && !index.has(unit.record.ch)) index.set(unit.record.ch, unit.ref)
  return index
}

/** Builds the stored phrase: py is the given romanization or generated pinyin, words are the catalog words of the code split (characters it cannot map are left out). */
export async function buildUserPhrase(catalog: Catalog, input: { text: string; romanization?: string; meaning?: string }, addedAt = Date.now()): Promise<UserPhrase> {
  const zh = input.text.trim()
  const engine = await loadPracticeChain()
  const plan = engine.createPracticePlan(zh, input.romanization, true)
  const pieces: string[] = []
  for (const chunk of engine.getPracticeChunks(plan)) {
    let { start, end } = chunk
    while (start < end && !HAN.test(plan.units[start].text)) start++
    while (end > start && !HAN.test(plan.units[end - 1].text)) end--
    if (start < end) pieces.push(engine.getPracticePart(plan, start, end).text)
  }
  const index = vocabularyByForm(catalog)
  const words = [...new Set(pieces.flatMap(piece => index.has(piece) ? [index.get(piece)!] : []))]
  const romanization = input.romanization?.trim()
  const py = romanization || (plan.units.length ? engine.getPracticePart(plan, 0, plan.units.length).pinyin : '')
  return userPhraseSchema.parse({ zh, py, en: input.meaning?.trim() ?? '', words, grammar: tagGrammar(catalog, pieces), source: 'user', addedAt })
}

/** Adds the phrase; adding the same zh again changes nothing. Returns whether it was added. */
export async function addUserPhrase(phrase: UserPhrase): Promise<boolean> {
  const row = userPhraseSchema.parse(phrase)
  return db.transaction('rw', db.userPhrases, async () => {
    if (await db.userPhrases.get(row.zh)) return false
    await db.userPhrases.add(row)
    return true
  })
}

export const removeUserPhrase = (zh: string) => db.userPhrases.delete(zh)
export const getUserPhrase = (zh: string) => db.userPhrases.get(zh)
export const listUserPhrases = () => db.userPhrases.toArray()
