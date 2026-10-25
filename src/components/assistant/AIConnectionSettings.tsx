import { useContext, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { aiApiTypeSchema, aiConnectionInputSchema, aiEndpointNameSchema, MAX_AI_ENDPOINTS, MAX_AI_HEADERS, type AIAPIType, type AIEndpoint, type AIHeader } from '../../core/assistant/contracts'
import { LOCAL_SETTINGS_FILE } from '../../core/local-settings-contracts'
import { addAIEndpoint, deleteAIEndpoint, duplicateAIEndpoint, listAIEndpoints, renameAIEndpoint, setActiveAIEndpoint, updateAIEndpoint, type AIEndpointList } from '../../core/assistant/endpoints'
import { testAIConnection } from '../../core/ai/provider'
import { testStructuredJSONConnection } from '../../core/ai/structured'
import { LocalAISetupContext } from './local-ai-setup-context'

interface ConnectionSettingsProps {
  busy?: boolean
  onBusyChange?: (busy: boolean) => void
}

function HeadersEditor({ headers, onChange }: { headers: AIHeader[]; onChange: (headers: AIHeader[]) => void }) {
  const update = (index: number, patch: Partial<AIHeader>) => onChange(headers.map((header, i) => i === index ? { ...header, ...patch } : header))
  return <div className="connection-headers" role="group" aria-label="Additional headers">
    <p><strong>Additional headers</strong></p>
    <p className="small muted">Sent on every request to this endpoint, for streaming and non-streaming calls and every API protocol. Content-Type and Authorization are set by the app and cannot be customized, and browser-restricted headers (such as Host, Cookie, Origin, Proxy-* and Sec-*) are refused. Custom headers make browsers send a CORS preflight request, so your endpoint must allow these headers in Access-Control-Allow-Headers.</p>
    {headers.map((header, index) => <div className="button-row" key={index}>
      <label>Header name<input value={header.name} onChange={event => update(index, { name: event.target.value })} placeholder="X-Example" autoComplete="off" spellCheck={false} /></label>
      <label>Header value<input type="password" value={header.value} onChange={event => update(index, { value: event.target.value })} autoComplete="off" spellCheck={false} /></label>
      <button type="button" className="button secondary" aria-label={`Remove header ${header.name || index + 1}`} onClick={() => onChange(headers.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <button type="button" className="button secondary" disabled={headers.length >= MAX_AI_HEADERS} onClick={() => onChange([...headers, { name: '', value: '' }])}>Add header</button>
  </div>
}

function ConnectionForm({ connection, active, defaultName, busy, onBusyChange, onSelect, onMessage }: ConnectionSettingsProps & { connection?: AIEndpoint; active: boolean; defaultName: string; onSelect: (id: string | undefined) => void; onMessage: (message: string) => void }) {
  const [name, setName] = useState(connection?.name ?? defaultName)
  const [headers, setHeaders] = useState<AIHeader[]>(connection?.headers ?? [])
  const [apiType, setApiType] = useState<AIAPIType>(connection?.apiType ?? 'chat-completions')
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
  const input = () => aiConnectionInputSchema.parse({ apiType, baseUrl, apiKey, model, nativeTools, structuredOutput, headers, storageAcknowledged: acknowledged })
  const perform = async (action: 'test' | 'save' | 'remove') => {
    if (busy || pending) return
    setPending(true)
    onBusyChange?.(true)
    setNotice('')
    setError('')
    try {
      if (action === 'remove') {
        if (connection) await deleteAIEndpoint(connection.id)
        onSelect(undefined)
        onMessage('Endpoint removed from this device.')
      } else {
        const value = input()
        if (action === 'save') {
          const safeName = aiEndpointNameSchema.parse(name)
          if (connection) {
            await updateAIEndpoint(connection.id, value, safeName)
            onMessage(active ? 'Endpoint saved on this device.' : 'Endpoint saved. It is not the active endpoint.')
          } else {
            const created = await addAIEndpoint(safeName, value)
            onSelect(created.id)
            onMessage('Endpoint added on this device.')
          }
        } else {
          controller.current = new AbortController()
          await testAIConnection(value, controller.current.signal)
          if (value.structuredOutput) await testStructuredJSONConnection(value, controller.current.signal)
          setNotice('Connection test succeeded with the selected capabilities. Save to use these settings.')
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The connection action could not be completed.')
    } finally {
      setPending(false)
      onBusyChange?.(false)
      controller.current = undefined
    }
  }
  return <form className="panel settings-form" aria-label="Assistant AI connection" onSubmit={event => { event.preventDefault(); void perform('save') }}>
    <h2>Assistant AI connection{connection ? `: ${connection.name}` : ': new endpoint'}</h2>
    <p className="small muted">Your conversations stay on this device. Sending a turn shares its relevant conversation, learning context, and selected text with your configured provider. Requests may incur provider charges.</p>
    <fieldset className="connection-fields" disabled={pending || busy}>
      <label>Endpoint name<input required value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="For example, Local model" autoComplete="off" /></label>
      <label>API protocol<select value={apiType} onChange={event => setApiType(aiApiTypeSchema.parse(event.target.value))}>
        <option value="chat-completions">Chat Completions</option>
        <option value="responses">Responses API</option>
      </select></label>
      <p className="small muted">Select the API your endpoint supports. The app never silently switches protocols.</p>
      <label>API base URL<input type="url" required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" autoComplete="off" /></label>
      <label>API key<input type="password" required value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      <label>Model<input required value={model} onChange={event => setModel(event.target.value)} placeholder="Model identifier from your provider" autoComplete="off" /></label>
      <label className="toggle"><input type="checkbox" checked={nativeTools} onChange={event => setNativeTools(event.target.checked)} /> My endpoint supports native tool calling</label>
      <p className="small muted">Enables read-only word, lesson, and learning-context lookups. No tools can change scores or save generated content.</p>
      <label className="toggle"><input type="checkbox" checked={structuredOutput} onChange={event => setStructuredOutput(event.target.checked)} /> My endpoint supports strict JSON-schema responses</label>
      <p className="small muted">Applies to generated exercises, reading translations, and generated game content. Assistant replies always use compact YAML validated locally, without JSON-schema mode. Testing this option sends an additional synthetic JSON request.</p>
      <HeadersEditor headers={headers} onChange={setHeaders} />
      <label className="toggle"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand that the key and any custom header values are stored in plaintext browser storage and is accessible to code on this origin.</label>
      <p className="small muted">Profile YAML exports include this key and all custom header values in plaintext. Keep exported files private and use a restricted key. HTTPS is required except on localhost; your endpoint must allow browser CORS requests.</p>
    </fieldset>
    <div className="button-row">
      <button type="submit" className="button primary" disabled={pending || busy}>{connection ? 'Save endpoint' : 'Add endpoint'}</button>
      <button type="button" className="button secondary" disabled={pending || busy} onClick={() => void perform('test')}>Test connection</button>
      {pending && <button type="button" className="button secondary" disabled={!controller.current} onClick={() => controller.current?.abort()}>Cancel test</button>}
      {connection && <button type="button" className="button secondary" disabled={pending || busy} onClick={() => setRemoving(true)}>Delete endpoint</button>}
    </div>
    {removing && <div className="notice"><p>Delete this endpoint, including its saved key and headers? Conversations and learning progress will remain.</p>
      <div className="button-row"><button type="button" className="button secondary" disabled={pending || busy} onClick={() => void perform('remove')}>Confirm removal</button>
        <button type="button" className="button secondary" disabled={pending || busy} onClick={() => setRemoving(false)}>Keep endpoint</button></div>
    </div>}
    {notice && <p role="status" className="small">{notice}</p>}
    {error && <p role="alert" className="connection-error">{error}</p>}
  </form>
}

export function AIConnectionSettings({ busy, onBusyChange }: ConnectionSettingsProps = {}) {
  const localSetup = useContext(LocalAISetupContext)
  const list = useLiveQuery<AIEndpointList | undefined>(() => localSetup === 'loading' ? undefined : listAIEndpoints(), [localSetup])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | undefined>()
  const [renameValue, setRenameValue] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  if (localSetup === 'loading') return <section aria-label="AI connection settings"><p role="status">Loading local Assistant configuration...</p></section>
  if (!list) return <p role="status">Loading AI connection settings...</p>
  const { endpoints, activeId } = list
  const selected = creating ? undefined : endpoints.find(endpoint => endpoint.id === selectedId) ?? endpoints.find(endpoint => endpoint.id === activeId) ?? endpoints[0]
  const active = endpoints.find(endpoint => endpoint.id === activeId)
  const act = async (work: () => Promise<void>, done: string) => {
    if (busy) return
    setMessage('')
    setError('')
    try { await work(); setMessage(done) } catch (reason) { setError(reason instanceof Error ? reason.message : 'The endpoint action could not be completed.') }
  }
  const select = (id: string | undefined) => { setCreating(false); setSelectedId(id) }
  return <section aria-label="AI connection settings">
    {(localSetup === 'loaded' || localSetup === 'error') && <p className={localSetup === 'error' ? 'small connection-error' : 'small muted'} role={localSetup === 'error' ? 'alert' : 'status'}>
      {localSetup === 'loaded'
        ? `Loaded the AI connection from ${LOCAL_SETTINGS_FILE} and saved it on this device. No AI request was sent.`
        : `Local AI setup could not be completed. Check ${LOCAL_SETTINGS_FILE} and browser storage, then reload, or configure the connection below.`}
    </p>}
    <p className="small muted" role="status">{active ? `Active AI endpoint: ${active.name} (${active.model})` : 'No active AI endpoint is saved on this device.'}</p>
    {import.meta.env.DEV && import.meta.env.DEV_LOCAL_SETTINGS === 'true' && <p className="small muted">The default profile can load aiConnection from {LOCAL_SETTINGS_FILE} once during initial setup when no connection is saved. Later file changes require an explicit profile import; removing a connection here keeps it removed across reloads.</p>}
    <div className="panel settings-form" role="group" aria-label="Saved AI endpoints">
      <h2>AI endpoints</h2>
      <p className="small muted">Save several endpoints and choose which one the Assistant, exercises, translations and games use. Switching never changes the others.</p>
      <ul className="endpoint-list">
        {endpoints.map(endpoint => <li key={endpoint.id}>
          <button type="button" className="button secondary" aria-pressed={selected?.id === endpoint.id} onClick={() => select(endpoint.id)}>{endpoint.name}</button>
          {endpoint.id === activeId ? <strong className="small"> Active</strong> : <button type="button" className="button secondary" disabled={busy} aria-label={`Use ${endpoint.name}`} onClick={() => void act(() => setActiveAIEndpoint(endpoint.id), `${endpoint.name} is now the active endpoint.`)}>Use this endpoint</button>}
        </li>)}
      </ul>
      <div className="button-row">
        <button type="button" className="button secondary" disabled={busy || endpoints.length >= MAX_AI_ENDPOINTS} onClick={() => { setCreating(true); setMessage(''); setError('') }}>New endpoint</button>
        {selected && <button type="button" className="button secondary" disabled={busy || endpoints.length >= MAX_AI_ENDPOINTS} onClick={() => void act(async () => { select((await duplicateAIEndpoint(selected.id)).id) }, 'Endpoint duplicated. The copy is not active.')}>Duplicate</button>}
        {selected && <button type="button" className="button secondary" disabled={busy} onClick={() => { setRenaming(selected.id); setRenameValue(selected.name) }}>Rename</button>}
      </div>
      {renaming && <form className="button-row" onSubmit={event => { event.preventDefault(); void act(async () => { await renameAIEndpoint(renaming, renameValue); setRenaming(undefined) }, 'Endpoint renamed.') }}>
        <label>New name<input value={renameValue} maxLength={80} onChange={event => setRenameValue(event.target.value)} autoComplete="off" /></label>
        <button type="submit" className="button primary" disabled={busy}>Save name</button>
        <button type="button" className="button secondary" onClick={() => setRenaming(undefined)}>Cancel</button>
      </form>}
      {message && <p role="status" className="small">{message}</p>}
      {error && <p role="alert" className="connection-error">{error}</p>}
    </div>
    <ConnectionForm key={creating ? 'new' : `${selected?.id ?? 'none'}:${selected?.revision ?? ''}:${selected?.name ?? ''}`} connection={selected} active={selected?.id === activeId} defaultName={endpoints.length ? '' : 'Default'} busy={busy} onBusyChange={onBusyChange} onSelect={select} onMessage={text => { setError(''); setMessage(text) }} />
  </section>
}
