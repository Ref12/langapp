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

/** Grammar particles and pronouns: real words, but the last thing worth studying from a span. */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(['的', '了', '是', '吧', '啊', '呀', '啦', '嘛', '吗', '呢', '我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '这', '那', '不', '就', '也', '都', '在', '有', '和', '没'])

const hanLength = (text: string) => Array.from(text).filter(char => /\p{Script=Han}/u.test(char)).length
/** How good a line is as an example: 4-15 Han characters is ideal; shorter or longer is penalised by the distance. */
const lengthPenalty = (text: string) => { const n = hanLength(text); return n < 4 ? 4 - n : n > 15 ? n - 15 : 0 }

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
    const best = [...row.lines].sort((a, b) => lengthPenalty(item.lines[a]?.text ?? '') - lengthPenalty(item.lines[b]?.text ?? '') || (unknownIn.get(a) ?? 0) - (unknownIn.get(b) ?? 0) || (item.lines[a]?.text.length ?? 0) - (item.lines[b]?.text.length ?? 0) || a - b)[0]
    const inItem = total.get(ref) ?? row.count
    // Distinct lines (not raw count) lead, recurrence across the item adds, band 1 weighs only a little; function words go last.
    const text = unit ? (unit.record as { ch: string }).ch : row.text
    const score = Math.log2(1 + row.lines.size) * 3 + Math.log2(1 + inItem) + (7 - band) * 0.4 - (FUNCTION_WORDS.has(text) ? 1000 : 0)
    proposals.push({ ref, text, pinyin: unit ? (unit.record as { pr: string }).pr : row.pinyin, meaning: unit ? (unit.record as { ds: string }).ds : row.meaning, band: String(band), inSpan: row.count, inItem, example: best, exampleUnknown: unknownIn.get(best) ?? 0, score })
  }
  return proposals.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref)).slice(0, clampCount(count))
}
