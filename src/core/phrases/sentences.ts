import type { Catalog } from '../study/catalog'
import type { Sentence } from '../drills/contracts'
import { catalogExamples, catalogSentence, unknownForms, type ItemInfo } from '../drills/items'
import { grammarPhrases, loadBank } from './bank'
import { phraseKey } from './key'

/**
 * The sentence for each item, chosen from the learner's own words (`allowed`: the knowledge set plus the run's or set's refs). For vocabulary and grammar items alike, the first fully
 * known sentence from: 1. the authored lesson examples (shortest first); 2. usable bank phrases that contain the word, or are tagged with the grammar point (shipped bands up to the
 * learner's highest, plus the learner's own phrases), shortest first. Only when neither exists is the authored example with the fewest unknown words returned, marked `unknown`
 * (a fallback: the caller treats it as a gap for the AI, and the production types skip it). No sentence (by Han text) is given to two items; `used` are texts already taken in the set.
 */
export async function pickSentences(catalog: Catalog, items: readonly ItemInfo[], allowed: ReadonlySet<string>, used: Iterable<string> = []): Promise<Record<string, Sentence>> {
  const taken = new Set([...used].map(phraseKey))
  const out: Record<string, Sentence> = {}
  const counted = items.filter(item => item.kind === 'vocabulary' || item.kind === 'grammar')
  const known = new Map<string, Sentence[]>()
  const needBank: ItemInfo[] = []
  for (const item of counted) {
    const examples = [...catalogExamples(catalog, item.ref)].sort((a, b) => a.text.length - b.text.length)
      .filter(example => !unknownForms(catalog, example.words, allowed).length)
      .map((example): Sentence => ({ zh: example.text, py: example.pinyin, en: example.translation, source: 'catalog' }))
    known.set(item.ref, examples)
    if (!examples.some(example => !taken.has(phraseKey(example.zh)))) needBank.push(item)
  }
  const bank = new Map<string, Sentence[]>()
  if (needBank.length) {
    const asPhrases = (phrases: readonly { zh: string; py: string; en: string; checked?: boolean }[]): Sentence[] => [...phrases].filter(phrase => phrase.en.trim()).sort((a, b) => a.zh.length - b.zh.length)
      .map(phrase => ({ zh: phrase.zh, py: phrase.py, en: phrase.en, source: 'ai', ...(phrase.checked ? { checked: true } : {}) }))
    const vocabulary = needBank.filter(item => item.kind === 'vocabulary')
    const grammar = needBank.filter(item => item.kind === 'grammar')
    if (vocabulary.length) for (const [ref, phrases] of await loadBank(catalog, vocabulary.map(item => item.ref), allowed, [])) bank.set(ref, asPhrases(phrases))
    if (grammar.length) for (const [ref, phrases] of await grammarPhrases(catalog, grammar.map(item => item.ref), allowed)) bank.set(ref, asPhrases(phrases))
  }
  for (const item of items) {
    const candidates = [...(known.get(item.ref) ?? []), ...(bank.get(item.ref) ?? [])]
    const chosen = candidates.find(candidate => !taken.has(phraseKey(candidate.zh)))
    if (chosen) { out[item.ref] = chosen; taken.add(phraseKey(chosen.zh)); continue }
    // a phrase is its own sentence; a word with no known sentence gets the closest authored example, marked
    const found = catalogSentence(catalog, item, allowed)
    if (found && !taken.has(phraseKey(found.zh))) { out[item.ref] = found; taken.add(phraseKey(found.zh)) }
  }
  return out
}
