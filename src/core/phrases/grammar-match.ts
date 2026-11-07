import type { Catalog } from '../study/catalog'
import { ENABLED_GRAMMAR_PATTERNS } from './grammar-enabled'

// Tags a phrase with grammar points by code, no AI. A point's pattern (the catalog's `pt`, e.g. "<subject> + 是 + <noun>", from the authored token_form) has fixed
// characters and open slots; the phrase gets the tag when the fixed characters appear in order among its segmented words. Patterns that are only slots never match.
// Only the points listed in ENABLED_GRAMMAR_PATTERNS tag phrases: the ones whose precision against the authored examples is high (grammar-match.test.ts checks the list).

const HAN = /\p{Script=Han}/u

/** One fixed element of a pattern: the word must equal one of the alternatives. */
export type FixedElement = string[]
export interface GrammarPattern { ref: string; fixed: FixedElement[] }

/** The fixed elements of a pattern text, in order; undefined when it cannot be read with certainty (alternative whole patterns mixed with fixed words) or has none. */
export function parsePattern(pt: string): FixedElement[] | undefined {
  const fixed: FixedElement[] = []
  for (const raw of pt.replace(/[？?。]/gu, '').split(' + ')) {
    const part = raw.trim()
    if (!part) return undefined
    if (part.includes('<')) {
      if (HAN.test(part)) return undefined // e.g. "<noun> / 多少": a slot beside a fixed word, not certain
      continue
    }
    const options = part.replace(/^\(|\)$/gu, '').split('/').map(option => option.trim()).filter(Boolean)
    if (!options.length || !options.every(option => HAN.test(option))) return undefined
    fixed.push(options)
  }
  return fixed.length ? fixed : undefined
}

/** Every grammar point of the catalog whose pattern has fixed characters. */
export function grammarPatterns(catalog: Catalog): GrammarPattern[] {
  const out: GrammarPattern[] = []
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'grammar') continue
    const fixed = parsePattern(unit.record.pt)
    if (fixed) out.push({ ref: unit.ref, fixed })
  }
  return out
}

/** Whether the fixed elements appear in order among the words. */
export const matchesPattern = (fixed: readonly FixedElement[], words: readonly string[]): boolean => {
  let at = 0
  for (const word of words) if (at < fixed.length && fixed[at].includes(word)) at++
  return at === fixed.length
}

/** The refs of the patterns (all of them, or the given ones) that match the segmented words. */
export function matchGrammar(patterns: readonly GrammarPattern[], words: readonly string[]): string[] {
  return patterns.filter(pattern => matchesPattern(pattern.fixed, words)).map(pattern => pattern.ref)
}

/** The grammar refs that tag a phrase given its segmented words: enabled patterns only. */
export function tagGrammar(catalog: Catalog, words: readonly string[]): string[] {
  const enabled = new Set(ENABLED_GRAMMAR_PATTERNS)
  return matchGrammar(grammarPatterns(catalog).filter(pattern => enabled.has(pattern.ref)), words)
}
