import { db } from './database'

/** What History can hide: one kind and the record's id (a phrase's text). */
export type HistoryKey = `phrase:${string}` | `lesson:${string}` | `drill:${string}` | `handsfree:${string}`

const split = (key: HistoryKey): [string, string] => { const at = key.indexOf(':'); return [key.slice(0, at), key.slice(at + 1)] }

async function mark(keys: readonly HistoryKey[], removedAt: number | undefined) {
  const set = (record: { removedAt?: number }) => { if (removedAt === undefined) delete record.removedAt; else record.removedAt = removedAt }
  await db.transaction('rw', db.practiceHistory, db.exerciseSessions, db.drillSets, db.handsfreeRuns, async () => {
    for (const key of keys) {
      const [kind, id] = split(key)
      if (kind === 'phrase') await db.practiceHistory.where('text').equals(id).modify(set)
      else if (kind === 'lesson') await db.exerciseSessions.where('id').equals(id).modify(set)
      else if (kind === 'drill') await db.drillSets.where('id').equals(id).modify(set)
      else if (kind === 'handsfree') await db.handsfreeRuns.where('id').equals(id).modify(set)
    }
  })
}

/**
 * Hides records from History by stamping removedAt. Nothing else is touched: the knowledge set, review schedule, cards,
 * practice counts and attempts all stay, so this is a soft delete that restoreHistoryItems reverses.
 */
export const removeHistoryItems = (keys: readonly HistoryKey[], now = Date.now()) => mark(keys, now)
export const restoreHistoryItems = (keys: readonly HistoryKey[]) => mark(keys, undefined)
