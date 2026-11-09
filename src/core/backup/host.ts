import { LearningDatabase, profileDatabaseName } from '../database'
import { storageNames } from '../storage-names'
import { GitHubBackend } from './github'
import { runBackupJob } from './run'
import type { RunRecord } from './state'

// What a worker (dedicated or service) does to back a profile up: open the profile's database itself, read the saved
// connection from it, and run the backup there. The page is never involved, so its main thread stays free.

export interface BackupRequest { profile: { id: string; name: string }; trigger?: 'manual' | 'auto' }
/** Sent to a running worker when an exercise opens: it stops at its next safe point. */
export interface PauseMessage { pause: true }
export type BackupReply = { ok: true; record: RunRecord } | { ok: false; error: string }

export const CHANNEL = () => storageNames().broadcast

export async function runInWorker(request: BackupRequest, shouldPause?: () => boolean): Promise<BackupReply> {
  const database = new LearningDatabase(profileDatabaseName(request.profile.id))
  try {
    const saved = await database.backupConfig.get('github')
    if (!saved) throw new Error('Set up the GitHub backup first.')
    const record = await runBackupJob({
      database, profile: request.profile, trigger: request.trigger ?? 'manual', shouldPause,
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
  try { const channel = new BroadcastChannel(CHANNEL()); channel.postMessage('changed'); channel.close() } catch { /* no BroadcastChannel */ }
}

