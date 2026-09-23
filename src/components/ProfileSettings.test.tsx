import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileSettings } from './ProfileSettings'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { clearUnsavedDrafts, rememberDraft } from '../core/assistant/drafts'
import * as speech from '../core/assistant/speech'
import * as profiles from '../core/profiles/store'
import * as local from '../core/profiles/local-client'
import { createEmptyProfile, serializeProfileYaml } from '../core/profiles/codec'
import { MAX_PROFILE_BYTES } from '../core/profiles/contracts'
import { LocalSpeechVoicesSetupContext } from './assistant/local-ai-setup-context'
import { Settings } from '../pages/Settings'
import * as assistantStore from '../core/assistant/store'
import * as speechStore from '../core/assistant/speech-connection'
import { exportWorkspaceBackup } from '../core/backup'

vi.mock('../core/profiles/store', () => ({
  getActiveProfile: vi.fn(), listProfiles: vi.fn(), createProfile: vi.fn(), selectProfile: vi.fn(),
  exportActiveProfile: vi.fn(), restoreActiveProfile: vi.fn(), importNewProfile: vi.fn(), markLocalSettingsImported: vi.fn(),
}))
vi.mock('../core/profiles/local-client', () => ({
  localProfilesAvailable: vi.fn(), listLocalProfiles: vi.fn(), readLocalProfile: vi.fn(), saveLocalProfile: vi.fn(),
}))

const active = { id: 'default', name: 'default' }
const other = { id: '8185cd97-7797-468d-84e2-e4850279bf12', name: 'Travel' }
const revision = '0'.repeat(64)
const key = 'synthetic-profile-test-key'
const reload = vi.fn()
let yaml: string

beforeEach(async () => {
  vi.resetAllMocks()
  clearUnsavedDrafts()
  await db.delete()
  await db.open()
  await initializeWorkspace()
  vi.mocked(profiles.getActiveProfile).mockReturnValue(active)
  vi.mocked(profiles.listProfiles).mockResolvedValue([active, other])
  vi.mocked(profiles.createProfile).mockResolvedValue(other)
  vi.mocked(profiles.importNewProfile).mockResolvedValue(other)
  vi.mocked(profiles.selectProfile).mockResolvedValue()
  vi.mocked(profiles.restoreActiveProfile).mockResolvedValue()
  vi.mocked(profiles.markLocalSettingsImported).mockResolvedValue()
  vi.mocked(local.localProfilesAvailable).mockReturnValue(false)
  vi.mocked(local.listLocalProfiles).mockResolvedValue([{ ...active, revision }])
  const snapshot = createEmptyProfile(active, { aiConnection: {
    baseUrl: 'https://provider.example/v1', apiKey: key, model: 'synthetic-model',
    nativeTools: false, structuredOutput: false, storageAcknowledged: true,
  } })
  yaml = serializeProfileYaml(snapshot)
  vi.mocked(profiles.exportActiveProfile).mockResolvedValue(yaml)
  vi.mocked(local.readLocalProfile).mockResolvedValue({ yaml, revision })
  vi.mocked(local.saveLocalProfile).mockResolvedValue({ profile: active, revision: '1'.repeat(64) })
})

