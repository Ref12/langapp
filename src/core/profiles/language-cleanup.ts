// One-time cleanup of a Japanese or Korean profile that took in another language's learning (a Chinese profile file imported into it, a copy):
// at start, rows keyed by an item ref that certainly belongs to another language (pack.foreignRef) are removed, once per profile.
//
// Removed: knowledge, study cards, skill practice, collection items, practice sessions that only practised such items (with their answers)
// and the journal events about such items (otherwise a restore would bring them back).
// Left alone (not attributable with certainty, or not keyed by an item ref): character states (a kanji that Chinese also has), practice history and
// heard/added phrases (kept by their text), media, sources and the library, assistant threads, collections themselves, the older Chinese v1 tables
// (words, readings, lessons, sessions, attempts), and rows that carry this build's own language marker (ja: in Japanese).
// A Chinese build removes nothing and writes nothing.

import { db } from '../database'
import { getPack } from '../language'
import { buildChannel } from '../storage-names'
import { initializeProfiles } from './store'

const KEY = 'foreign-cleanup' as const

/** Removes the foreign rows once for the active profile; returns how many items (distinct item refs) went. Does nothing when it has run. */
export async function removeForeignLanguageRows(): Promise<number> {
  const pack = getPack()
  if (buildChannel() === 'stable' || pack.id === 'zh') return 0
  await initializeProfiles()
  if (await db.profileState.get(KEY)) return 0
  const foreign = (ref: unknown) => typeof ref === 'string' && pack.foreignRef(ref)
  return db.transaction('rw', [db.knowledge, db.studyCards, db.skillPractice, db.collectionItems, db.exerciseSessions, db.exerciseAttempts, db.journal, db.profileState], async () => {
    const refs = new Set<string>()
    const knowledge = (await db.knowledge.toArray()).filter(entry => foreign(entry.ref))
    const cards = (await db.studyCards.toArray()).filter(card => foreign(card.ref))
    const practice = (await db.skillPractice.toArray()).filter(row => foreign(row.ref))
    const items = (await db.collectionItems.toArray()).filter(item => foreign(item.ref))
    for (const row of [...knowledge, ...cards, ...practice, ...items]) refs.add(row.ref)
    await db.knowledge.bulkDelete(knowledge.map(entry => entry.ref))
    await db.studyCards.bulkDelete(cards.map(card => card.id))
    await db.skillPractice.bulkDelete(practice.map(row => [row.ref, row.skill] as [string, typeof row.skill]))
    await db.collectionItems.bulkDelete(items.map(item => item.id))
    const sessions = (await db.exerciseSessions.toArray()).filter(session => {
      const all = [...session.targetRefs, ...session.reviewRefs]
      return all.length > 0 && all.every(foreign)
    })
    const gone = new Set(sessions.map(session => session.id))
    await db.exerciseSessions.bulkDelete([...gone])
    if (gone.size) await db.exerciseAttempts.where('sessionId').anyOf([...gone]).delete()
    await db.journal.filter(event => foreign((event as { ref?: unknown }).ref)).delete()
    await db.profileState.put({ id: KEY, removed: refs.size, noticed: refs.size === 0 })
    return refs.size
  })
}

/** How many items the cleanup removed, until the learner has seen the notice (0 when there is nothing to show). */
export async function unseenCleanupCount(): Promise<number> {
  const state = await db.profileState.get(KEY)
  return state && !state.noticed ? state.removed ?? 0 : 0
}
export async function markCleanupNoticed(): Promise<void> {
  const state = await db.profileState.get(KEY)
  if (state) await db.profileState.put({ ...state, noticed: true })
}
