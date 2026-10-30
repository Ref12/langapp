import type { Catalog } from '../study/catalog'
import type { MediaItem } from './contracts'

// "Learn from this span": proposes the unknown words of a stretch of a media item, ranked, each with its best example line.
// Pure and local: it reads the two finished passes (tokens and entry links) and never calls the AI.

export type SpanChoice = 'whole' | 'first-half' | 'second-half' | 'quarter-1' | 'quarter-2' | 'quarter-3' | 'quarter-4' | { fromSec: number; toSec: number }
export interface LineRange { from: number; to: number }

export const PROPOSAL = { default: 10, min: 5, max: 20 }
export const clampCount = (value: number) => Math.max(PROPOSAL.min, Math.min(PROPOSAL.max, Math.round(value) || PROPOSAL.default))

/** The inclusive line range of a span; undefined when it holds no line. */
export function spanRange(choice: SpanChoice, lines: readonly { start: number }[]): LineRange | undefined {
  const count = lines.length
  if (!count) return undefined
  if (typeof choice === 'object') {
    const inside = lines.flatMap((line, index) => line.start >= choice.fromSec && line.start <= choice.toSec ? [index] : [])
    return inside.length ? { from: inside[0], to: inside[inside.length - 1] } : undefined
  }
  const parts = choice === 'whole' ? 1 : choice.endsWith('half') ? 2 : 4
  const part = choice === 'whole' ? 0 : choice === 'first-half' ? 0 : choice === 'second-half' ? 1 : Number(choice.slice(-1)) - 1
  const from = Math.floor(count * part / parts)
  const to = Math.floor(count * (part + 1) / parts) - 1
  return to >= from ? { from, to } : undefined
}

export interface Proposal {
  ref: string
  text: string
  pinyin: string
  meaning: string
  /** Curriculum band, '6' for a source entry. */
  band: string
  /** Occurrences in the span / in the whole item. */
  inSpan: number
  inItem: number
  /** The best example line (index) and how many unknown words that line holds. */
  example: number
  exampleUnknown: number
  score: number
}

export function proposeSpan(item: Pick<MediaItem, 'aligned' | 'entries' | 'lines'>, known: ReadonlySet<string>, catalog: Pick<Catalog, 'units'>, range: LineRange, count: number = PROPOSAL.default): Proposal[] {
  const links = item.entries?.links ?? {}
  const wanted = (ref: string | undefined): ref is string => !!ref && !known.has(ref) && (ref.startsWith('source:') || catalog.units.get(ref)?.kind === 'vocabulary')
  const total = new Map<string, number>()
  const span = new Map<string, { count: number; lines: Set<number>; text: string; pinyin: string; meaning: string }>()
  const unknownIn = new Map<number, number>()
  for (const entry of item.aligned?.tokens ?? []) {
    const inside = entry.line >= range.from && entry.line <= range.to
    const seen = new Set<string>()
    for (const token of entry.items) {
      const ref = links[token.text]
      if (!wanted(ref)) continue
      total.set(ref, (total.get(ref) ?? 0) + 1)
      if (!inside) continue
      seen.add(ref)
      const row = span.get(ref) ?? { count: 0, lines: new Set<number>(), text: token.text, pinyin: token.pinyin, meaning: token.meaning }
      row.count++
      row.lines.add(entry.line)
      span.set(ref, row)
    }
    if (inside) unknownIn.set(entry.line, seen.size)
  }
  const proposals: Proposal[] = []
  for (const [ref, row] of span) {
    const unit = catalog.units.get(ref)
    const band = unit ? Number(unit.band) : 6
    const best = [...row.lines].sort((a, b) => (unknownIn.get(a) ?? 0) - (unknownIn.get(b) ?? 0) || (item.lines[a]?.text.length ?? 0) - (item.lines[b]?.text.length ?? 0) || a - b)[0]
    const inItem = total.get(ref) ?? row.count
    // Frequency in the span leads, recurrence across the item adds, and a lower band (more basic) adds most for equal counts.
    const score = row.count * 2 + Math.log2(1 + inItem) + (7 - band) * 1.5
    proposals.push({ ref, text: unit ? (unit.record as { ch: string }).ch : row.text, pinyin: unit ? (unit.record as { pr: string }).pr : row.pinyin, meaning: unit ? (unit.record as { ds: string }).ds : row.meaning, band: String(band), inSpan: row.count, inItem, example: best, exampleUnknown: unknownIn.get(best) ?? 0, score })
  }
  return proposals.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref)).slice(0, clampCount(count))
}
