import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Settings as SettingsIcon, X } from 'lucide-react'
import { savePreferences } from '../core/learning'
import type { Workspace } from '../core/model'
import type { SpeechRate } from '../core/assistant/contracts'

import { PageSettingsEntryContext, PageSettingsSetContext, type PageSettingsEntry } from './page-settings-context'

/** Holds the settings the current page registered. */
export function PageSettingsProvider({ children }: { children: ReactNode }) {
  const [entry, set] = useState<PageSettingsEntry | null>(null)
  return <PageSettingsSetContext.Provider value={set}><PageSettingsEntryContext.Provider value={entry}>{children}</PageSettingsEntryContext.Provider></PageSettingsSetContext.Provider>
}

const RATES: SpeechRate[] = [0.25, 0.5, 0.75, 1, 1.25]

export function PageSettingsButton({ route, label, page, workspace, busy, run }: {
  route: string; label: string; page: string; workspace: Workspace; busy: boolean; run: (operation: () => Promise<void>) => Promise<void>
}) {
  const entry = useContext(PageSettingsEntryContext)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const { preferences } = workspace
  useEffect(() => { setOpen(false) }, [route])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  if (page === 'settings') return <a href="#settings" className="icon-button" aria-label="Workspace settings" aria-current="page"><SettingsIcon size={20} /></a>
  const vibration = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  return <span className="page-settings-anchor">
    <button ref={trigger} className="icon-button" aria-label="Workspace settings" aria-haspopup="dialog" aria-expanded={open} aria-controls="page-settings-sheet"
      onClick={() => setOpen(value => !value)}><SettingsIcon size={20} /></button>
    {open && <>
      <div className="page-settings-backdrop" data-testid="page-settings-backdrop" onClick={() => setOpen(false)} />
      <div id="page-settings-sheet" className="page-settings-sheet" role="dialog" aria-label="Page settings">
        <div className="page-settings-header"><h2>{entry ? (entry.title ?? label) : 'Settings'}</h2>
          <button className="icon-button" aria-label="Close settings" onClick={() => setOpen(false)}><X size={18} /></button></div>
        {entry && <div className="page-settings-body">{entry.content}</div>}
        <h3>Quick settings</h3>
        <div className="page-settings-body">
          <label className="toggle"><input type="checkbox" checked={preferences.theme === 'dark'} disabled={busy}
            onChange={event => void run(() => savePreferences({ theme: event.target.checked ? 'dark' : 'light' }))} /> Dark theme</label>
          <label className="page-settings-field">Default speech rate
            <select value={preferences.defaultSpeechRate ?? 1} disabled={busy}
              onChange={event => void run(() => savePreferences({ defaultSpeechRate: Number(event.target.value) as SpeechRate }))}>
              {RATES.map(rate => <option key={rate} value={rate}>{rate}x</option>)}</select></label>
          {vibration
            ? <label className="toggle"><input type="checkbox" checked={preferences.haptics !== false} disabled={busy}
              onChange={event => void run(() => savePreferences({ haptics: event.target.checked }))} /> Vibration feedback</label>
            : <p className="small muted">Vibration feedback: not available on this device</p>}
        </div>
        <a className="button secondary page-settings-all" href="#settings">All settings</a>
      </div>
    </>}
  </span>
}
