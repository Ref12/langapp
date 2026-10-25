import { useEffect, useState } from 'react'
import { CloudUpload, History } from 'lucide-react'
import { stopForProfileChange } from './profile-guard'
import { getActiveProfile } from '../core/profiles/store'
import type { BackupProfileInfo, BackupVersion } from '../core/backup/backend'
import {
  applyBackup, listBackupProfiles, listBackupVersions, loadBackupConfig, loadBackupVersion, isProfileEmpty, persistenceState,
  runBackup, saveBackupConfig, snapshotCurrentYaml, type BackupConfig, type PersistenceState,
} from '../core/backup/service'
import { useBackupStatus } from './useBackupStatus'
import { ScanSetupQr, ShowSetupQr } from './SetupQr'
import type { LoadedBackup } from '../core/backup/files'

const message = (error: unknown) => error instanceof Error ? error.message : 'The operation failed.'
const when = (ms?: number) => ms ? new Date(ms).toLocaleString() : 'never'
const EMPTY: BackupConfig = { owner: '', repo: '', token: '', branch: 'main' }

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}

function ConnectionFields({ config, onChange, disabled }: { config: BackupConfig; onChange: (config: BackupConfig) => void; disabled: boolean }) {
  const set = (key: keyof BackupConfig, value: string) => onChange({ ...config, [key]: value })
  return <>
    <label>GitHub owner<input value={config.owner} disabled={disabled} autoComplete="off" onChange={event => set('owner', event.target.value)} /></label>
    <label>Repository<input value={config.repo} disabled={disabled} autoComplete="off" onChange={event => set('repo', event.target.value)} /></label>
    <label>Branch<input value={config.branch} disabled={disabled} autoComplete="off" onChange={event => set('branch', event.target.value)} /></label>
    <label>Fine-grained token (Contents: read and write)<input type="password" value={config.token} disabled={disabled} autoComplete="off" onChange={event => set('token', event.target.value)} /></label>
  </>
}

/** Lists profiles and versions in the backup repository, then replaces the local profile after a confirm. */
export function RestorePicker({ config, reload = () => window.location.reload() }: { config: BackupConfig; reload?: () => void }) {
  const [profiles, setProfiles] = useState<BackupProfileInfo[]>()
  const [profileId, setProfileId] = useState('')
  const [versions, setVersions] = useState<BackupVersion[]>()
  const [version, setVersion] = useState('')
  const [loaded, setLoaded] = useState<LoadedBackup>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const attempt = async (task: () => Promise<void>) => {
    setWorking(true); setError('')
    try { await task() } catch (reason) { setError(message(reason)) } finally { setWorking(false) }
  }
  const choose = (id: string) => void attempt(async () => {
    setProfileId(id); setVersions(undefined); setVersion(''); setLoaded(undefined)
    const list = await listBackupVersions(config, id)
    setVersions(list); setVersion(list[0]?.id ?? '')
  })

  return <div className="restore-picker" aria-label="Restore from GitHub backup">
    <button type="button" className="button secondary" disabled={working} onClick={() => void attempt(async () => {
      await saveBackupConfig(config)
      const list = await listBackupProfiles(config)
      setProfiles(list); setLoaded(undefined)
      if (list.length === 1) choose(list[0].id)
    })}><History size={16} /> Find backups</button>
    {profiles && !profiles.length && <p className="notice" role="status">No profile backups were found in this repository.</p>}
    {profiles && profiles.length > 0 && <label>Backed-up profile<select value={profileId} disabled={working} onChange={event => choose(event.target.value)}>
      <option value="" disabled>Choose a profile</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name ?? profile.id}</option>)}
    </select></label>}
    {versions && <label>Version<select value={version} disabled={working} onChange={event => { setVersion(event.target.value); setLoaded(undefined) }}>
      {versions.map(item => <option key={item.id} value={item.id}>{new Date(item.date).toLocaleString()} — {item.message}</option>)}
    </select></label>}
    {versions && version && !loaded && <button type="button" className="button primary" disabled={working} onClick={() => void attempt(async () => {
      setLoaded(await loadBackupVersion(config, profileId, version))
    })}>Review this version</button>}
    {loaded && <div className="notice" role="alertdialog" aria-label="Confirm restore">
      <p><strong>Replace this device's profile?</strong> This restores {loaded.snapshot.knowledge.study.knowledge.length} knowledge items, {loaded.snapshot.knowledge.study.cards.length} study cards and {loaded.snapshot.conversations.threads.length} conversations
        {loaded.mode === 'journal' ? ' (rebuilt from the whole journal because the checkpoint could not be read)' : loaded.tailEvents ? ` (checkpoint plus ${loaded.tailEvents} later journal events)` : ' (from the checkpoint)'}.
        Everything currently stored for this profile in this browser is replaced. A copy of the current data downloads first.</p>
      <div className="button-row">
        <button type="button" className="button primary" disabled={working} onClick={() => void attempt(async () => {
          await stopForProfileChange()
          download(`linguaweave-before-restore-${new Date().toISOString().slice(0, 10)}.yaml`, await snapshotCurrentYaml())
          await applyBackup(loaded, config)
          window.location.hash = 'settings'
          reload()
        })}>Download current data, then replace</button>
        <button type="button" className="button secondary" disabled={working} onClick={() => setLoaded(undefined)}>Cancel</button>
      </div>
    </div>}
    {working && <p className="small muted" role="status">Working with GitHub...</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </div>
}