afterEach(() => {
  cleanup()
  clearUnsavedDrafts()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function show() {
  return render(<ProfileSettings busy={false} reload={reload} />)
}

async function upload(text = yaml, size?: number) {
  const file = new File([text], 'profile.yaml', { type: 'application/yaml' })
  file.text = async () => text
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  await userEvent.setup().upload(screen.getByLabelText('Choose profile file'), file)
}

describe('profile controls', () => {
  it('waits for initial file settings before allowing profile operations', () => {
    render(<LocalSpeechVoicesSetupContext.Provider value="loading"><ProfileSettings busy={false} reload={reload} /></LocalSpeechVoicesSetupContext.Provider>)
    expect(screen.getByRole('button', { name: 'Download profile' })).toBeDisabled()
    expect(screen.getByLabelText('New profile name')).toBeDisabled()
    expect(screen.getByLabelText('Choose profile file')).toBeDisabled()
    expect(screen.getByText(/Finishing the initial local settings import/)).toBeInTheDocument()
    expect(profiles.exportActiveProfile).not.toHaveBeenCalled()
  })

  it('shows the default profile and credential warning without automatic file operations', async () => {
    show()
    expect(await screen.findByRole('option', { name: 'default' })).toBeInTheDocument()
    expect(screen.getByLabelText('Browser profile')).toHaveValue('default')
    expect(screen.getByText(/Every YAML export includes saved AI and speech API keys/)).toBeInTheDocument()
    expect(screen.getByText(/Browser storage is the live copy/)).toBeInTheDocument()
    expect(local.listLocalProfiles).not.toHaveBeenCalled()
    expect(profiles.exportActiveProfile).not.toHaveBeenCalled()
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
  })

  it.each([false, true])('creates a %s clone choice only on explicit submission and then switches', async clone => {
    show()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('New profile name'), 'Study')
    if (clone) await user.click(screen.getByRole('checkbox', { name: /Clone current profile/ }))
    expect(profiles.createProfile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Create and switch' }))
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(profiles.createProfile).toHaveBeenCalledWith('Study', clone)
    expect(profiles.selectProfile).toHaveBeenCalledWith(other.id, expect.any(AbortSignal))
  })

  it('does not switch when creation fails', async () => {
    vi.mocked(profiles.createProfile).mockRejectedValue(new Error('A profile with that name already exists.'))
    show()
    await userEvent.setup().type(screen.getByLabelText('New profile name'), 'default')
    fireEvent.click(screen.getByRole('button', { name: 'Create and switch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(profiles.selectProfile).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('requires confirmation before switching and stops playback first', async () => {
    const stop = vi.spyOn(speech, 'stopBrowserSpeech')
    show()
    const user = userEvent.setup()
    await screen.findByRole('option', { name: 'Travel' })
    await user.selectOptions(screen.getByLabelText('Browser profile'), other.id)
    await user.click(screen.getByRole('button', { name: 'Switch profile' }))
    expect(profiles.selectProfile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm switch' }))
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(stop).toHaveBeenCalled()
    expect(profiles.selectProfile).toHaveBeenCalledWith(other.id, expect.any(AbortSignal))
  })

  it('blocks exporting while a draft is unsaved rather than losing it', async () => {
    rememberDraft('synthetic-thread', 'Not saved yet')
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Download profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation draft')
    expect(profiles.exportActiveProfile).not.toHaveBeenCalled()
  })

  it('surfaces audio-stop failures before changing profiles', async () => {
    vi.spyOn(speech, 'stopBrowserSpeech').mockReturnValue('The browser could not stop speech.')
    show()
    await userEvent.setup().type(screen.getByLabelText('New profile name'), 'Study')
    fireEvent.click(screen.getByRole('button', { name: 'Create and switch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not stop speech')
    expect(profiles.createProfile).not.toHaveBeenCalled()
  })

  it('does not activate a newly created profile after the user navigates away', async () => {
    let finish!: (profile: typeof other) => void
    vi.mocked(profiles.createProfile).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = show()
    await userEvent.setup().type(screen.getByLabelText('New profile name'), 'Study')
    fireEvent.click(screen.getByRole('button', { name: 'Create and switch' }))
    await waitFor(() => expect(profiles.createProfile).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => finish(other))
    expect(profiles.selectProfile).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reports profile-list failures without inventing available profiles', async () => {
    vi.mocked(profiles.listProfiles).mockRejectedValue(new Error('Storage unavailable'))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not list browser profiles')
    expect(screen.getByLabelText('Browser profile')).toBeDisabled()
  })
})

describe('settings operation coordination', () => {
  it('blocks settings saves while a profile snapshot is being prepared', async () => {
    let finish!: (yaml: string) => void
    vi.mocked(profiles.exportActiveProfile).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = render(<Settings workspace={await loadWorkspace()} busy={false} now={Date.now()} run={operation => operation()} />)
    await screen.findByRole('button', { name: 'Save AI connection' })
    await screen.findByRole('button', { name: 'Save speech connection' })
    fireEvent.click(screen.getByRole('button', { name: 'Download profile' }))
    await waitFor(() => expect(profiles.exportActiveProfile).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Save AI connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save speech connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
    expect(screen.getByLabelText('Theme')).toBeDisabled()
    view.unmount()
    await act(async () => finish(yaml))
  })

  it.each(['AI', 'speech'] as const)('blocks profile changes during a pending %s connection save', async kind => {
    const ai = {
      baseUrl: 'https://provider.example/v1', apiKey: key, model: 'synthetic-model',
      nativeTools: false, structuredOutput: false, storageAcknowledged: true,
    } as const
    const speechConnection = { provider: 'azure', region: 'eastus', apiKey: key, storageAcknowledged: true } as const
    await assistantStore.saveAIConnection(ai)
    await speechStore.saveSpeechConnection(speechConnection)
    let finish!: () => void
    const waiting = new Promise<void>(resolve => { finish = resolve })
    if (kind === 'AI') vi.spyOn(assistantStore, 'saveAIConnection').mockReturnValue(waiting)
    else vi.spyOn(speechStore, 'saveSpeechConnection').mockReturnValue(waiting)
    render(<Settings workspace={await loadWorkspace()} busy={false} now={Date.now()} run={operation => operation()} />)
    const save = await screen.findByRole('button', { name: `Save ${kind} connection` })
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download profile' })).toBeDisabled())
    expect(screen.getByLabelText('New profile name')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
    await act(async () => finish())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download profile' })).toBeEnabled())
  })
})

describe('browser profile files', () => {
  it('restores legacy JSON only after confirmation and keeps saved credentials', async () => {
    const legacy = await exportWorkspaceBackup()
    const ai = {
      baseUrl: 'https://provider.example/v1', apiKey: key, model: 'synthetic-model',
      nativeTools: false, structuredOutput: false, storageAcknowledged: true,
    } as const
    await assistantStore.saveAIConnection(ai)
    await speechStore.saveSpeechConnection({ provider: 'azure', region: 'eastus', apiKey: key, storageAcknowledged: true })
    const savedAI = await db.aiConnections.get('assistant')
    const savedSpeech = await db.speechConnections.get('assistant-speech')
    show()
    await upload(legacy)
    expect(await screen.findByText(/This older JSON backup does not change saved credentials/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Replace current profile' }))
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(await db.aiConnections.get('assistant')).toEqual(savedAI)
    expect(await db.speechConnections.get('assistant-speech')).toEqual(savedSpeech)
    expect(await db.profileState.get('local-settings')).toEqual({ id: 'local-settings', imported: true })
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
  })

  it('downloads YAML including credentials and releases its object URL', async () => {
    const create = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:profile-test')
    const revoke = vi.fn()
    const OriginalURL = URL
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    })
    let download = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { download = this.download })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Download profile' }))
    await screen.findByText('Profile download started. The file includes credentials.')
    expect(download).toBe('linguaweave-default.yaml')
    const blob: Blob = create.mock.calls[0][0]
    expect(blob.type).toBe('application/yaml')
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read test blob'))
      reader.readAsText(blob)
    })
    expect(text).toContain(key)
    expect(text).toContain('knowledge:')
    expect(text).toContain('conversations:')
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:profile-test'), { timeout: 1500 })
  })

  it('previews uploaded YAML without applying it until replacement is confirmed', async () => {
    show()
    await upload()
    expect(await screen.findByRole('heading', { name: 'Import profile snapshot?' })).toBeInTheDocument()
    expect(screen.getByText(/Imported connection settings and credentials replace/)).toBeInTheDocument()
    expect(screen.queryByText(key)).not.toBeInTheDocument()
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Replace current profile' }))
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(profiles.restoreActiveProfile).toHaveBeenCalledWith(yaml, expect.any(AbortSignal))
  })

  it('imports as a new named profile without replacing the current profile', async () => {
    show()
    await upload()
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Imported profile name'))
    await user.type(screen.getByLabelText('Imported profile name'), 'Imported study')
    await user.click(screen.getByRole('button', { name: 'Import as new profile' }))
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(profiles.importNewProfile).toHaveBeenCalledWith(yaml, 'Imported study')
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
  })

  it.each(['format: [invalid', 'secret: synthetic-profile-test-key'])('rejects invalid YAML without exposing its contents (%#)', async text => {
    show()
    await upload(text)
    expect(await screen.findByRole('alert')).not.toHaveTextContent(key)
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Replace current profile' })).not.toBeInTheDocument()
  })

  it('bounds browser file size before reading it', async () => {
    show()
    await upload(yaml, MAX_PROFILE_BYTES + 1)
    expect(await screen.findByRole('alert')).toHaveTextContent('10 MiB')
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
  })

  it('aborts a pending restore on navigation and does not reload after a late result', async () => {
    let finish!: () => void
    vi.mocked(profiles.restoreActiveProfile).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = show()
    await upload()
    fireEvent.click(screen.getByRole('button', { name: 'Replace current profile' }))
    await waitFor(() => expect(profiles.restoreActiveProfile).toHaveBeenCalledOnce())
    const signal = vi.mocked(profiles.restoreActiveProfile).mock.calls[0][1]!
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => finish())
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('manual data-folder operations', () => {
  beforeEach(() => { vi.mocked(local.localProfilesAvailable).mockReturnValue(true) })

  it('uses the observed server revision and requires explicit overwrite confirmation', async () => {
    show()
    await screen.findByRole('option', { name: 'default (default.yaml)' })
    fireEvent.click(screen.getByRole('button', { name: 'Export to data folder' }))
    await screen.findByRole('heading', { name: 'Replace the server snapshot?' })
    expect(local.saveLocalProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm server export' }))
    await screen.findByText('Profile exported to the data folder, including credentials.')
    expect(local.saveLocalProfile).toHaveBeenCalledWith(yaml, revision, expect.any(AbortSignal))
  })

  it('uses create-only semantics when no server snapshot exists', async () => {
    vi.mocked(local.listLocalProfiles).mockResolvedValue([])
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Export to data folder' }))
    await screen.findByRole('heading', { name: 'Create the server snapshot?' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm server export' }))
    await waitFor(() => expect(local.saveLocalProfile).toHaveBeenCalledWith(yaml, null, expect.any(AbortSignal)))
  })

  it('reports conflicts and does not silently retry or overwrite a changed server file', async () => {
    vi.mocked(local.saveLocalProfile).mockRejectedValue(new Error('The server copy changed. Refresh the data-folder list.'))
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Export to data folder' }))
    await screen.findByRole('heading', { name: 'Replace the server snapshot?' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm server export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('server copy changed')
    expect(local.saveLocalProfile).toHaveBeenCalledOnce()
    expect(screen.queryByText('Profile exported to the data folder, including credentials.')).not.toBeInTheDocument()
  })

  it('reads a selected server file for review without automatically restoring it', async () => {
    show()
    await screen.findByRole('option', { name: 'default (default.yaml)' })
    await userEvent.setup().selectOptions(screen.getByLabelText('Server profile file'), 'default')
    fireEvent.click(screen.getByRole('button', { name: 'Import from data folder' }))
    await screen.findByRole('heading', { name: 'Import profile snapshot?' })
    expect(local.readLocalProfile).toHaveBeenCalledWith('default', expect.any(AbortSignal))
    expect(profiles.restoreActiveProfile).not.toHaveBeenCalled()
    expect(local.saveLocalProfile).not.toHaveBeenCalled()
  })
})
