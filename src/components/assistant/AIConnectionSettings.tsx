import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { aiConnectionInputSchema, type AIConnection } from '../../core/assistant/contracts'
import { removeAIConnection, saveAIConnection } from '../../core/assistant/store'
import { testAIConnection } from '../../core/ai/provider'

function ConnectionForm({ connection }: { connection?: AIConnection }) {
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(connection?.apiKey ?? '')
  const [model, setModel] = useState(connection?.model ?? '')
  const [nativeTools, setNativeTools] = useState(connection?.nativeTools ?? false)
  const [structuredOutput, setStructuredOutput] = useState(connection?.structuredOutput ?? false)
  const [acknowledged, setAcknowledged] = useState(Boolean(connection))
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  const input = () => aiConnectionInputSchema.parse({ baseUrl, apiKey, model, nativeTools, structuredOutput, storageAcknowledged: acknowledged })
  const perform = async (action: 'test' | 'save' | 'remove') => {
    setPending(true)
    setNotice('')
    setError('')
    try {
      if (action === 'remove') {
        await removeAIConnection()
        setNotice('AI connection removed from this device.')
      } else {
        const value = input()
        if (action === 'save') {
          await saveAIConnection(value)
          setNotice('AI connection saved on this device.')
        } else {
          controller.current = new AbortController()
          await testAIConnection(value, controller.current.signal)
          setNotice('Connection test succeeded with the selected capabilities. Save to use these settings.')
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The connection action could not be completed.')
    } finally {
      setPending(false)
      controller.current = undefined
    }
  }
  return <form className="panel settings-form" aria-label="Assistant AI connection" onSubmit={event => { event.preventDefault(); void perform('save') }}>
    <h2>Assistant AI connection</h2>
    <p className="small muted">Your conversations stay on this device. Sending a turn shares its relevant conversation, learning context, and selected text with your configured provider. Requests may incur provider charges.</p>
    <fieldset className="connection-fields" disabled={pending}>
      <label>API base URL<input type="url" required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" autoComplete="off" /></label>
      <label>API key<input type="password" required value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      <label>Model<input required value={model} onChange={event => setModel(event.target.value)} placeholder="Model identifier from your provider" autoComplete="off" /></label>
      <label className="toggle"><input type="checkbox" checked={nativeTools} onChange={event => setNativeTools(event.target.checked)} /> My endpoint supports native tool calling</label>
      <p className="small muted">Enables read-only word, lesson, and learning-context lookups. No tools can change scores or save generated content.</p>
      <label className="toggle"><input type="checkbox" checked={structuredOutput} onChange={event => setStructuredOutput(event.target.checked)} /> My endpoint supports strict JSON-schema responses</label>
      <p className="small muted">Without this option, Assistant requests JSON and validates it locally. Unsupported capabilities produce an error; the app never silently switches protocols.</p>
      <label className="toggle"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand that the key is stored in plaintext browser storage and is accessible to code on this origin.</label>
      <p className="small muted">Credentials are excluded from backups. Use a restricted key. HTTPS is required except on localhost; your endpoint must allow browser CORS requests.</p>
    </fieldset>
    <div className="button-row">
      <button type="submit" className="button primary" disabled={pending}>Save AI connection</button>
      <button type="button" className="button secondary" disabled={pending} onClick={() => void perform('test')}>Test connection</button>
      {pending && <button type="button" className="button secondary" disabled={!controller.current} onClick={() => controller.current?.abort()}>Cancel test</button>}
      {connection && <button type="button" className="button secondary" disabled={pending} onClick={() => setRemoving(true)}>Remove connection</button>}
    </div>
    {removing && <div className="notice"><p>Remove this device's saved AI key and connection? Conversations and learning progress will remain.</p>
      <div className="button-row"><button type="button" className="button secondary" disabled={pending} onClick={() => void perform('remove')}>Confirm removal</button>
        <button type="button" className="button secondary" onClick={() => setRemoving(false)}>Keep connection</button></div>
    </div>}
    {notice && <p role="status" className="small">{notice}</p>}
    {error && <p role="alert" className="connection-error">{error}</p>}
  </form>
}

export function AIConnectionSettings() {
  const connections = useLiveQuery(() => db.aiConnections.toArray(), [])
  if (!connections) return <p role="status">Loading AI connection settings...</p>
  const connection = connections.find(item => item.id === 'assistant')
  return <section aria-label="AI connection settings">
    <p className="small muted" role="status">{connection ? `Saved AI connection: ${connection.model}` : 'No AI connection is saved on this device.'}</p>
    <ConnectionForm key={connection?.revision ?? 'unconfigured'} connection={connection} />
  </section>
}
