import type { Catalog } from '../study/catalog'
import { grammarPhrases, loadBank, shippedPhrases, usableFor } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { phraseKey } from '../phrases/key'
import { pickSentences } from '../phrases/sentences'
import type { ItemInfo } from '../drills/items'
import type { PlanItem } from './plan'
import type { SessionExercise, Stage } from './types'

/**
 * The plug-in point for the pre-generated dataset (design section 6): conversations, two-line exchanges, grammar near-misses, accepted answers. Nothing implements it yet. A source
 * hands the planner finished exercises in the engine's existing forms (a choice with the dataset's wrong answers, tiles with its accepted answers...), so the dataset arrives
 * without engine changes. `taken` and `take` let it respect the session's "no sentence twice" rule.
 */
export interface DatasetSource {
  exercises(request: { stage: Stage; items: readonly PlanItem[]; allowed: ReadonlySet<string>; taken: (zh: string) => boolean; take: (zh: string) => boolean }): SessionExercise[]
}

/** Where the engine's material comes from, in order: vocabulary records (code), the exercise bank (code, from phrases), the dataset (this hook), then AI. */
export interface SessionSources {
  dataset?: DatasetSource
  /** Accepted Chinese wordings the dataset ships for a phrase. */
  extraAccepted?: (phrase: Pick<BankPhrase, 'zh'>) => readonly string[]
}

const bandNumber = (band: string | undefined) => (band ? Number.parseInt(band, 10) || 0 : 0)

/**
 * The phrases a session can use. Per item: the sentence `pickSentences` prefers (lesson examples first), then every fully known phrase (`usableFor`), shortest first, then phrases with exactly one
 * unknown word (the planner only gives these to recognise, reading and listening). Also the whole usable shipped bank, for alternatives and listen-and-pick distractors.
 */
export async function loadSessionBank(catalog: Catalog, items: readonly ItemInfo[], allowed: ReadonlySet<string>): Promise<{ byItem: Map<string, BankPhrase[]>; all: BankPhrase[] }> {
  const vocabulary = items.filter(item => item.kind === 'vocabulary')
  const grammar = items.filter(item => item.kind === 'grammar')
  const known = await loadBank(catalog, vocabulary.map(item => item.ref), allowed, [])
  const tagged = await grammarPhrases(catalog, grammar.map(item => item.ref), allowed)
  const preferred = await pickSentences(catalog, items, allowed)
  const topBand = Math.max(1, ...[...allowed].map(ref => bandNumber(catalog.units.get(ref)?.band)))
  const every = new Map<string, BankPhrase>()
  const loose = new Map<string, BankPhrase[]>()
  for (let band = 1; band <= Math.min(6, topBand); band++) {
    for (const [ref, list] of Object.entries(await shippedPhrases(String(band)))) {
      for (const phrase of list) {
        if (usableFor(phrase, allowed)) every.set(phraseKey(phrase.zh), phrase)
        else if (vocabulary.some(item => item.ref === ref) && phrase.words.filter(word => !allowed.has(word)).length === 1) (loose.get(ref) ?? loose.set(ref, []).get(ref)!).push(phrase)
      }
    }
  }
  const byItem = new Map<string, BankPhrase[]>()
  for (const item of items) {
    const first = preferred[item.ref]
    const list = [...(known.get(item.ref) ?? []), ...(tagged.get(item.ref) ?? [])]
    const head = first && !first.unknown?.length ? list.find(phrase => phraseKey(phrase.zh) === phraseKey(first.zh)) : undefined
    const ordered = [...(head ? [head] : []), ...list.filter(phrase => phrase !== head).sort((a, b) => a.zh.length - b.zh.length)]
    const seen = new Set<string>()
    const unique = ordered.filter(phrase => !seen.has(phraseKey(phrase.zh)) && !!seen.add(phraseKey(phrase.zh)))
    byItem.set(item.ref, [...unique, ...(loose.get(item.ref) ?? []).filter(phrase => !seen.has(phraseKey(phrase.zh))).sort((a, b) => a.zh.length - b.zh.length)])
  }
  for (const list of byItem.values()) for (const phrase of list) if (usableFor(phrase, allowed)) every.set(phraseKey(phrase.zh), phrase)
  return { byItem, all: [...every.values()] }
}
