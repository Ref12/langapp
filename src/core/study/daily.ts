import type { KnowledgeEntry } from './contracts'
import { requireUnit, type Catalog } from './catalog'
import { unitRef } from './contracts'
import { retrievability, type SchedulingState } from './fsrs'
import { storageNames } from '../storage-names'

export const NEW_COUNT_DEFAULT = 5
export const NEW_COUNT_MAX = 20
export const NEW_COUNT_CHOICES = [5, 10, 15, 20] as const
const STORAGE_KEY = () => storageNames().local.newItems
/** The earlier key, from when the count was words only; read once and carried over. */
const LEGACY_KEY = () => storageNames().local.legacyNewItems

const REVIEW_KEY = () => storageNames().local.reviewCount
export const REVIEW_COUNT_DEFAULT = 10
/** The review choice: a number (due first, then the ones coming up next) or 'all' (every item due now). Never chosen means 'all'. */
export type ReviewCount = number | 'all'
export const ALL_DUE = 'all'
/** The review choice, remembered separately from the new-items count. Nothing stored (or unreadable) is 'all'; an older stored number keeps working. */
export function loadReviewCount(): ReviewCount {
  try { const raw = localStorage.getItem(REVIEW_KEY()); return raw === null || raw === ALL_DUE ? ALL_DUE : clampCount(raw) } catch { return ALL_DUE }
}
export function saveReviewCount(count: ReviewCount) { try { localStorage.setItem(REVIEW_KEY(), count === ALL_DUE ? ALL_DUE : String(clampCount(count))) } catch { /* storage may be unavailable */ } }
/** A practice set holds at most 200 items (its stored refs list is limited to 200): 'All due' stops there and the summary says "N of M due". */
export const REVIEW_ALL_MAX = 200
/** How many reviews a choice means when dueTotal are due: 'all' is every due item (up to REVIEW_ALL_MAX), or the default number (the ones coming up next) when nothing is due. Not clamped. */
export const reviewLimit = (choice: ReviewCount, dueTotal: number): number => choice === ALL_DUE ? (dueTotal > 0 ? Math.min(dueTotal, REVIEW_ALL_MAX) : REVIEW_COUNT_DEFAULT) : choice

export interface ItemCounts { words: number; grammar: number }

/** A typed or stored count, as a whole number from 1 to 20. */
export function clampCount(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(NEW_COUNT_MAX, Math.max(1, n)) : NEW_COUNT_DEFAULT
}
/** The last choice of how many new items per set (at least), remembered on this device. */
export function loadNewCount(): number {
  try { const raw = localStorage.getItem(STORAGE_KEY()) ?? localStorage.getItem(LEGACY_KEY()); return raw === null ? NEW_COUNT_DEFAULT : clampCount(raw) } catch { return NEW_COUNT_DEFAULT }
}
export function saveNewCount(count: number) { try { localStorage.setItem(STORAGE_KEY(), String(clampCount(count))) } catch { /* storage may be unavailable */ } }

/** Words (curriculum vocabulary and words saved from media) and grammar patterns; characters are not items. */
export function countItems(entries: readonly Pick<KnowledgeEntry, 'kind'>[]): ItemCounts {
  let words = 0, grammar = 0
  for (const entry of entries) { if (entry.kind === 'grammar') grammar++; else words++ }
  return { words, grammar }
}

export function describeCounts(counts: ItemCounts, characters?: number): string {
  const parts = [`${counts.words} ${counts.words === 1 ? 'word' : 'words'}`, `${counts.grammar} grammar`]
  if (characters !== undefined) parts.push(`${characters} ${characters === 1 ? 'character' : 'characters'}`)
  return parts.join(' · ')
}

/**
 * Curriculum groups in order until the set holds at least `count` new items (words and grammar patterns).
 * A group is a lesson unit and is always kept whole, so the set can run over the count by up to a group.
 */
export function fillByItems(catalog: Catalog, known: ReadonlySet<string>, count: number): string[] {
  const refs: string[] = []
  for (const { group } of catalog.orderedGroups) {
    if (refs.length >= count) break
    const fresh = group.units.map(unit => requireUnit(catalog, unitRef(unit.kind, unit.ref))).filter(unit => !known.has(unit.ref))
    for (const unit of fresh) refs.push(unit.ref)
  }
  return refs
}

/** How many curriculum lessons (groups) the refs come from. */
export function lessonCount(catalog: Catalog, refs: readonly string[]): number {
  const wanted = new Set(refs)
  return catalog.orderedGroups.filter(({ group }) => group.units.some(unit => wanted.has(unitRef(unit.kind, unit.ref)))).length
}

/** A review set: the due cards, most overdue first, then, to fill up to `count`, the cards coming up next, lowest predicted recall (FSRS retrievability) first, so each early review is worth the most. */
export function pickReviews<Card extends SchedulingState & { ref: string }>(cards: readonly Card[], now: number, choice: ReviewCount): { refs: string[]; due: number; dueTotal: number; upcoming: number } {
  const due = cards.filter(card => card.due <= now).sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref))
  const count = reviewLimit(choice, due.length)
  const taken = due.slice(0, count)
  const next = cards.filter(card => card.due > now && card.state !== 'new')
    .map(card => ({ card, recall: retrievability(card, now) }))
    .sort((a, b) => a.recall - b.recall || a.card.due - b.card.due || a.card.ref.localeCompare(b.card.ref))
    .slice(0, count - taken.length).map(entry => entry.card)
  return { refs: [...taken, ...next].map(card => card.ref), due: taken.length, dueTotal: due.length, upcoming: next.length }
}
