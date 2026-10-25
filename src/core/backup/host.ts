import { LearningDatabase, profileDatabaseName } from '../database'
import { GitHubBackend } from './github'
import { runBackupJob } from './run'
import { loadActive, saveStatus, loadStatus, type BackupTrigger, type RunRecord } from './state'

// What a worker (dedicated or service) does to back a profile up: open the profile's database itself, read the saved
// connection from it, and run the backup there. The page is never involved, so its main thread stays free.

export interface BackupRequest { profile: { id: string; name: string }; trigger: BackupTrigger }
export type BackupReply = { ok: true; record: RunRecord } | { ok: false; error: string }

export const CHANNEL = 'linguaweave-backup'

export async function runInWorker(request: BackupRequest): Promise<BackupReply> {
  const database = new LearningDatabase(profileDatabaseName(request.profile.id))
  try {
    const saved = await database.backupConfig.get('github')
    if (!saved) throw new Error('Set up the GitHub backup first.')
    const record = await runBackupJob({
      database, profile: request.profile, trigger: request.trigger,
      config: { owner: saved.owner, repo: saved.repo, branch: saved.branch, token: saved.token },
      backend: new GitHubBackend({ owner: saved.owner, repo: saved.repo, branch: saved.branch, token: saved.token }),
    })
    announce()
    return { ok: true, record }
  } catch (error) {
    announce()
    return { ok: false, error: error instanceof Error ? error.message : 'The backup failed.' }
  } finally {
    database.close()
  }
}

export function announce(): void {
  try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage('changed'); channel.close() } catch { /* no BroadcastChannel */ }
}

/** The profile this browser last opened, for a background run that has no page to ask. */
export async function backgroundRequest(trigger: BackupTrigger): Promise<BackupRequest | undefined> {
  const active = await loadActive()
  return active ? { profile: active.profile, trigger } : undefined
}

export async function clearRunning(profileId: string): Promise<void> {
  const status = await loadStatus(profileId)
  if (status.running) await saveStatus(profileId, { ...status, running: undefined })
}
