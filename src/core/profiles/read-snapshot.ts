import { aiConnectionSchema, aiEndpointSchema, AI_ENDPOINTS_VERSION, type AIEndpointsExport } from '../assistant/contracts'
import { speechConnectionInputSchema, speechConnectionSchema } from '../assistant/speech-contracts'
import type { LearningDatabase } from '../database'
import { omit } from '../omit'
import type { JournalEvent } from '../backup/journal'
import type { UnjournaledState } from '../backup/layout'
import type { ProfileSnapshot } from './contracts'

// Short, separate read transactions for the cloud backup. None of them spans the backup, and none
// touches the journal except the tiny cursor read, so saving an answer never waits behind one.

type Settings = ProfileSnapshot['settings']

/** Settings (preferences, AI endpoints, speech connection) in one tiny transaction. */
export async function readSettings(database: LearningDatabase): Promise<Settings> {
  return database.transaction('r', [database.preferences, database.aiConnections, database.aiEndpoints, database.speechConnections], () => readSettingsRows(database))
}

/** The same reads without opening a transaction: call inside one that already covers these tables. */
export async function readSettingsRows(database: LearningDatabase): Promise<Settings> {
  return (async () => {
    const preferences = await database.preferences.get('workspace')
    if (!preferences) throw new Error('Your workspace has not been initialized. Reload to try again.')
    const ai = await database.aiConnections.get('assistant')
    const savedEndpoints = await database.aiEndpoints.orderBy('order').toArray()
    const speech = await database.speechConnections.get('assistant-speech')
    let aiEndpoints: AIEndpointsExport | undefined
    let speechConnection: Settings['speechConnection']
    if (savedEndpoints.length) {
      const parsed = savedEndpoints.map(endpoint => aiEndpointSchema.safeParse(endpoint))
      if (parsed.some(result => !result.success)) throw new Error('Saved AI connection settings are invalid. Review them before exporting.')
      const endpoints = aiEndpointSchema.array().parse(savedEndpoints).map(endpoint => omit(endpoint, 'order', 'revision', 'updatedAt'))
      const active = endpoints.find(endpoint => endpoint.id === ai?.endpointId)?.id
      aiEndpoints = { version: AI_ENDPOINTS_VERSION, ...(active ? { active } : {}), endpoints }
    } else if (ai) {
      // A single connection saved before the endpoint list existed.
      const parsed = aiConnectionSchema.safeParse(ai)
      if (!parsed.success) throw new Error('Saved AI connection settings are invalid. Review them before exporting.')
      aiEndpoints = { version: AI_ENDPOINTS_VERSION, active: 'default', endpoints: [{ ...omit(parsed.data, 'id', 'endpointId', 'name', 'revision', 'updatedAt'), id: 'default', name: 'Default' }] }
    }
    if (speech) {
      const parsed = speechConnectionSchema.safeParse(speech)
      if (!parsed.success) throw new Error('Saved speech connection settings are invalid. Review them before exporting.')
      speechConnection = speechConnectionInputSchema.strip().parse(parsed.data)
    }
    return { preferences, ...(aiEndpoints ? { aiEndpoints } : {}), ...(speechConnection ? { speechConnection } : {}) }
  })()
}

/** Reads a table a few hundred rows at a time, each batch in its own short transaction. */
interface Batched<T> {
  orderBy(index: string): { limit(count: number): { toArray(): Promise<T[]> } }
  where(index: string): { above(key: unknown): { limit(count: number): { toArray(): Promise<T[]> } } }
  schema: { primKey: { keyPath?: string | string[] } }
}

export async function readInBatches<T>(source: { toArray(): Promise<T[]> }, size = 300): Promise<T[]> {
  const table = source as unknown as Batched<T>
  const out: T[] = []
  let last: unknown
  for (;;) {
    const rows = await (last === undefined ? table.orderBy(':id').limit(size) : table.where(':id').above(last).limit(size)).toArray()
    out.push(...rows)
    if (rows.length < size) return out
    const keyPath = table.schema.primKey.keyPath
    last = typeof keyPath === 'string' ? (rows[rows.length - 1] as Record<string, unknown>)[keyPath] : undefined
    if (last === undefined) return out
    await new Promise<void>(resolve => setTimeout(resolve, 0)) // let writers and the event loop through between batches
  }
}

/** Everything the log does not carry: tables the app changes without appending a journal event. */
export async function readUnjournaledState(database: LearningDatabase): Promise<UnjournaledState> {
  return {
    words: await readInBatches(database.words), readings: await readInBatches(database.readings),
    lessons: await readInBatches(database.lessons), sessions: await readInBatches(database.sessions),
    attempts: await readInBatches(database.attempts), exerciseSessions: await readInBatches(database.exerciseSessions, 100),
    practiceHistory: await readInBatches(database.practiceHistory),
    threads: await readInBatches(database.assistantThreads), messages: await readInBatches(database.assistantMessages),
    runs: await readInBatches(database.assistantRuns), library: await readInBatches(database.libraryBooks, 20),
  } as unknown as UnjournaledState
}

/** The cursor: the highest journal sequence number so far, read in a tiny transaction. */
export async function journalCursor(database: LearningDatabase): Promise<number> {
  return database.transaction('r', database.journal, async () => (await database.journal.orderBy('seq').last())?.seq ?? 0)
}

/** Journal events with after < seq <= upTo, in batches; each batch is its own readonly transaction on the journal alone. */
export async function readJournalRange(database: LearningDatabase, after: number, upTo: number, size = 400): Promise<(JournalEvent & { seq: number })[]> {
  const out: (JournalEvent & { seq: number })[] = []
  let from = after
  while (from < upTo) {
    const rows = await database.transaction('r', database.journal, () => database.journal.where('seq').above(from).and(row => (row.seq ?? 0) <= upTo).limit(size).toArray()) as (JournalEvent & { seq: number })[]
    if (!rows.length) break
    out.push(...rows)
    from = rows[rows.length - 1].seq
    if (rows.length < size) break
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  return out
}

/** The state the log replays (knowledge, cards, exercise answers, characters) together with the cursor: one short read. Used only for the first snapshot. */
export async function readJournaledState(database: LearningDatabase) {
  return database.transaction('r', [database.knowledge, database.studyCards, database.exerciseAttempts, database.characterStates, database.journal], async () => ({
    knowledge: await database.knowledge.toArray(), cards: await database.studyCards.toArray(),
    attempts: await database.exerciseAttempts.toArray(), characterStates: await database.characterStates.toArray(),
    seq: (await database.journal.orderBy('seq').last())?.seq ?? 0,
  }))
}