/** Offered on a fresh device: connection fields plus the picker. */
export function RestoreFromBackup({ initial }: { initial?: BackupConfig }) {
  const [config, setConfig] = useState<BackupConfig>(initial ?? EMPTY)
  return <div className="settings-form">
    <ScanSetupQr />
    <ConnectionFields config={config} onChange={setConfig} disabled={false} />
    <RestorePicker config={config} />
  </div>
}

export function BackupPanel({ busy }: { busy: boolean }) {
  const [config, setConfig] = useState<BackupConfig>(EMPTY)
  const [saved, setSaved] = useState(false)
  const status = useBackupStatus()
  const [persistence, setPersistence] = useState<PersistenceState>('unsupported')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restoring, setRestoring] = useState(false)
  useEffect(() => {
    let live = true
    void loadBackupConfig().then(value => { if (live && value) { setConfig(value); setSaved(true) } })
    void persistenceState().then(value => { if (live) setPersistence(value) })
    return () => { live = false }
  }, [])

  const attempt = async (task: () => Promise<void>) => {
    setWorking(true); setError(''); setNotice('')
    try { await task() } catch (reason) { setError(message(reason)) } finally { setWorking(false) }
  }
  const disabled = busy || working
  return <section className="panel settings-form" aria-label="Cloud backup">
    <h2>Cloud backup</h2>
    <p>Backs up profile <strong>{getActiveProfile().name}</strong> to a private GitHub repository you own, one commit per backup. A backup is made only when you press Back up now; nothing is backed up automatically, so check Last backed up below. You can keep studying while it runs.</p>
    <p className="small muted" role="status">Browser storage protection: {persistence === 'granted' ? 'persistent (the browser will not clear it automatically)' : persistence === 'denied' ? 'not granted; the browser may clear this data under storage pressure, so keep the backup current' : 'not supported by this browser'}.</p>
    <ScanSetupQr onStatus={(_text, error) => { if (!error) void loadBackupConfig().then(value => { if (value) { setConfig(value); setSaved(true) } }) }} />
    {saved && <ShowSetupQr config={config} />}
    <form className="settings-form" onSubmit={event => {
      event.preventDefault()
      void attempt(async () => { await saveBackupConfig(config); setSaved(true); setNotice('Backup connection saved.') })
    }}>
      <ConnectionFields config={config} onChange={setConfig} disabled={disabled} />
      <p className="small muted">The token is stored with this profile (IndexedDB and localStorage) and included in settings.yaml in the backup. Use a private repository.</p>
      <div className="button-row">
        <button className="button secondary" disabled={disabled}>Save connection</button>
        <button type="button" className="button primary" disabled={disabled || !saved} onClick={() => void attempt(async () => {
          const result = await runBackup()
          setNotice(result.lastBackupAt ? 'Backed up.' : '')
        })}><CloudUpload size={16} /> Back up now</button>
      </div>
    </form>
    <p className="small" role="status">{status.running ? 'Backing up… ' : ''}Last backed up: {when(status.lastBackupAt)}{status.lastCommit ? ` (commit ${status.lastCommit.slice(0, 7)})` : ''}</p>
    {status.lastError && <p className="notice error" role="alert">Last backup error: {status.lastError}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <button type="button" className="button secondary" disabled={disabled || !saved} onClick={() => setRestoring(value => !value)}>Restore from GitHub backup</button>
    {restoring && <RestorePicker config={config} />}
  </section>
}

/** Shown on the Overview when this profile has no data yet, so a fresh device can restore at once. */
export function RestoreOffer() {
  const [show, setShow] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    void Promise.all([isProfileEmpty(), loadBackupConfig()]).then(([empty]) => { if (live) setShow(empty) }, () => undefined)
    return () => { live = false }
  }, [])
  if (!show) return null
  return <section className="panel settings-form" aria-label="Restore from GitHub backup">
    <h2>Have a backup?</h2>
    <p>This profile is empty. If you backed it up to GitHub on another device or browser, restore it now.</p>
    <button type="button" className="button secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>Restore from GitHub backup</button>
    {open && <RestoreFromBackup />}
  </section>
}
