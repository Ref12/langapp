import { useState } from 'react'
import { collectDiagnostics } from '../core/backup/diagnostics'
import { getActiveProfile } from '../core/profiles/store'

/** Settings → Diagnostics: copies recent timings (startup, saves, backup runs) so real numbers can be pasted from a phone. */
export function Diagnostics() {
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const copy = async () => {
    const report = JSON.stringify(await collectDiagnostics(getActiveProfile().id), null, 2)
    setText(report)
    try { await navigator.clipboard.writeText(report); setNotice('Diagnostics copied.') } catch { setNotice('Copy is not available here; select the text below.') }
  }
  return <section className="panel settings-form" aria-label="Diagnostics">
    <h2>Diagnostics</h2>
    <p className="small muted">Timings of the last startups, Check answer and Next saves and cloud backups on this device. They contain no credentials, backup token or learning content.</p>
    <div className="button-row"><button type="button" className="button secondary" onClick={() => void copy()}>Copy diagnostics</button></div>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {text && <textarea readOnly rows={10} value={text} aria-label="Diagnostics report" />}
  </section>
}
