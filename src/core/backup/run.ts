import type { LearningDatabase } from '../database'
import { journalCursor, readJournaledState, readJournalRange, readSettings, readUnjournaledState } from '../profiles/read-snapshot'
import { StaleBackupError, type BackupBackend } from './backend'
import { replay, replayFrom } from './journal'
import { buildFilesV2, SEGMENT_EVENTS, SNAPSHOT_EVERY_EVENTS, SNAPSHOT_EVERY_SEGMENTS, type LogState, type SequencedEvent } from './layout'
import { addRun, clearCache, loadCache, loadStatus, saveCache, saveStatus, type BackupCache, type BackupTrigger, type RunRecord } from './state'

// One backup run, free of window, localStorage and React so a worker or the service worker can host it.
// It never holds a transaction across the run: a cursor read, then short chunked reads, then building and uploading with no transaction open.

export interface BackupJob {
  database: LearningDatabase
  profile: { id: string; name: string }
  config: { owner: string; repo: string; branch: string; token: string }
  backend: BackupBackend
  trigger: BackupTrigger
}

const LOCK = 'linguaweave-backup'
const inProcess = new Map<string, Promise<RunRecord>>()
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

/** Runs a backup unless one is already running (in this context or another tab or worker). */
export async function runBackupJob(job: BackupJob): Promise<RunRecord> {
  const key = job.profile.id
  const running = inProcess.get(key)
  if (running) return running
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  const task = (async () => {
    if (!locks) return execute(job)
    const result = await locks.request(LOCK + ':' + key, { ifAvailable: true }, lock => lock ? execute(job) : Promise.resolve(undefined))
    return result ?? skipped(job, 'another backup is already running')
  })().finally(() => inProcess.delete(key))
  inProcess.set(key, task)
  return task
}

const skipped = (job: BackupJob, note: string): RunRecord => ({
  profileId: job.profile.id, trigger: job.trigger, startedAt: Date.now(), endedAt: Date.now(), totalMs: 0, readMs: 0, buildMs: 0, publishMs: 0,
  calls: [], journalEvents: 0, filesChanged: 0, bytes: 0, snapshot: 'none', full: false, outcome: 'skipped', note,
})

async function execute(job: BackupJob): Promise<RunRecord> {
  const { database, profile, config, trigger } = job
  const startedAt = Date.now()
  const t0 = now()
  await saveStatus(profile.id, { ...await loadStatus(profile.id), running: { since: startedAt, trigger } })
  const record: RunRecord = { ...skipped(job, ''), startedAt, outcome: 'error' }
  delete record.note
  try {
    const target = `${config.owner}/${config.repo}#${config.branch}`
    let cache = await loadCache(profile.id)
    if (cache && cache.target !== target) { await clearCache(profile.id); cache = undefined }
    // A restore or a recreated database rewinds the journal: what was sent no longer describes this data.
    if (cache && await journalCursor(database) < cache.lastSeq) { await clearCache(profile.id); cache = undefined }
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(job, cache, target, t0, record)
      } catch (error) {
        if (error instanceof StaleBackupError && attempt === 0) { await clearCache(profile.id); cache = undefined; continue }
        throw error
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The backup failed.'
    await saveStatus(profile.id, { ...await loadStatus(profile.id), running: undefined, lastError: message })
    await finish(job, { ...record, outcome: 'error', note: message, endedAt: Date.now(), totalMs: Math.round(now() - t0) })
    throw error instanceof Error ? error : new Error(message)
  }
}

async function finish(job: BackupJob, record: RunRecord): Promise<RunRecord> {
  if (record.outcome === 'skipped') {
    const status = await loadStatus(job.profile.id)
    await saveStatus(job.profile.id, { ...status, running: undefined })
  }
  await addRun(record)
  return record
}

async function once(job: BackupJob, cache: BackupCache | undefined, target: string, t0: number, base: RunRecord): Promise<RunRecord> {
  const { database, profile, config, backend } = job
  // ---- read: cursor, then chunked journal range and short reads of what the journal does not carry ----
  const r0 = now()
  let cursor: number
  let state: LogState
  let fresh: SequencedEvent[]
  let lastSeq = cache?.lastSeq ?? 0
  if (cache) {
    cursor = await journalCursor(database)
    fresh = await readJournalRange(database, lastSeq, cursor)
    const replayed = replay(fresh, replayFrom({ knowledge: cache.state.knowledge, cards: cache.state.cards, attempts: cache.state.attempts, characters: cache.state.characters }))
    state = { knowledge: [...replayed.knowledge.values()], cards: [...replayed.cards.values()], attempts: [...replayed.exerciseAttempts.values()], characters: [...replayed.characters.values()] }
  } else {
    // First backup: one short read of the replayed tables together with the cursor, then the whole log in chunks.
    const live = await readJournaledState(database)
    cursor = live.seq
    state = { knowledge: live.knowledge, cards: live.cards, attempts: live.attempts, characters: live.characterStates }
    fresh = await readJournalRange(database, 0, cursor)
    lastSeq = 0
  }
  const settings = await readSettings(database)
  const unjournaled = await readUnjournaledState(database)
  const readMs = Math.round(now() - r0)

  // ---- build (no transaction open) ----
  const b0 = now()
  const segmentCount = (cache?.segments.length ?? 0) + Math.ceil(fresh.length / SEGMENT_EVENTS)
  const eventsSince = (cache?.eventsSinceSnapshot ?? 0) + fresh.length
  const snapshotDue = !cache || segmentCount >= SNAPSHOT_EVERY_SEGMENTS || eventsSince >= SNAPSHOT_EVERY_EVENTS
  const built = buildFilesV2({
    profile, settings, unjournaled, state, cursor, fresh, existing: cache?.segments ?? [], snapshotDue, first: !cache,
    snapshotCursor: cache?.snapshotCursor ?? 0,
    connection: { owner: config.owner, repo: config.repo, branch: config.branch, token: config.token },
  })
  const buildMs = Math.round(now() - b0)

  // ---- publish: only files whose Git blob id differs are sent ----
  const p0 = now()
  const message = `Backup ${profile.name} (${fresh.length} new journal events)`
  const result = await backend.publishDelta(profile.id, built.files, built.keep, message, cache?.remote)
  const publishMs = Math.round(now() - p0)

  // The cursor advances only now that the commit exists.
  await saveCache(profile.id, {
    target, remote: result.remote, lastSeq: cursor, segments: built.manifest.segments, snapshotCursor: built.manifest.snapshot.cursor,
    eventsSinceSnapshot: snapshotDue ? 0 : eventsSince, state,
  })
  const prior = await loadStatus(profile.id)
  await saveStatus(profile.id, { lastBackupAt: Date.now(), lastCommit: result.version ?? prior.lastCommit })
  const bytes = [...built.files.values()].reduce((sum, text) => sum + text.length, 0)
  return finish(job, {
    ...base, endedAt: Date.now(), totalMs: Math.round(now() - t0), readMs, buildMs, publishMs, calls: result.calls, journalEvents: fresh.length,
    filesChanged: result.changed + result.removed, bytes, snapshot: snapshotDue ? (cache ? 'replay' : 'live') : 'none', full: !cache,
    outcome: result.version ? 'ok' : 'unchanged',
  })
}
