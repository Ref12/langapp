import { LearningDatabase, profileDatabaseName } from '../database'
import { GitHubBackend } from './github'
import { runBackupJob } from './run'
import type { RunRecord } from './state'

// What a worker (dedicated or service) does to back a profile up: open the profile's database itself, read the saved
// connection from it, and run the backup there. The page is never involved, so its main thread stays free.

export interface BackupRequest { profile: { id: string; name: string } }
export type BackupReply = { ok: true; record: RunRecord } | { ok: false; error: string }

export const CHANNEL = 'linguaweave-backup'

export async function runInWorker(request: BackupRequest): Promise<BackupReply> {
  const database = new LearningDatabase(profileDatabaseName(request.profile.id))
  try {
    const saved = await database.backupConfig.get('github')
    if (!saved) throw new Error('Set up the GitHub backup first.')
    const record = await runBackupJob({
      database, profile: request.profile, trigger: 'manual',
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

