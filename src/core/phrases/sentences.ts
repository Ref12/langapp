import type { Catalog } from '../study/catalog'
import type { Sentence } from '../drills/contracts'
import { catalogSentence, type ItemInfo } from '../drills/items'
import { grammarPhrases } from './bank'

/**
 * The sentence for each item, chosen from the learner's own words (`allowed`: the knowledge set plus the run's or set's refs): a fully known authored example, else for a grammar
 * item a usable bank phrase tagged with the grammar point, else the authored example with the fewest unknown words (marked `unknown`). The bank is only read when a grammar item needs it.
 */
export async function pickSentences(catalog: Catalog, items: readonly ItemInfo[], allowed: ReadonlySet<string>): Promise<Record<string, Sentence>> {
  const out: Record<string, Sentence> = {}
  const needBank: ItemInfo[] = []
  for (const item of items) {
    const found = catalogSentence(catalog, item, allowed)
    if (found) out[item.ref] = found
    if (item.kind === 'grammar' && (!found || found.unknown?.length)) needBank.push(item)
  }
  if (needBank.length) {
    const bank = await grammarPhrases(catalog, needBank.map(item => item.ref), allowed)
    for (const item of needBank) { const found = catalogSentence(catalog, item, allowed, bank.get(item.ref) ?? []); if (found) out[item.ref] = found }
  }
  return out
}
