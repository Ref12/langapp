import { db } from '../database'
import { loadCatalog, type Catalog } from '../study/catalog'
import { isSourceRef } from '../study/contracts'
import { loadItems } from './items'
import { newCharacters, type WriteState } from './write-queue'

/** The unwritten-characters backlog: characters in words the learner knows that they have not written yet. Items stay words; characters only decide which words and how many. */
export const UNWRITTEN_DEFAULT = 8
export const UNWRITTEN_CHOICES = [5, 8, 12] as const
const KEY = 'practice.unwrittenSize'
export const clampUnwritten = (value: unknown): number => { const n = Math.round(Number(value)); return Number.isFinite(n) && n >= 1 ? Math.min(40, n) : UNWRITTEN_DEFAULT }
export function loadUnwrittenSize(): number { try { const raw = localStorage.getItem(KEY); return raw === null ? UNWRITTEN_DEFAULT : clampUnwritten(raw) } catch { return UNWRITTEN_DEFAULT } }
export function saveUnwrittenSize(size: number) { try { localStorage.setItem(KEY, String(clampUnwritten(size))) } catch { /* storage may be unavailable */ } }

/** A known word: when it joined the knowledge set, and its place in the catalog (lesson order) for ties. */
export interface BacklogWord { ref: string; zh: string; addedAt: number; order: number }
type States = readonly WriteState[]

/** Every unwritten guided character across the known words: the total the Practice home shows. */
export const countUnwritten = (words: readonly BacklogWord[], states: States, has?: (character: string) => boolean): number => newCharacters(words.map(word => word.zh), states, has).length

/**
 * Takes words oldest first (ties in catalog order), counting each unwritten character once across the set, until `size` characters are reached.
 * A word whose unwritten characters are all already covered by earlier picks is skipped. `characters` is what the picked words teach.
 */
export function pickUnwritten(words: readonly BacklogWord[], states: States, size: number, has?: (character: string) => boolean): { refs: string[]; characters: string[] } {
  const covered = new Set<string>()
  const refs: string[] = []
  for (const word of [...words].sort((a, b) => a.addedAt - b.addedAt || a.order - b.order || a.ref.localeCompare(b.ref))) {
    if (covered.size >= size) break
    const fresh = newCharacters([word.zh], states, has).filter(character => !covered.has(character))
    if (!fresh.length) continue
    for (const character of fresh) covered.add(character)
    refs.push(word.ref)
  }
  return { refs, characters: [...covered] }
}

/** The known words the catalog (or a saved source entry) can resolve, as backlog candidates. */
export async function loadBacklogWords(catalog?: Catalog): Promise<BacklogWord[]> {
  const cat = catalog ?? await loadCatalog()
  const entries = (await db.knowledge.toArray()).filter(entry => cat.units.has(entry.ref) || isSourceRef(entry.ref))
  const order = new Map<string, number>()
  for (const { group } of cat.orderedGroups) for (const unit of group.units) if (!order.has(unit.ref)) order.set(unit.ref, order.size)
  const items = await loadItems(entries.map(entry => entry.ref), cat)
  const added = new Map(entries.map(entry => [entry.ref, entry.addedAt]))
  return items.filter(item => item.kind === 'vocabulary' || item.kind === 'source').map(item => ({ ref: item.ref, zh: item.zh, addedAt: added.get(item.ref) ?? 0, order: order.get(item.ref) ?? Number.MAX_SAFE_INTEGER }))
}
