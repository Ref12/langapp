import { useLiveQuery } from 'dexie-react-hooks'
import { getActiveProfile } from '../core/profiles/store'
import { backupStateDb, loadAutoSetting, saveAutoSetting } from '../core/backup/state'
import { useBackupConnected } from './useBackupStatus'

/** Automatic backup on/off (default on). Hidden when no backup is connected. */
export function AutoBackupSwitch() {
  const connected = useBackupConnected()
  const id = getActiveProfile().id
  const on = useLiveQuery(async () => { await backupStateDb().kv.get('auto:' + id); return loadAutoSetting(id) }, [id], true)
  if (!connected) return null
  return <label className="toggle auto-backup-switch"><input type="checkbox" role="switch" checked={on} onChange={event => void saveAutoSetting(id, event.target.checked)} /> Automatic backup
    <small className="muted"> Backs up after a lesson or practice session, or when you leave a page with new progress, at most every 15 minutes.</small></label>
}
