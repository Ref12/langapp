import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { saveAIConnection } from '../assistant/store'
import { LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../local-settings-contracts'
import { exportWorkspaceBackup } from '../backup'
import { initializeLocalAIConnection } from './local-connection'

const connection = {
  baseUrl: 'https://provider.example/v1/', apiKey: 'synthetic-local-test-key', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true,
} as const

beforeEach(async () => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
  vi.stubEnv('BASE_URL', '/')
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function respond(value: unknown = { aiConnection: connection }, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(value), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

const load = () => initializeLocalAIConnection(new AbortController().signal)

describe('automatic local AI connection setup', () => {
  it('loads an empty connection once, using only the local endpoint, and excludes the key from backups', async () => {
    const fetcher = respond()
    expect(await load()).toBe('loaded')
    const saved = await db.aiConnections.get('assistant')
    expect(saved).toMatchObject({ ...connection, baseUrl: 'https://provider.example/v1', id: 'assistant' })
    expect(saved?.revision).toBeTruthy()
    expect(await load()).toBe('existing')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(LOCAL_SETTINGS_PATH, expect.objectContaining({
      headers: { [LOCAL_SETTINGS_HEADER]: '1' }, cache: 'no-store', credentials: 'omit',
      mode: 'same-origin', redirect: 'error',
    }))
    expect(await exportWorkspaceBackup()).not.toContain(connection.apiKey)
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('does not fetch or replace an existing saved connection', async () => {
    await saveAIConnection({ ...connection, model: 'manually-saved' })
    const previous = await db.aiConnections.get('assistant')
    const fetcher = respond()
    expect(await load()).toBe('existing')
    expect(fetcher).not.toHaveBeenCalled()
    expect(await db.aiConnections.get('assistant')).toEqual(previous)
  })

  it('does not fetch without the dev-server flag or in production', async () => {
    const fetcher = respond()
    vi.stubEnv('DEV_LOCAL_SETTINGS', undefined)
    expect(await load()).toBe('unavailable')
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
    expect(await load()).toBe('unavailable')
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    vi.stubEnv('DEV', false)
    expect(await load()).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('allows no local file without creating a connection', async () => {
    respond({}, 404)
    expect(await load()).toBe('missing')
    expect(await db.aiConnections.count()).toBe(0)
  })

  it.each([
    { ...connection, storageAcknowledged: false },
    { ...connection, apiKey: '' },
    { ...connection, nativeTools: 'true' },
    { ...connection, baseUrl: 'http://provider.example/v1' },
  ])('rejects invalid settings rather than silently saving them (case %#)', async value => {
    respond({ aiConnection: value })
    await expect(load()).rejects.toThrow('invalid')
    expect(await db.aiConnections.count()).toBe(0)
  })

  it('reports server failures without using the response body as an error message', async () => {
    respond({ error: connection.apiKey }, 500)
    await expect(load()).rejects.toThrow('Check app.settings.jsonc')
    expect(await db.aiConnections.count()).toBe(0)
  })

  it.each(['not JSON', ' '.repeat(32001)])('rejects malformed or oversized local responses (case %#)', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))
    await expect(load()).rejects.toThrow()
    expect(await db.aiConnections.count()).toBe(0)
  })

  it('serializes competing initial loads without replacing the first saved revision', async () => {
    respond()
    const results = await Promise.all([load(), load()])
    expect(results.sort()).toEqual(['existing', 'loaded'])
    expect(await db.aiConnections.count()).toBe(1)
  })

  it('keeps a manual save made while the local request is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      await saveAIConnection({ ...connection, model: 'manual-wins' })
      return new Response(JSON.stringify({ aiConnection: connection }))
    }))
    expect(await load()).toBe('existing')
    expect((await db.aiConnections.get('assistant'))?.model).toBe('manual-wins')
  })

  it('does not save a response after cancellation, even if fetch ignores abort', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort()
      return new Response(JSON.stringify({ aiConnection: connection }))
    }))
    await expect(initializeLocalAIConnection(controller.signal)).rejects.toThrow()
    expect(await db.aiConnections.count()).toBe(0)
  })

  it('rolls back failed storage writes instead of claiming setup succeeded', async () => {
    respond()
    vi.spyOn(db.aiConnections, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(load()).rejects.toThrow('Storage full')
    expect(await db.aiConnections.count()).toBe(0)
  })

  it('rolls back a write if setup is cancelled during persistence', async () => {
    respond()
    const controller = new AbortController()
    const put = db.aiConnections.put.bind(db.aiConnections)
    vi.spyOn(db.aiConnections, 'put').mockImplementation(value => {
      controller.abort()
      return put(value)
    })
    await expect(initializeLocalAIConnection(controller.signal)).rejects.toThrow()
    expect(await db.aiConnections.count()).toBe(0)
  })

  it('leaves AI unconfigured when the optional section is absent', async () => {
    respond({})
    expect(await load()).toBe('missing')
    expect(await db.aiConnections.count()).toBe(0)
  })

  it('imports the selected protocol without testing or calling the provider', async () => {
    const fetcher = respond({ aiConnection: { ...connection, apiType: 'responses' } })
    expect(await load()).toBe('loaded')
    expect((await db.aiConnections.get('assistant'))?.apiType).toBe('responses')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
