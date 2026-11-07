import { usableFor } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { phraseKey } from '../phrases/key'
import type { Flagged, PickedPhrase } from './types'

/**
 * The sentences of one session (design section 5). One pool hands out a phrase per exercise:
 * - strict (every exercise where the learner produces Chinese, and the whole Produce stage): only phrases whose every word is known as a word (usableFor), never a fallback;
 * - otherwise (recognise, reading, listening): a fully known phrase first, else one with exactly one unknown word, which comes back flagged;
 * - no sentence (by Han text) is given out twice, whichever item or exercise asked.
 */
export class SentencePool {
  private readonly used = new Set<string>()
  constructor(private readonly candidates: ReadonlyMap<string, readonly BankPhrase[]>, private readonly allowed: ReadonlySet<string>, private readonly formOf: (ref: string) => string | undefined) {}

  has(zh: string): boolean { return this.used.has(phraseKey(zh)) }

  take(ref: string, strict: boolean): PickedPhrase | undefined {
    const list = (this.candidates.get(ref) ?? []).filter(phrase => !this.used.has(phraseKey(phrase.zh)))
    const known = list.find(phrase => usableFor(phrase, this.allowed))
    if (known) { this.used.add(phraseKey(known.zh)); return { phrase: known } }
    if (strict) return undefined
    for (const phrase of list) {
      const unknown = phrase.words.filter(word => !this.allowed.has(word))
      // the grammar tags still gate a phrase that is not a catalog example, as in usableFor
      if (unknown.length !== 1 || !(phrase.source === 'catalog' || (phrase.grammar ?? []).every(tag => this.allowed.has(tag)))) continue
      const flagged: Flagged = { ref: unknown[0], form: this.formOf(unknown[0]) ?? unknown[0] }
      this.used.add(phraseKey(phrase.zh))
      return { phrase, unknown: flagged }
    }
    return undefined
  }

  /** Gives a phrase back when the exercise that took it could not be built. */
  release(phrase: Pick<BankPhrase, 'zh'>): void { this.used.delete(phraseKey(phrase.zh)) }

  /** Marks a phrase as used (an item's own phrase, a dataset exercise's sentence). */
  reserve(zh: string): boolean {
    const key = phraseKey(zh)
    if (this.used.has(key)) return false
    this.used.add(key)
    return true
  }
}
