import { useContext, useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { PageProps } from './shared'
import { db } from '../core/database'
import { restoreBackup } from '../core/backup'
import { hasUnsavedDrafts } from '../core/assistant/drafts'
import { interruptAudio } from '../core/assistant/audio-owner'
import { stopBrowserSpeech } from '../core/assistant/speech'
import { cancelAssistantRun } from '../core/assistant/runtime'
import { MAX_PROFILE_BYTES, type ProfileSnapshot } from '../core/profiles/contracts'
import { fromLegacyBackup, parseProfileYaml, serializeProfileYaml } from '../core/profiles/codec'
import type { ProfileMetadata } from '../core/profiles/identity'
import {
  createProfile, exportActiveProfile, getActiveProfile, importNewProfile,
  listProfiles, restoreActiveProfile, selectProfile,
} from '../core/profiles/store'
import {
  listLocalProfiles, localProfilesAvailable, readLocalProfile, saveLocalProfile, type LocalProfileFile,
} from '../core/profiles/local-client'
import { LocalAISetupContext, LocalSpeechSetupContext, LocalSpeechRateSetupContext, LocalSpeechVoicesSetupContext } from './assistant/local-ai-setup-context'

interface PendingImport {
  yaml: string
  snapshot: ProfileSnapshot
  legacy?: string
}

function requireSavedDrafts() {
  if (hasUnsavedDrafts()) throw new Error('Wait for your conversation draft to save, or retry its failed save, before changing or exporting profiles.')
}

async function stopForProfileChange() {
  requireSavedDrafts()
  interruptAudio()
  const failure = stopBrowserSpeech()
  if (failure) throw new Error(failure)
  const runs = await db.assistantRuns.where('status').equals('running').toArray()
  for (const threadId of new Set(runs.map(run => run.threadId))) await cancelAssistantRun(threadId)
  if (hasUnsavedDrafts()) throw new Error('A conversation draft is still being saved. Try again when it is saved.')
}

export function ProfileSettings({ busy, reload = () => window.location.reload(), onBusyChange }: Pick<PageProps, 'busy'> & {
  reload?: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const active = getActiveProfile()
  const [profiles, setProfiles] = useState<ProfileMetadata[]>([])
  const [selected, setSelected] = useState(active.id)
  const [name, setName] = useState('')
  const [clone, setClone] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [files, setFiles] = useState<LocalProfileFile[]>([])
  const [fileId, setFileId] = useState('')
  const [importing, setImporting] = useState<PendingImport>()
  const [importName, setImportName] = useState('')
  const [serverExport, setServerExport] = useState<{ yaml: string; revision: string | null }>()
  const controller = useRef<AbortController>()
  const mounted = useRef(false)
  const local = localProfilesAvailable()
  const aiSetup = useContext(LocalAISetupContext)
  const speechSetup = useContext(LocalSpeechSetupContext)
  const rateSetup = useContext(LocalSpeechRateSetupContext)
  const voiceSetup = useContext(LocalSpeechVoicesSetupContext)
  const bootstrapping = [aiSetup, speechSetup, rateSetup, voiceSetup].includes('loading')
  const disabled = busy || pending || bootstrapping

  useEffect(() => {
    mounted.current = true
    const abort = new AbortController()
    void listProfiles().then(value => {
      if (!abort.signal.aborted) setProfiles(value)
    }, () => { if (!abort.signal.aborted) setError('Could not list browser profiles. Reload to try again.') })
    if (local) void listLocalProfiles(abort.signal).then(value => {
      if (!abort.signal.aborted) setFiles(value)
    }, reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not list local profile files.') })
    return () => { mounted.current = false; abort.abort(); controller.current?.abort() }
  }, [local])

  const perform = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current || disabled) return
    const abort = new AbortController()
    controller.current = abort
    setPending(true)
    onBusyChange?.(true)
    setError('')
    setNotice('')
    try { await action(abort.signal) } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'The profile operation failed.')
    } finally {
      if (controller.current === abort) controller.current = undefined
      if (mounted.current) setPending(false)
      onBusyChange?.(false)
    }
  }

  const switchTo = async (id: string, signal: AbortSignal) => {
    await stopForProfileChange()
    signal.throwIfAborted()
    await selectProfile(id, signal)
    signal.throwIfAborted()
    window.location.hash = 'settings'
    reload()
  }

  const refreshFiles = async (signal: AbortSignal) => {
    const available = await listLocalProfiles(signal)
    signal.throwIfAborted()
    setFiles(available)
  }

  const preview = (text: string) => {
    let legacy = false
    if (text.trimStart().startsWith('{')) {
      try {
        const header: unknown = JSON.parse(text)
        legacy = typeof header === 'object' && header !== null && 'format' in header && header.format === 'linguaweave-next-backup'
      } catch { throw new Error('The selected JSON backup is invalid.') }
    }
    const snapshot = legacy ? fromLegacyBackup(text, active) : parseProfileYaml(text)
    setImporting({ snapshot, yaml: legacy ? serializeProfileYaml(snapshot) : text, ...(legacy ? { legacy: text } : {}) })
    setImportName(snapshot.profile.name)
    setServerExport(undefined)
  }

  return <section className="panel settings-form" aria-label="Profiles and backups">
    <h2>Profiles and backups</h2>
    <p>Current profile: <strong>{active.name}</strong>. Each profile has separate settings, knowledge, learning progress, conversations, and imported books.</p>
    <p className="small muted">Browser storage is the live copy. YAML files are manual snapshots, not automatic synchronization. Save unfinished settings edits before switching or exporting. Unsaved conversation drafts must be saved first.</p>
    {bootstrapping && <p role="status">Finishing the initial local settings import before profile operations...</p>}
    <label>Browser profile<select disabled={disabled || profiles.length === 0} value={selected} onChange={event => { setSelected(event.target.value); setSwitching(false) }}>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select></label>
    <button type="button" className="button secondary" disabled={disabled || selected === active.id} onClick={() => setSwitching(true)}>Switch profile</button>
    {switching && <div className="notice"><p>Switch profiles and reload the app? Audio and active Assistant requests will stop. Save unfinished settings edits first.</p>
      <div className="button-row"><button type="button" className="button primary" disabled={disabled} onClick={() => void perform(signal => switchTo(selected, signal))}>Confirm switch</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={() => setSwitching(false)}>Keep current profile</button></div>
    </div>}
    <form className="settings-form" onSubmit={event => {
      event.preventDefault()
      void perform(async signal => {
        await stopForProfileChange()
        signal.throwIfAborted()
        const profile = await createProfile(name, clone)
        signal.throwIfAborted()
        setProfiles(current => current.some(item => item.id === profile.id) ? current : [...current, profile])
        setSelected(profile.id)
        await switchTo(profile.id, signal)
      })
    }}>
      <label>New profile name<input required maxLength={80} value={name} disabled={disabled} onChange={event => setName(event.target.value)} /></label>
      <label className="toggle"><input type="checkbox" disabled={disabled} checked={clone} onChange={event => setClone(event.target.checked)} /> Clone current profile, including credentials, knowledge, and conversations</label>
      <p className="small muted">A fresh profile starts empty with default settings and no connections. Creating a profile switches to it and reloads the app.</p>
      <button type="submit" className="button primary" disabled={disabled || !name.trim()}>Create and switch</button>
    </form>
    <p className="notice">Every YAML export includes saved AI and speech API keys in plaintext, along with conversations and transcripts. Keep these files private. Raw recordings are never included.</p>
    <div className="button-row">
      <button type="button" className="button secondary" disabled={disabled} onClick={() => void perform(async signal => {
        requireSavedDrafts()
        signal.throwIfAborted()
        const yaml = await exportActiveProfile()
        signal.throwIfAborted()
        const url = URL.createObjectURL(new Blob([yaml], { type: 'application/yaml' }))
        try {
          const link = document.createElement('a')
          link.href = url
          link.download = `linguaweave-${active.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || active.id}.yaml`
          link.click()
        } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
        setNotice('Profile download started. The file includes credentials.')
      })}><Download size={16} /> Download profile</button>
      <label className="file-button button secondary"><Upload size={16} /> Choose profile file
        <input type="file" accept=".yaml,.yml,.json,application/yaml,text/yaml,application/json" aria-label="Choose profile file" disabled={disabled} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setImporting(undefined)
          setServerExport(undefined)
          void perform(async signal => {
            if (file.size > MAX_PROFILE_BYTES) throw new Error('The profile file exceeds the 10 MiB limit.')
            const text = await file.text()
            signal.throwIfAborted()
            preview(text)
          })
        }} />
      </label>
    </div>
    {local ? <>
      <h3>Local data folder</h3>
      <p className="small muted">Files are stored under data/ on this server and are excluded from Git. Saving here includes credentials and replaces only the selected profile's snapshot after confirmation.</p>
      <div className="button-row">
        <button type="button" className="button secondary" disabled={disabled} onClick={() => void perform(async signal => {
          await refreshFiles(signal)
          setServerExport(undefined)
          setNotice('Data-folder list refreshed.')
        })}>Refresh data-folder list</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={() => void perform(async signal => {
          requireSavedDrafts()
          signal.throwIfAborted()
          const yaml = await exportActiveProfile()
          signal.throwIfAborted()
          const available = await listLocalProfiles(signal)
          signal.throwIfAborted()
          setFiles(available)
          const current = available.find(file => file.id === active.id)
          setServerExport({ yaml, revision: current?.revision ?? null })
          setImporting(undefined)
        })}>Export to data folder</button>
      </div>
      <label>Server profile file<select value={fileId} disabled={disabled} onChange={event => setFileId(event.target.value)}>
        <option value="">Choose a snapshot</option>
        {files.map(file => <option value={file.id} key={file.id}>{file.name} ({file.id}.yaml)</option>)}
      </select></label>
      <button type="button" className="button secondary" disabled={disabled || !fileId} onClick={() => void perform(async signal => {
        const result = await readLocalProfile(fileId, signal)
        signal.throwIfAborted()
        preview(result.yaml)
      })}>Import from data folder</button>
      {serverExport && <div className="notice"><h3>{serverExport.revision ? 'Replace the server snapshot?' : 'Create the server snapshot?'}</h3>
        <p>Write {active.name} to data/{active.id}.yaml, including credentials? This saves the snapshot prepared when you clicked Export.</p>
        <div className="button-row"><button type="button" className="button primary" disabled={disabled} onClick={() => void perform(async signal => {
          requireSavedDrafts()
          signal.throwIfAborted()
          await saveLocalProfile(serverExport.yaml, serverExport.revision, signal)
          signal.throwIfAborted()
          setServerExport(undefined)
          setNotice('Profile exported to the data folder, including credentials.')
          await refreshFiles(signal)
        })}>Confirm server export</button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => setServerExport(undefined)}>Cancel export</button></div>
      </div>}
    </> : <p className="small muted">Data-folder operations require the local development server. Browser profile downloads and imports still work here.</p>}
    {importing && <div className="notice"><h3>Import profile snapshot?</h3>
      <p>{importing.snapshot.profile.name}: {importing.snapshot.knowledge.study.knowledge.length} knowledge items, {importing.snapshot.conversations.threads.length} conversations, {importing.snapshot.library.length} imported books. Replacing this profile replaces its settings, progress, conversation history, and personal library, including saved translations.</p>
      <p>{importing.legacy ? 'This older JSON backup does not change saved credentials.' : 'Imported connection settings and credentials replace the current profile connections. Missing connections are cleared.'} Imported requests never restart automatically.</p>
      <div className="button-row"><button type="button" className="button primary" disabled={disabled} onClick={() => void perform(async signal => {
        await stopForProfileChange()
        signal.throwIfAborted()
        if (importing.legacy) {
          await restoreBackup(importing.legacy, signal)
        } else await restoreActiveProfile(importing.yaml, signal)
        signal.throwIfAborted()
        window.location.hash = 'settings'
        reload()
      })}>Replace current profile</button>
        <button type="button" className="button secondary" disabled={disabled} onClick={() => setImporting(undefined)}>Cancel import</button></div>
      <label>Imported profile name<input maxLength={80} value={importName} disabled={disabled} onChange={event => setImportName(event.target.value)} /></label>
      <button type="button" className="button secondary" disabled={disabled || !importName.trim()} onClick={() => void perform(async signal => {
        await stopForProfileChange()
        signal.throwIfAborted()
        const profile = await importNewProfile(importing.yaml, importName)
        signal.throwIfAborted()
        setProfiles(current => current.some(item => item.id === profile.id) ? current : [...current, profile])
        setSelected(profile.id)
        await switchTo(profile.id, signal)
      })}>Import as new profile</button>
    </div>}
    {pending && <p className="small muted" role="status">Working on profile...</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
  </section>
}
