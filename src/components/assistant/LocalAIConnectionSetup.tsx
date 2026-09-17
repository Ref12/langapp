import { useEffect, useState, type ReactNode } from 'react'
import { initializeLocalAIConnection, type LocalAIConnectionResult } from '../../core/ai/local-connection'
import { LOCAL_SETTINGS_FILE } from '../../core/local-settings-contracts'

export function LocalAIConnectionSetup({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<LocalAIConnectionResult | 'loading' | 'error'>('loading')
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    initializeLocalAIConnection(controller.signal).then(
      value => { if (!disposed) setResult(value) },
      () => { if (!disposed) setResult('error') },
    ).finally(() => window.clearTimeout(timeout))
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [])
  if (result === 'loading') return <p role="status">Loading local Assistant configuration...</p>
  return <>
    {!dismissed && (result === 'loaded' || result === 'error') && <div className={`notice${result === 'error' ? ' error' : ''}`} data-assistant-exclude>
      <p role={result === 'error' ? 'alert' : 'status'}>{result === 'loaded'
        ? `Loaded the AI connection from ${LOCAL_SETTINGS_FILE} and saved it on this device. No AI request was sent.`
        : `Local AI setup could not be completed. Check ${LOCAL_SETTINGS_FILE} and browser storage, then reload, or configure the connection in Settings.`}
        {' '}<a href="#settings">AI connection settings</a></p>
      <button className="button secondary" onClick={() => setDismissed(true)}>Dismiss local AI notice</button>
    </div>}
    {children}
  </>
}
