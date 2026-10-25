import { useState } from 'react'
import { CloudUpload } from 'lucide-react'
import { runBackup } from '../core/backup/service'
import { relativeTime, useBackupConnected, useBackupStatus } from './useBackupStatus'

/** Compact "Back up now" action for the sidebar. Shown only when a backup connection is saved. */
export function BackupNow() {
  const connected = useBackupConnected()
  const status = useBackupStatus()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [working, setWorking] = useState(false)
  if (!connected) return <a className="backup-now-setup" href="#settings">Set up backup</a>
  const running = working || Boolean(status.running)
  const line = running ? 'Safe to keep studying' : error ? error : status.lastError && !done ? 'Last backup failed' : done ? 'Backed up just now' : 'Last backup: ' + relativeTime(status.lastBackupAt)
  return <div className="backup-now">
    <button type="button" className="backup-now-button" disabled={running} onClick={() => {
      setWorking(true); setError(''); setDone(false)
      void runBackup().then(() => setDone(true), reason => setError(reason instanceof Error ? reason.message.slice(0, 80) : 'Backup failed')).finally(() => setWorking(false))
    }}><CloudUpload size={16} aria-hidden="true" /><span>{running ? 'Backing up…' : 'Back up now'}</span></button>
    <small role="status" className={error || status.lastError ? 'backup-now-error' : undefined}>{line}</small>
  </div>
}
