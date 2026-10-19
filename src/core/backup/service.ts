import { db, type BackupConfigRecord } from '../database'
import { getActiveProfile, readSnapshot, restoreActiveSnapshot, initializeProfiles } from '../profiles/store'
import type { BackupBackend } from './backend'
import { buildBackupFiles, loadBackup, type LoadedBackup } from './files'
import { GitHubBackend } from './github'
import { clearDirty, isDirty, markDirty, notifyLocalChange, onLocalChange, setDirtyProfile } from './dirty'
import { serializeProfileYaml } from '../profiles/codec'

export const DEBOUNCE_MS = 90_000
export const DAILY_MS = 24 * 60 * 60 * 1000
const CONFIG_KEY = 'linguaweave-backup-config:'
const STATUS_KEY = 'linguaweave-backup-status:'

export type BackupConfig = Omit<BackupConfigRecord, 'id'>
export interface BackupStatus { lastBackupAt?: number; lastError?: string; lastCommit?: string }

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

export function readBackupStatus(): BackupStatus {
  if (!hasStorage()) return {}
  try { return JSON.parse(localStorage.getItem(STATUS_KEY + getActiveProfile().id) ?? '{}') as BackupStatus } catch { return {} }
}

function writeStatus(status: BackupStatus) {
  if (hasStorage()) localStorage.setItem(STATUS_KEY + getActiveProfile().id, JSON.stringify(status))
}

export function backendFor(config: Pick<BackupConfig, 'owner' | 'repo' | 'token' | 'branch'>, request?: typeof fetch): BackupBackend {
  return new GitHubBackend(config, request)
}

let backendOverride: ((config: BackupConfig) => BackupBackend) | undefined
/** Tests replace the backend factory. */
export function setBackendFactoryForTests(factory: typeof backendOverride): void { backendOverride = factory }
const makeBackend = (config: BackupConfig) => backendOverride ? backendOverride(config) : backendFor(config)

let running: Promise<BackupStatus> | undefined

async function backupOnce(): Promise<BackupStatus> {
  const profileId = getActiveProfile().id
  const config = await loadBackupConfig()
  if (!config) throw new Error('Set up the GitHub backup first.')
  try {
    const { snapshot, journal } = await db.transaction('r', db.tables, async () => ({
      snapshot: await readSnapshot(db, getActiveProfile()), journal: await db.journal.orderBy('seq').toArray(),
    }))
    clearDirty(profileId) // Changes made while uploading set it again.
    const events = journal.map(({ seq: _seq, ...event }) => { void _seq; return event })
    const files = buildBackupFiles(snapshot, events, { owner: config.owner, repo: config.repo, branch: config.branch, token: config.token })
    const result = await makeBackend(config).publish(profileId, files, `Backup ${snapshot.profile.name} (${events.length} journal events)`)
    const status: BackupStatus = { lastBackupAt: Date.now(), lastCommit: result.version ?? readBackupStatus().lastCommit }
    writeStatus(status)
    await db.backupConfig.update('github', { lastBackupAt: status.lastBackupAt, lastError: '', ...(status.lastCommit ? { lastCommit: status.lastCommit } : {}) })
    return status
  } catch (error) {
    markDirty(profileId) // still unsent; the hourly check retries
    const message = error instanceof Error ? error.message : 'The backup failed.'
    writeStatus({ ...readBackupStatus(), lastError: message })
    throw error instanceof Error ? error : new Error(message)
  }
}

/** One backup = one commit. Concurrent calls share the run in flight. */
export function runBackup(): Promise<BackupStatus> {
  running ??= backupOnce().finally(() => { running = undefined })
  return running
}

/** Debounced after changes, immediately when the page hides with unsent changes, and at least daily. */
export function startBackupScheduler(options: { debounceMs?: number } = {}): () => void {
  const profileId = getActiveProfile().id
  setDirtyProfile(profileId)
  const debounce = options.debounceMs ?? DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = () => { void loadBackupConfig().then(config => config && runBackup()).catch(() => undefined) }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(attempt, debounce) }
  const unsubscribe = onLocalChange(schedule)
  const hide = () => { if (document.visibilityState === 'hidden' && isDirty(profileId)) { clearTimeout(timer); attempt() } }
  const pageHide = () => { if (isDirty(profileId)) { clearTimeout(timer); attempt() } }
  const daily = () => {
    void loadBackupConfig().then(config => {
      if (config && (isDirty(profileId) || Date.now() - (readBackupStatus().lastBackupAt ?? 0) >= DAILY_MS)) return runBackup()
    }).catch(() => undefined)
  }
  document.addEventListener('visibilitychange', hide)
  window.addEventListener('pagehide', pageHide)
  const interval = setInterval(daily, 60 * 60 * 1000)
  daily()
  return () => {
    clearTimeout(timer); clearInterval(interval); unsubscribe()
    document.removeEventListener('visibilitychange', hide)
    window.removeEventListener('pagehide', pageHide)
  }
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
  await saveBackupConfig(config) // the restore leaves the connection intact; keep both copies current
  clearDirty(getActiveProfile().id)
}

export async function listBackupProfiles(config: BackupConfig) { return makeBackend(config).listProfiles() }
export async function listBackupVersions(config: BackupConfig, profileId: string) { return makeBackend(config).listVersions(profileId) }

/** True when the active profile holds no learning data yet (fresh device). */
export async function isProfileEmpty(): Promise<boolean> {
  const counts = await Promise.all([db.words.count(), db.knowledge.count(), db.attempts.count(), db.exerciseAttempts.count(), db.assistantThreads.count(), db.libraryBooks.count(), db.characterStates.count()])
  return counts.every(count => count === 0)
}
