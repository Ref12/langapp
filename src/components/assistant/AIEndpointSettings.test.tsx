import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { listAIEndpoints } from '../../core/assistant/endpoints'
import { AIConnectionSettings } from './AIConnectionSettings'
import { LocalAISetupContext } from './local-ai-setup-context'
import { resetProfileStorage } from '../../test/profile-storage'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn())
  await resetProfileStorage()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const show = () => render(<LocalAISetupContext.Provider value="unavailable"><AIConnectionSettings /></LocalAISetupContext.Provider>)

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, key: string, model: string) {
  const nameBox = screen.getByLabelText('Endpoint name')
  await user.clear(nameBox)
  await user.type(nameBox, name)
  await user.clear(screen.getByLabelText('API key'))
  await user.type(screen.getByLabelText('API key'), key)
  await user.clear(screen.getByLabelText('Model'))
  await user.type(screen.getByLabelText('Model'), model)
  const box = screen.getByRole('checkbox', { name: /I understand that the key/ })
  if (!(box as HTMLInputElement).checked) await user.click(box)
}

describe('AI endpoint settings', () => {
  it('adds endpoints with headers, switches the active one, duplicates, renames and deletes', async () => {
    const user = userEvent.setup()
    show()
    expect(await screen.findByText('No active AI endpoint is saved on this device.')).toBeInTheDocument()
    expect(screen.getByText(/CORS preflight/)).toBeInTheDocument()
    expect(screen.getByText(/custom header values in plaintext/)).toBeInTheDocument()
    await fill(user, 'Home', 'key-home', 'model-home')
    await user.click(screen.getByRole('button', { name: 'Add header' }))
    await user.type(screen.getByLabelText('Header name'), 'X-Team')
    await user.type(screen.getByLabelText('Header value'), 'blue')
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }))
    expect(await screen.findByText('Active AI endpoint: Home (model-home)')).toBeInTheDocument()
    expect((await db.aiConnections.get('assistant'))?.headers).toEqual([{ name: 'X-Team', value: 'blue' }])

    await user.click(screen.getByRole('button', { name: 'New endpoint' }))
    await fill(user, 'Work', 'key-work', 'model-work')
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }))
    await screen.findByText('Endpoint added on this device.')
    // The first endpoint stays active until chosen.
    expect(screen.getByText('Active AI endpoint: Home (model-home)')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Use Work' }))
    expect(await screen.findByText('Active AI endpoint: Work (model-work)')).toBeInTheDocument()
    expect((await db.aiConnections.get('assistant'))?.apiKey).toBe('key-work')
    expect((await listAIEndpoints()).endpoints.map(endpoint => endpoint.apiKey)).toEqual(['key-home', 'key-work'])

    await user.click(await screen.findByRole('button', { name: 'Duplicate' }))
    await screen.findByText('Endpoint duplicated. The copy is not active.')
    expect((await listAIEndpoints()).endpoints.map(endpoint => endpoint.name)).toEqual(['Home', 'Work', 'Work (copy)'])
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByLabelText('New name'))
    await user.type(screen.getByLabelText('New name'), 'Spare')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await screen.findByText('Endpoint renamed.')
    expect((await listAIEndpoints()).endpoints.map(endpoint => endpoint.name)).toEqual(['Home', 'Work', 'Spare'])

    await user.click(screen.getByRole('button', { name: 'Work' }))
    await user.click(screen.getByRole('button', { name: 'Delete endpoint' }))
    await user.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await screen.findByText('Endpoint removed from this device.')
    expect((await listAIEndpoints()).endpoints.map(endpoint => endpoint.name)).toEqual(['Home', 'Spare'])
    expect((await listAIEndpoints()).activeId).toBeDefined()
    expect(within(screen.getByRole('group', { name: 'Saved AI endpoints' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('refuses a header the app sets itself and saves nothing', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByLabelText('Endpoint name')
    await fill(user, 'Home', 'key-home', 'model-home')
    await user.click(screen.getByRole('button', { name: 'Add header' }))
    await user.type(screen.getByLabelText('Header name'), 'Authorization')
    await user.type(screen.getByLabelText('Header value'), 'Bearer x')
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await db.aiEndpoints.count()).toBe(0)
  })
})
