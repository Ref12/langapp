import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { exportBackup, MAX_BACKUP_BYTES, readBackup, restoreBackup } from '../core/backup'
import { savePreferences } from '../core/learning'
import { PageHeading, type PageProps } from '../components/shared'

export function Settings({ workspace, busy, run }: PageProps) {
  const [name, setName] = useState(workspace.preferences.name)
  const [notice, setNotice] = useState('')
  const [pendingBackup, setPendingBackup] = useState<{ text: string; name: string; words: number } | null>(null)
  return <>
    <PageHeading eyebrow="YOUR OWN PACE. YOUR OWN SPACE." title="Your workspace.">A local Mandarin learning space, separate from the original app.</PageHeading>
    <form className="panel settings-form" onSubmit={event => {
      event.preventDefault()
      void run(async () => { await savePreferences({ name }); setNotice('Workspace name saved.') })
    }}><h2>Make it yours</h2><label>Workspace name<input maxLength={80} required value={name} onChange={event => setName(event.target.value)} /></label>
      <p className="small muted">English / Mandarin (Simplified Chinese). Other languages will be added separately.</p>
      <button className="button primary" disabled={busy}>Save name</button>
    </form>
    <section className="panel settings-form"><h2>Reading and appearance</h2>
      <label>Theme<select disabled={busy} value={workspace.preferences.theme} onChange={event => {
        const theme = event.target.value === 'light' ? 'light' : 'dark'
        void run(() => savePreferences({ theme }))
      }}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label className="toggle"><input type="checkbox" disabled={busy} checked={workspace.preferences.pinyin} onChange={event => void run(() => savePreferences({ pinyin: event.target.checked }))} /> Show pinyin in reading and lessons</label>
      <p className="small muted">Practice hides pronunciation until you reveal the answer. Revealing is recorded as assistance.</p>
    </section>
    <section className="panel"><h2>Keep your learning safe</h2><p>Your progress is saved in this browser, not synced to an account. Clearing site data or using private browsing can remove it. Download a backup regularly.</p>
      <div className="button-row">
        <button className="button secondary" disabled={busy} onClick={() => void run(async () => {
          const text = exportBackup(workspace)
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
          const link = document.createElement('a')
          link.href = url
          link.download = `linguaweave-mandarin-${new Date().toISOString().slice(0, 10)}.json`
          link.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
          setNotice('Backup download started.')
        })}><Download size={16} /> Download backup</button>
        <label className="file-button button secondary"><Upload size={16} /> Choose backup<input type="file" accept=".json,application/json" disabled={busy} aria-label="Choose backup" onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setPendingBackup(null)
          void run(async () => {
            if (file.size > MAX_BACKUP_BYTES) throw new Error('The backup exceeds the 5 MiB limit.')
            const text = await file.text()
            const saved = readBackup(text)
            setPendingBackup({ text, name: saved.preferences.name, words: saved.words.length })
          })
        }} /></label>
      </div>
      {pendingBackup && <div className="notice"><h3>Replace this Mandarin workspace?</h3><p>This backup contains {pendingBackup.words} learning words in {pendingBackup.name}. Restoring replaces this workspace's progress and preferences. It does not change v1 data.</p>
        <div className="button-row"><button className="button primary" disabled={busy} onClick={() => void run(async () => {
          await restoreBackup(pendingBackup.text)
          setName(pendingBackup.name)
          setPendingBackup(null)
          setNotice('Mandarin workspace restored.')
        })}>Replace this workspace</button><button className="button secondary" disabled={busy} onClick={() => setPendingBackup(null)}>Cancel</button></div>
      </div>}
      <p className="small muted">Backups contain only this Mandarin workspace. v1 backups, recordings, credentials, and conversations are not imported here.</p>
    </section>
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="panel"><h2>About this checkpoint</h2><p>The real 30-level Mandarin course map, with beginner levels 1-4 available for small lessons, grammar reference, and reading-recognition practice. The original stories remain available. No communicative checkpoint assessment, live AI, pronunciation scoring, handwriting assessment, or official HSK certification is connected.</p>
      <div className="button-row"><a href="#curriculum-sources" className="button secondary">Curriculum sources and licenses</a><a href="./v1/" className="button secondary">Open original app (v1)</a><a href="./preview.html" className="button secondary">Open design mockups</a></div>
    </section>
  </>
}
