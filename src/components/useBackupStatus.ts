import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { getActiveProfile } from '../core/profiles/store'
import { backupStateDb, type BackupStatus } from '../core/backup/state'

/** The backup's status as the worker or service worker wrote it to IndexedDB (they cannot see localStorage). */
export function useBackupStatus(): BackupStatus {
  const id = getActiveProfile().id
  return useLiveQuery(async () => ((await backupStateDb().kv.get('status:' + id))?.value as BackupStatus | undefined) ?? {}, [id]) ?? {}
}

export function useBackupConnected(): boolean {
  return useLiveQuery(async () => (await db.backupConfig.get('github')) !== undefined, [], false)
}

export function relativeTime(ms: number | undefined, now = Date.now()): string {
  if (!ms) return 'never'
  const minutes = Math.round((now - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes + ' min ago'
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours + ' h ago'
  return Math.round(hours / 24) + ' d ago'
}
