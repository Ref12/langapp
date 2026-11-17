import type { KnowledgeEntry } from './contracts'
import { requireUnit, type Catalog } from './catalog'
import { unitRef } from './contracts'
import { retrievability, type SchedulingState } from './fsrs'
import { storageNames } from '../storage-names'
import { LENGTHS, type Length } from '../session/types'

export const NEW_COUNT_DEFAULT = 5
export const NEW_COUNT_MAX = 20
export const NEW_COUNT_CHOICES = [5, 10, 15, 20] as const
/** The item count of earlier versions (5, 10, 15 or 20 new items per set) and the older words-only key before it: read to migrate the units-per-set choice. */
const ITEMS_KEY = () => storageNames().local.newItems
const LEGACY_KEY = () => storageNames().local.legacyNewItems
const UNITS_KEY = () => storageNames().local.unitsPerSet
const LENGTH_KEY = () => storageNames().local.practiceLength

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
/** New items mode: how many whole units a set holds. */
export const UNIT_CHOICES = [1, 2, 3, 4] as const
export const UNIT_DEFAULT = 1
export const UNIT_MAX = 4
/** A stored item count of the earlier versions as units: 5 to 1, 10 to 2, 15 to 3, 20 to 4; any other number to the nearest of those. */
export function unitsFromItems(items: unknown): number {
  const n = Math.round(Number(items) / 5)
  return Number.isFinite(n) ? Math.min(UNIT_MAX, Math.max(1, n)) : UNIT_DEFAULT
}
/** A typed or stored unit count, as a whole number from 1 to 4. */
export function clampUnits(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(UNIT_MAX, Math.max(1, n)) : UNIT_DEFAULT
}
/** The last choice of how many units per set, remembered on this device; a count of items stored by an earlier version is migrated (default 1). */
export function loadUnitsPerSet(): number {
  try {
    const raw = localStorage.getItem(UNITS_KEY())
    if (raw !== null) return clampUnits(raw)
    const items = localStorage.getItem(ITEMS_KEY()) ?? localStorage.getItem(LEGACY_KEY())
    return items === null ? UNIT_DEFAULT : unitsFromItems(items)
  } catch { return UNIT_DEFAULT }
}
export function saveUnitsPerSet(units: number) { try { localStorage.setItem(UNITS_KEY(), String(clampUnits(units))) } catch { /* storage may be unavailable */ } }

/** The Length chosen on the Practice page (Short, Standard or Long), remembered on this device; Standard until chosen. */
export function loadLength(): Length {
  try { const raw = localStorage.getItem(LENGTH_KEY()); return (LENGTHS as readonly string[]).includes(raw ?? '') ? raw as Length : 'standard' } catch { return 'standard' }
}
export function saveLength(length: Length) { try { localStorage.setItem(LENGTH_KEY(), length) } catch { /* storage may be unavailable */ } }

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

/** The new items of the next `units` whole units (curriculum groups) that still have new items, in order. */
export function fillByUnits(catalog: Catalog, known: ReadonlySet<string>, units: number): string[] {
  const refs: string[] = []
  let taken = 0
  for (const { group } of catalog.orderedGroups) {
    if (taken >= units) break
    const fresh = group.units.map(unit => requireUnit(catalog, unitRef(unit.kind, unit.ref))).filter(unit => !known.has(unit.ref))
    if (!fresh.length) continue
    taken++
    for (const unit of fresh) refs.push(unit.ref)
  }
  return refs
}

/** How many curriculum units (groups) the refs come from. */
export function unitCount(catalog: Catalog, refs: readonly string[]): number {
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
