import { db } from '../database'
import type { JournalEvent } from './journal'

/** Appends events to the local journal. Call inside a transaction that includes db.journal. */
export async function recordJournal(...events: JournalEvent[]): Promise<void> {
  if (events.length) await db.journal.bulkAdd(events)
}
