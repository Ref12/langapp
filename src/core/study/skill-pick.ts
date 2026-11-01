import { db } from '../database'
import { loadCatalog } from './catalog'
import { isSourceRef } from './contracts'
import { dueCards } from './knowledge'
import { rankItems, type PickStrategy, type Skill } from './skills'

/**
 * Chooses `size` items of the knowledge set to practise in a skill. 'due' is the existing Reviews logic (reading only, FSRS due order), unchanged.
 */
export async function pickItems(skill: Skill, size: number, strategy: PickStrategy, now = Date.now()): Promise<string[]> {
  const catalog = await loadCatalog()
  const usable = (ref: string) => catalog.units.has(ref) || isSourceRef(ref)
  const knowledge = (await db.knowledge.toArray()).filter(entry => usable(entry.ref))
  if (strategy === 'due') {
    const known = new Set(knowledge.map(entry => entry.ref))
    return (await dueCards(now)).filter(card => known.has(card.ref)).sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref)).slice(0, size).map(card => card.ref)
  }
  return rankItems(knowledge, await db.skillPractice.where('skill').equals(skill).toArray(), skill, strategy, size, now)
}
