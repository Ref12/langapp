import type { KnowledgeEntry } from './contracts'
import { requireUnit, type Catalog } from './catalog'
import { unitRef } from './contracts'

export const NEW_COUNT_DEFAULT = 5
export const NEW_COUNT_MAX = 20
export const NEW_COUNT_CHOICES = [3, 5, 10, 15, 20] as const
const STORAGE_KEY = 'practice.newWords'

export interface ItemCounts { words: number; grammar: number }

/** A typed or stored count, as a whole number from 1 to 20. */
export function clampCount(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(NEW_COUNT_MAX, Math.max(1, n)) : NEW_COUNT_DEFAULT
}
/** The last choice of how many new words per set, remembered on this device. */
export function loadNewCount(): number {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw === null ? NEW_COUNT_DEFAULT : clampCount(raw) } catch { return NEW_COUNT_DEFAULT }
}
export function saveNewCount(count: number) { try { localStorage.setItem(STORAGE_KEY, String(clampCount(count))) } catch { /* storage may be unavailable */ } }

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
 * Curriculum groups in order until the set holds `count` new words; the groups' grammar patterns come along and are not counted.
 * A group that overshoots by up to 2 words is kept whole; a bigger one is trimmed to the count in its own order.
 */
export function fillByWords(catalog: Catalog, known: ReadonlySet<string>, count: number): string[] {
  const refs: string[] = []
  let words = 0
  for (const { group } of catalog.orderedGroups) {
    if (words >= count) break
    const fresh = group.units.map(unit => requireUnit(catalog, unitRef(unit.kind, unit.ref))).filter(unit => !known.has(unit.ref))
    if (!fresh.length) continue
    const inGroup = fresh.filter(unit => unit.kind === 'vocabulary').length
    if (words + inGroup <= count + 2) { for (const unit of fresh) refs.push(unit.ref); words += inGroup; continue }
    for (const unit of fresh) {
      if (unit.kind === 'vocabulary') { if (words >= count) continue; words++ }
      refs.push(unit.ref)
    }
    if (!refs.length) refs.push(fresh[0].ref)
  }
  return refs
}
