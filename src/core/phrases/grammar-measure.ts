import type { Catalog } from '../study/catalog'
import { grammarPatterns, matchGrammar } from './grammar-match'

/** An authored catalog example as the matcher sees it: its segmented words and the grammar refs authored on it. */
export interface MeasuredExample { text: string; words: string[]; grammar: Set<string> }

/** Every distinct authored example of the catalog (group examples and each grammar point's own), with the grammar refs authored on it. */
export function authoredExamples(catalog: Catalog): MeasuredExample[] {
  const byText = new Map<string, MeasuredExample>()
  const add = (example: { segments: { word?: string }[]; grammar: string[] }) => {
    const words = example.segments.flatMap(segment => {
      if (!segment.word) return []
      const unit = catalog.units.get(`vocabulary:${segment.word}`)
      return unit?.kind === 'vocabulary' ? [unit.record.ch] : []
    })
    const text = words.join('')
    const entry = byText.get(text) ?? { text, words, grammar: new Set<string>() }
    for (const label of example.grammar) entry.grammar.add(`grammar:${label}`)
    byText.set(text, entry)
  }
  for (const { group } of catalog.orderedGroups) for (const example of group.examples) add(example)
  for (const unit of catalog.units.values()) if (unit.kind === 'grammar') add(unit.record.ex)
  return [...byText.values()]
}

export interface PatternStats { ref: string; tagged: number; correct: number; precision: number }

/** For each pattern with fixed characters: of the examples the matcher tags, how many have that ref authored. */
export function measurePatterns(catalog: Catalog, examples = authoredExamples(catalog)): PatternStats[] {
  const patterns = grammarPatterns(catalog)
  const tagged = new Map<string, { tagged: number; correct: number }>(patterns.map(pattern => [pattern.ref, { tagged: 0, correct: 0 }]))
  for (const example of examples) for (const ref of matchGrammar(patterns, example.words)) {
    const stats = tagged.get(ref)!
    stats.tagged++
    if (example.grammar.has(ref)) stats.correct++
  }
  return patterns.map(pattern => { const { tagged: n, correct } = tagged.get(pattern.ref)!; return { ref: pattern.ref, tagged: n, correct, precision: n ? correct / n : 0 } })
}

/** A pattern qualifies with at least this precision over at least this many tagged examples. */
export const MIN_PRECISION = 0.95
export const MIN_TAGGED = 8
export const qualifies = (stats: PatternStats) => stats.tagged >= MIN_TAGGED && stats.precision >= MIN_PRECISION

/** Overall numbers for a set of enabled refs: precision of what it tags and recall of the authored (example, ref) pairs. */
export function overall(catalog: Catalog, enabled: ReadonlySet<string>, examples = authoredExamples(catalog)) {
  const patterns = grammarPatterns(catalog).filter(pattern => enabled.has(pattern.ref))
  let tagged = 0, correct = 0, authored = 0
  for (const example of examples) {
    authored += example.grammar.size
    for (const ref of matchGrammar(patterns, example.words)) { tagged++; if (example.grammar.has(ref)) correct++ }
  }
  return { tagged, correct, authored, precision: tagged ? correct / tagged : 0, recall: authored ? correct / authored : 0 }
}
