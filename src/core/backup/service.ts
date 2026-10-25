import { db, type BackupConfigRecord } from '../database'
import { getActiveProfile, readSnapshot, restoreActiveSnapshot, initializeProfiles } from '../profiles/store'
import type { BackupBackend } from './backend'
import { loadBackup, type LoadedBackup } from './files'
import { GitHubBackend } from './github'
import { notifyLocalChange } from './dirty'
import { announce, type BackupReply, type BackupRequest } from './host'
import { runBackupJob } from './run'
import { clearCache, loadActive, loadStatus, saveActive, type BackupStatus } from './state'
import { serializeProfileYaml } from '../profiles/codec'

const CONFIG_KEY = 'linguaweave-backup-config:'

export type BackupConfig = Omit<BackupConfigRecord, 'id'>
export type { BackupStatus }

const hasStorage = () => { try { return typeof localStorage !== 'undefined' } catch { return false } }

/** Reads the connection from IndexedDB, falling back to localStorage; heals whichever copy is missing. */
export async function loadBackupConfig(): Promise<BackupConfig | undefined> {
  await initializeProfiles()
  const profileId = getActiveProfile().id
  let fromDb: BackupConfigRecord | undefined
  try { fromDb = await db.backupConfig.get('github') } catch { fromDb = undefined }
  let fromLocal: BackupConfig | undefined
  if (hasStorage()) {
    try { fromLocal = JSON.parse(localStorage.getItem(CONFIG_KEY + profileId) ?? 'null') ?? undefined } catch { fromLocal = undefined }
  }
  const config = fromDb ?? (fromLocal && { id: 'github' as const, ...fromLocal })
  if (!config) return undefined
  if (!fromDb) { try { await db.backupConfig.put(config) } catch { /* store unavailable */ } }
  if (!fromLocal && hasStorage()) { const { id: _id, ...plain } = config; void _id; localStorage.setItem(CONFIG_KEY + profileId, JSON.stringify(plain)) }
  const { id: _id, ...plain } = config
  void _id
  return plain
}

export async function saveBackupConfig(config: BackupConfig): Promise<void> {
  await initializeProfiles()
  const clean = { ...config, owner: config.owner.trim(), repo: config.repo.trim(), token: config.token.trim(), branch: config.branch.trim() || 'main' }
  if (!/^[A-Za-z0-9-_.]+$/.test(clean.owner) || !/^[A-Za-z0-9-_.]+$/.test(clean.repo)) throw new Error('Enter the GitHub owner and repository name.')
  if (!clean.token) throw new Error('Paste a fine-grained token with Contents read and write access to this repository.')
  await db.backupConfig.put({ id: 'github', ...clean })
  if (hasStorage()) localStorage.setItem(CONFIG_KEY + getActiveProfile().id, JSON.stringify(clean))
  notifyLocalChange()
}

export const readBackupStatus = async (): Promise<BackupStatus> => { await initializeProfiles(); return loadStatus(getActiveProfile().id) }

export function backendFor(config: Pick<BackupConfig, 'owner' | 'repo' | 'token' | 'branch'>, request?: typeof fetch): BackupBackend {
  return new GitHubBackend(config, request)
}

let backendOverride: ((config: BackupConfig) => BackupBackend) | undefined
/** Tests replace the backend factory (which also keeps the run on the page, where the test's backend lives). */
export function setBackendFactoryForTests(factory: typeof backendOverride): void { backendOverride = factory }
const makeBackend = (config: BackupConfig) => backendOverride ? backendOverride(config) : backendFor(config)

let running: Promise<BackupStatus> | undefined

function viaWorker(request: BackupRequest): Promise<BackupReply> {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<BackupReply>) => { worker.terminate(); resolve(event.data) }
    worker.onerror = event => { worker.terminate(); resolve({ ok: false, error: event.message || 'The backup worker failed.' }) }
    worker.postMessage(request)
  })
}

async function backupOnce(): Promise<BackupStatus> {
  const profile = getActiveProfile()
  const config = await loadBackupConfig()
  if (!config) throw new Error('Set up the GitHub backup first.')
  await saveActive({ profile, ...(await loadActive())?.dirtyAt ? { dirtyAt: (await loadActive())!.dirtyAt } : {} })
  if (typeof Worker !== 'undefined' && !backendOverride) {
    const reply = await viaWorker({ profile, trigger: 'manual' })
    if (!reply.ok) throw new Error(reply.error)
  } else {
    await runBackupJob({ database: db, profile, config, backend: makeBackend(config), trigger: 'manual' })
    announce()
  }
  const status = await loadStatus(profile.id)
  await db.backupConfig.update('github', { lastBackupAt: status.lastBackupAt, lastError: '', ...(status.lastCommit ? { lastCommit: status.lastCommit } : {}) })
  return status
}

/**
 * Back up now: the run (reads, building, upload) happens in a worker, never on the page's main thread, and reads the
 * journal up to a cursor in short transactions. Concurrent calls share the run in flight. Nothing else starts a backup
 * while the page is in use; background runs live in the service worker (see sw-entry.ts).
 */
export function runBackup(): Promise<BackupStatus> {
  running ??= backupOnce().finally(() => { running = undefined })
  return running
}

// ---- Durable storage ----

export type PersistenceState = 'granted' | 'denied' | 'unsupported'
export async function requestPersistence(): Promise<PersistenceState> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.persist) return 'unsupported'
  try {
    if (await storage.persisted?.()) return 'granted'
    return await storage.persist() ? 'granted' : 'denied'
  } catch { return 'denied' }
}
export async function persistenceState(): Promise<PersistenceState> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.persisted) return 'unsupported'
  try { return await storage.persisted() ? 'granted' : 'denied' } catch { return 'denied' }
}

// ---- Restore ----

export interface RestorePreview extends Pick<LoadedBackup, 'mode' | 'tailEvents'> { profileName?: string }

export async function loadBackupVersion(config: BackupConfig, profileId: string, version?: string): Promise<LoadedBackup> {
  const files = await makeBackend(config).readFiles(profileId, version)
  return loadBackup(files, getActiveProfile())
}

/** The current local state as YAML, to keep before anything is replaced. */
export async function snapshotCurrentYaml(): Promise<string> {
  await initializeProfiles()
  return serializeProfileYaml(await readSnapshot(db, getActiveProfile()))
}

/** Replaces the active profile with a loaded backup. The caller confirms and keeps a local copy first. */
export async function applyBackup(loaded: LoadedBackup, config: BackupConfig, signal?: AbortSignal): Promise<void> {
  await restoreActiveSnapshot(loaded.snapshot, loaded.journal, signal)
  await clearCache(getActiveProfile().id) // the journal was replaced; the next backup starts from a full one
  await saveBackupConfig(config) // the restore leaves the connection intact; keep both copies current
}

export async function listBackupProfiles(config: BackupConfig) { return makeBackend(config).listProfiles() }
export async function listBackupVersions(config: BackupConfig, profileId: string) { return makeBackend(config).listVersions(profileId) }

/** True when the active profile holds no learning data yet (fresh device). */
export async function isProfileEmpty(): Promise<boolean> {
  const counts = await Promise.all([db.words.count(), db.knowledge.count(), db.attempts.count(), db.exerciseAttempts.count(), db.assistantThreads.count(), db.libraryBooks.count(), db.characterStates.count()])
  return counts.every(count => count === 0)
}
