import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { saveAIConnection } from '../../core/assistant/store'
import { saveSpeechConnection } from '../../core/assistant/speech-connection'
import { LOCAL_SETTINGS_PATH } from '../../core/local-settings-contracts'
import { AIConnectionSettings } from './AIConnectionSettings'
import { LocalAIConnectionSetup } from './LocalAIConnectionSetup'
import { LocalSpeechSetupContext } from './local-ai-setup-context'
import { SpeechConnectionSettings } from './SpeechConnectionSettings'

const connection = {
  provider: 'azure', region: 'eastus', apiKey: 'synthetic-speech-settings-key', storageAcknowledged: true,
} as const
const aiConnection = {
  baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-ai-settings-key', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true,
} as const
const recognition = vi.fn()

beforeEach(async () => {
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
  vi.stubGlobal('fetch', vi.fn())
  recognition.mockClear()
  vi.stubGlobal('SpeechRecognition', recognition)
  vi.stubGlobal('MediaRecorder', vi.fn())
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function fillSpeech() {
  fireEvent.change(await screen.findByLabelText('Azure Speech region'), { target: { value: connection.region } })
  fireEvent.change(screen.getByLabelText('Azure Speech key'), { target: { value: connection.apiKey } })
  fireEvent.click(screen.getByRole('checkbox', { name: /speech key is stored in plaintext/ }))
}

function localImport(settings: unknown) {
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
  vi.stubEnv('BASE_URL', '/')
  const fetcher = vi.fn(async () => new Response(JSON.stringify(settings)))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('speech connection settings', () => {
  it('saves masked credentials with explicit acknowledgement and no service or recording calls', async () => {
    const user = userEvent.setup()
    render(<SpeechConnectionSettings />)
    await fillSpeech()
    expect(screen.getByLabelText('Azure Speech key')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('checkbox', { name: /speech key is stored in plaintext/ })).toBeRequired()
    expect(screen.getByText(/Opening these settings or saving a connection never records audio/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /test/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save speech connection' }))
    await screen.findByText('Speech connection saved on this device. The credentials have not been validated with Azure.')
    await screen.findByText('An Azure Speech connection is saved on this device.')
    expect(await db.speechConnections.get('assistant-speech')).toMatchObject(connection)
    expect(fetch).not.toHaveBeenCalled()
    expect(recognition).not.toHaveBeenCalled()
    expect(MediaRecorder).not.toHaveBeenCalled()
    expect(await db.assistantRuns.count()).toBe(0)
    expect(await db.assistantMessages.count()).toBe(0)
    for (const status of screen.getAllByRole('status')) {
      expect(status).not.toHaveTextContent(connection.apiKey)
      expect(status).not.toHaveTextContent(connection.region)
    }
    cleanup()
    render(<SpeechConnectionSettings />)
    expect(await screen.findByLabelText('Azure Speech region')).toHaveValue(connection.region)
    expect(screen.getByLabelText('Azure Speech key')).toHaveValue(connection.apiKey)
    expect(screen.getByRole('checkbox', { name: /speech key is stored in plaintext/ })).toBeChecked()
  })

  it('requires acknowledgement and validates fields before storing credentials', async () => {
    render(<SpeechConnectionSettings />)
    await screen.findByLabelText('Azure Speech region')
    fireEvent.change(screen.getByLabelText('Azure Speech region'), { target: { value: connection.region } })
    fireEvent.change(screen.getByLabelText('Azure Speech key'), { target: { value: connection.apiKey } })
    fireEvent.submit(screen.getByRole('form', { name: 'Practice speech connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('acknowledge plaintext storage')
    expect(await db.speechConnections.count()).toBe(0)
    fireEvent.click(screen.getByRole('checkbox', { name: /speech key is stored in plaintext/ }))
    fireEvent.change(screen.getByLabelText('Azure Speech region'), { target: { value: 'https://invalid-region.test' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Practice speech connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('valid Azure Speech region')
    expect(await db.speechConnections.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('confirms removal and preserves the independently saved AI connection', async () => {
    const user = userEvent.setup()
    await saveSpeechConnection(connection)
    await saveAIConnection(aiConnection)
    const savedAI = await db.aiConnections.get('assistant')
    render(<SpeechConnectionSettings />)
    await user.click(await screen.findByRole('button', { name: 'Remove speech connection' }))
    expect(await db.speechConnections.count()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Keep speech connection' }))
    expect(screen.queryByRole('button', { name: 'Confirm speech connection removal' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove speech connection' }))
    await user.click(screen.getByRole('button', { name: 'Confirm speech connection removal' }))
    await screen.findByText('Speech connection removed from this device.')
    await screen.findByText('No speech connection is saved on this device.')
    expect(await db.speechConnections.count()).toBe(0)
    expect(await db.aiConnections.get('assistant')).toEqual(savedAI)
    await waitFor(() => expect(screen.getByLabelText('Azure Speech key')).toHaveValue(''))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows sanitized save and removal storage failures without losing entered settings', async () => {
    const user = userEvent.setup()
    render(<SpeechConnectionSettings />)
    await fillSpeech()
    vi.spyOn(db.speechConnections, 'put').mockRejectedValueOnce(new Error(`Storage failed: ${connection.apiKey}`))
    await user.click(screen.getByRole('button', { name: 'Save speech connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(screen.getByRole('alert')).not.toHaveTextContent(connection.apiKey)
    expect(screen.getByLabelText('Azure Speech key')).toHaveValue(connection.apiKey)
    expect(await db.speechConnections.count()).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Save speech connection' }))
    await user.click(await screen.findByRole('button', { name: 'Remove speech connection' }))
    vi.spyOn(db.speechConnections, 'delete').mockRejectedValueOnce(new Error(connection.apiKey))
    await user.click(screen.getByRole('button', { name: 'Confirm speech connection removal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be removed')
    expect(screen.getByRole('alert')).not.toHaveTextContent(connection.apiKey)
    expect(await db.speechConnections.count()).toBe(1)
    expect(screen.queryByText('Speech connection removed from this device.')).not.toBeInTheDocument()
  })

  it('makes storage read failures visible without exposing the underlying error', async () => {
    vi.spyOn(db.speechConnections, 'get').mockRejectedValueOnce(new Error(connection.apiKey))
    render(<SpeechConnectionSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read')
    expect(screen.getByRole('alert')).not.toHaveTextContent(connection.apiKey)
    expect(screen.queryByRole('button', { name: 'Save speech connection' })).not.toBeInTheDocument()
  })

  it('reports local speech import errors in settings while still allowing manual setup', async () => {
    render(<LocalSpeechSetupContext.Provider value="error"><SpeechConnectionSettings /></LocalSpeechSetupContext.Provider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Local speech setup could not be completed')
    expect(screen.getByRole('button', { name: 'Save speech connection' })).toBeEnabled()
  })
})

describe('nonblocking independent startup statuses', () => {
  it('announces a speech-only import in speech settings, never as an AI import', async () => {
    const fetcher = localImport({ speechConnection: connection })
    render(<LocalAIConnectionSetup><AIConnectionSettings /><SpeechConnectionSettings /></LocalAIConnectionSetup>)
    await screen.findByText(/Loaded the speech connection from/)
    const ai = screen.getByRole('region', { name: 'AI connection settings' })
    const speech = screen.getByRole('region', { name: 'Speech connection settings' })
    expect(within(ai).queryByText(/Loaded the AI connection from/)).not.toBeInTheDocument()
    expect(within(ai).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(ai).getByText('No AI connection is saved on this device.')).toBeInTheDocument()
    expect(within(speech).getByLabelText('Azure Speech key')).toHaveValue(connection.apiKey)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(LOCAL_SETTINGS_PATH, expect.any(Object))
    expect(recognition).not.toHaveBeenCalled()
    expect(MediaRecorder).not.toHaveBeenCalled()
  })

  it('announces an AI-only import without reporting a missing speech section as an error', async () => {
    localImport({ aiConnection })
    render(<LocalAIConnectionSetup><AIConnectionSettings /><SpeechConnectionSettings /></LocalAIConnectionSetup>)
    await screen.findByText(/Loaded the AI connection from/)
    const speech = screen.getByRole('region', { name: 'Speech connection settings' })
    expect(within(speech).queryByText(/Loaded the speech connection from/)).not.toBeInTheDocument()
    expect(within(speech).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(speech).getByText('No speech connection is saved on this device.')).toBeInTheDocument()
  })

  it('keeps startup children available with no non-settings banner while loading, then aborts on unmount', async () => {
    localImport({})
    let respond: ((response: Response) => void) | undefined
    let signal: AbortSignal | undefined
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Promise<Response>(resolve => { respond = resolve })
    })
    vi.stubGlobal('fetch', fetcher)
    const view = render(<LocalAIConnectionSetup><h1>Learning stays available</h1></LocalAIConnectionSetup>)
    expect(screen.getByRole('heading', { name: 'Learning stays available' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { respond?.(new Response(JSON.stringify({ speechConnection: connection }))) })
    expect(await db.speechConnections.count()).toBe(0)
  })
})
