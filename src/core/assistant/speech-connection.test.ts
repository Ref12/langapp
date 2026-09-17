import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { saveAIConnection } from './store'
import { removeSpeechConnection, saveSpeechConnection } from './speech-connection'
import { speechConnectionSchema, type SpeechConnectionInput } from './speech-contracts'

const connection: SpeechConnectionInput = {
  provider: 'azure', region: 'eastus', apiKey: 'synthetic-speech-test-key', storageAcknowledged: true,
}

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn())
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('speech connection storage', () => {
  it('saves a validated snapshot and a fresh revision without contacting any provider', async () => {
    const input = { ...connection, region: ' eastus ', apiKey: ' synthetic-speech-test-key ' }
    const pending = saveSpeechConnection(input)
    input.region = 'westus'
    await pending
    const first = await db.speechConnections.get('assistant-speech')
    expect(first).toMatchObject({ ...connection, id: 'assistant-speech' })
    expect(speechConnectionSchema.safeParse(first).success).toBe(true)
    await saveSpeechConnection(connection)
    const second = await db.speechConnections.get('assistant-speech')
    expect(second?.revision).not.toBe(first?.revision)
    expect(await db.speechConnections.count()).toBe(1)
    expect(await db.aiConnections.count()).toBe(0)
    expect(await db.assistantMessages.count()).toBe(0)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { provider: 'other' }, { region: 'https://example.test' }, { region: '' },
    { apiKey: '' }, { apiKey: 'x'.repeat(4001) }, { storageAcknowledged: false },
    { extra: 'not-allowed' },
  ])('rejects invalid connection input without changing the saved snapshot (case %#)', async changes => {
    await saveSpeechConnection(connection)
    const saved = await db.speechConnections.get('assistant-speech')
    await expect(saveSpeechConnection({ ...connection, ...changes } as SpeechConnectionInput)).rejects.toThrow()
    expect(await db.speechConnections.get('assistant-speech')).toEqual(saved)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('removes only the speech connection, and can remove it twice safely', async () => {
    await saveSpeechConnection(connection)
    await saveAIConnection({
      baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-ai-key', model: 'test-model',
      nativeTools: false, structuredOutput: false, storageAcknowledged: true,
    })
    const preferences = await db.preferences.toArray()
    const ai = await db.aiConnections.toArray()
    await removeSpeechConnection()
    await removeSpeechConnection()
    expect(await db.speechConnections.count()).toBe(0)
    expect(await db.aiConnections.toArray()).toEqual(ai)
    expect(await db.preferences.toArray()).toEqual(preferences)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates storage errors rather than pretending a save or removal worked', async () => {
    vi.spyOn(db.speechConnections, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(saveSpeechConnection(connection)).rejects.toThrow('Storage full')
    expect(await db.speechConnections.count()).toBe(0)
    await saveSpeechConnection(connection)
    vi.spyOn(db.speechConnections, 'delete').mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(removeSpeechConnection()).rejects.toThrow('Storage unavailable')
    expect(await db.speechConnections.count()).toBe(1)
  })
})
