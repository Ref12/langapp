import { useContext, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { LOCAL_SETTINGS_FILE } from '../../core/local-settings-contracts'
import { removeSpeechConnection, saveSpeechConnection } from '../../core/assistant/speech-connection'
import { speechConnectionInputSchema, type SpeechConnection } from '../../core/assistant/speech-contracts'
import { LocalSpeechSetupContext } from './local-ai-setup-context'

function SpeechConnectionForm({ connection, onSaved }: { connection?: SpeechConnection; onSaved: (notice: string) => void }) {
  const [region, setRegion] = useState(connection?.region ?? '')
  const [apiKey, setApiKey] = useState(connection?.apiKey ?? '')
  const [acknowledged, setAcknowledged] = useState(Boolean(connection))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)

  const perform = async (action: 'save' | 'remove') => {
    setError('')
    onSaved('')
    setPending(true)
    try {
      if (action === 'remove') {
        await removeSpeechConnection()
        onSaved('Speech connection removed from this device.')
        setRemoving(false)
      } else {
        const input = speechConnectionInputSchema.safeParse({ provider: 'azure', region, apiKey, storageAcknowledged: acknowledged })
        if (!input.success) {
          setError('Enter a valid Azure Speech region and key, and acknowledge plaintext storage.')
          return
        }
        await saveSpeechConnection(input.data)
        onSaved('Speech connection saved on this device. The credentials have not been validated with Azure.')
      }
    } catch {
      setError(action === 'remove'
        ? 'The speech connection could not be removed. Check browser storage and try again.'
        : 'The speech connection could not be saved. Check browser storage and try again.')
    } finally {
      setPending(false)
    }
  }

  return <form className="panel settings-form" aria-label="Practice speech connection" onSubmit={event => { event.preventDefault(); void perform('save') }}>
    <h2>Practice speech connection</h2>
    <p className="small muted">Azure Speech is separate from your Assistant AI connection. With speech feedback enabled, explicit Listen and record practice sends your recording and the expected phrase to Azure for automatic pronunciation assessment. Provider charges may apply. Practice results are not sent to the AI tutor.</p>
    <fieldset className="connection-fields" disabled={pending}>
      <label>Speech provider<select value="azure" disabled><option value="azure">Azure Speech</option></select></label>
      <label>Azure Speech region<input required value={region} onChange={event => setRegion(event.target.value)} placeholder="eastus" autoComplete="off" spellCheck={false} /></label>
      <p className="small muted">Use the region identifier for the Azure Speech resource that issued your key.</p>
      <label>Azure Speech key<input type="password" required value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      <label className="toggle"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand that the speech key is stored in plaintext browser storage and is accessible to code on this origin.</label>
      <p className="small muted">Use a restricted key. Credentials and raw audio are excluded from backups. Without this connection, practice compares the recognized transcript locally rather than assessing pronunciation.</p>
    </fieldset>
    <p className="small muted">Opening these settings or saving a connection never records audio or contacts Azure. Saving validates the fields locally, not the key, region availability, or service access. Live assessment starts only when you explicitly record in Practice with speech feedback enabled.</p>
    <div className="button-row">
      <button type="submit" className="button primary" disabled={pending}>Save speech connection</button>
      {connection && <button type="button" className="button secondary" disabled={pending} onClick={() => setRemoving(true)}>Remove speech connection</button>}
    </div>
    {removing && <div className="notice"><p>Remove this device's saved Azure Speech key and connection? Conversations, practice results, learning progress, and the AI connection will remain.</p>
      <div className="button-row">
        <button type="button" className="button secondary" disabled={pending} onClick={() => void perform('remove')}>Confirm speech connection removal</button>
        <button type="button" className="button secondary" disabled={pending} onClick={() => setRemoving(false)}>Keep speech connection</button>
      </div>
    </div>}
    {error && <p role="alert" className="connection-error">{error}</p>}
  </form>
}

export function SpeechConnectionSettings() {
  const localSetup = useContext(LocalSpeechSetupContext)
  const [notice, setNotice] = useState('')
  const saved = useLiveQuery(async () => {
    if (localSetup === 'loading') return undefined
    try {
      return { connection: await db.speechConnections.get('assistant-speech'), error: false }
    } catch {
      return { connection: undefined, error: true }
    }
  }, [localSetup])
  if (localSetup === 'loading') return <section aria-label="Speech connection settings"><p role="status">Loading local speech configuration...</p></section>
  if (!saved) return <p role="status">Loading speech connection settings...</p>
  if (saved.error) return <section aria-label="Speech connection settings"><p role="alert" className="connection-error">Speech connection settings could not be read. Check browser storage and reload.</p></section>
  return <section aria-label="Speech connection settings">
    {(localSetup === 'loaded' || localSetup === 'error') && <p className={localSetup === 'error' ? 'small connection-error' : 'small muted'} role={localSetup === 'error' ? 'alert' : 'status'}>
      {localSetup === 'loaded'
        ? `Loaded the speech connection from ${LOCAL_SETTINGS_FILE} and saved it on this device. No recording or provider request was made.`
        : `Local speech setup could not be completed. Check ${LOCAL_SETTINGS_FILE} and browser storage, then reload, or configure the connection below.`}
    </p>}
    <p className="small muted" role="status">{saved.connection ? 'An Azure Speech connection is saved on this device.' : 'No speech connection is saved on this device.'}</p>
    {import.meta.env.DEV && import.meta.env.DEV_LOCAL_SETTINGS === 'true' && <p className="small muted">Local development can independently load speechConnection from {LOCAL_SETTINGS_FILE} on startup when no speech connection is saved. To apply changed file settings, remove the saved speech connection and reload. Remove speechConnection from the file too if you want speech assessment to stay unconfigured.</p>}
    <SpeechConnectionForm key={saved.connection?.revision ?? 'unconfigured'} connection={saved.connection} onSaved={setNotice} />
    {notice && <p role="status" className="small">{notice}</p>}
  </section>
}
