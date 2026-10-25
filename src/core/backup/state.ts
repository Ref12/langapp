import Dexie, { type EntityTable } from 'dexie'
import type { LogState, SegmentRef } from './layout'
import type { RemoteState, CallTrace } from './backend'

// Backup bookkeeping in its own small database so a service worker or worker can read and write it
// (they have no localStorage) and so it never contends with the learning database.

/** Backups start only from the Back up now buttons. */
export type BackupTrigger = 'manual'
export interface BackupStatus { lastBackupAt?: number; lastError?: string; lastCommit?: string; running?: { since: number; trigger: BackupTrigger } }

export interface RunRecord {
  id?: number
  profileId: string
  trigger: BackupTrigger
  startedAt: number
  endedAt: number
  totalMs: number
  readMs: number
  buildMs: number
  publishMs: number
  calls: CallTrace[]
  journalEvents: number
  filesChanged: number
  bytes: number
  snapshot: 'none' | 'live' | 'replay'
  full: boolean
  outcome: 'ok' | 'unchanged' | 'skipped' | 'error'
  note?: string
}

export interface BackupCache {
  target: string
  remote: RemoteState
  lastSeq: number
  segments: SegmentRef[]
  snapshotCursor: number
  eventsSinceSnapshot: number
  state: LogState
}

/** Startup phases and answer/Next save timings, kept (about 20 of each) for Settings → Diagnostics. */
export interface TimingMark { id?: number; kind: 'startup' | 'check' | 'next'; at: number; ms: number; detail?: Record<string, number> }

interface Row { key: string; value: unknown }

class BackupStateDatabase extends Dexie {
  kv!: EntityTable<Row, 'key'>
  runs!: EntityTable<RunRecord, 'id'>
  marks!: EntityTable<TimingMark, 'id'>
  constructor() {
    super('linguaweave-backup-state')
    this.version(1).stores({ kv: '&key', runs: '++id, startedAt', marks: '++id, kind' })
  }
}

let database = new BackupStateDatabase()
export async function resetBackupStateForTests(): Promise<void> { await database.delete(); database = new BackupStateDatabase() }
export const backupStateDb = () => database

const get = async <T>(key: string): Promise<T | undefined> => (await database.kv.get(key))?.value as T | undefined
const put = (key: string, value: unknown) => database.kv.put({ key, value })

export const loadStatus = async (profileId: string): Promise<BackupStatus> => (await get<BackupStatus>('status:' + profileId)) ?? {}
export const saveStatus = (profileId: string, status: BackupStatus) => put('status:' + profileId, status)

export const loadCache = (profileId: string) => get<BackupCache>('cache:' + profileId)
export const saveCache = (profileId: string, cache: BackupCache) => put('cache:' + profileId, cache)
export const clearCache = async (profileId: string) => { await database.kv.delete('cache:' + profileId) }

export const RUN_HISTORY = 20
export async function addRun(run: RunRecord): Promise<void> {
  await database.runs.add(run)
  const count = await database.runs.count()
  if (count > RUN_HISTORY) {
    const old = await database.runs.orderBy('startedAt').limit(count - RUN_HISTORY).primaryKeys()
    await database.runs.bulkDelete(old)
  }
}
export const loadRuns = (limit = RUN_HISTORY) => database.runs.orderBy('startedAt').reverse().limit(limit).toArray()

export const MARK_HISTORY = 20
export async function addMark(mark: TimingMark): Promise<void> {
  await database.marks.add(mark)
  const old = await database.marks.where('kind').equals(mark.kind).primaryKeys()
  if (old.length > MARK_HISTORY) await database.marks.bulkDelete(old.slice(0, old.length - MARK_HISTORY))
}
export const loadMarks = async (): Promise<TimingMark[]> => (await database.marks.toArray()).sort((a, b) => b.at - a.at)
