import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { createConversation, saveAIConnection, updateThread } from '../assistant/store'
import { LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../local-settings-contracts'
import { exportWorkspaceBackup, readBackup } from '../backup'
import { initializeLocalAIConnection, initializeLocalConnections } from './local-connection'
import { saveSpeechConnection } from '../assistant/speech-connection'
import { resetProfileStorage } from '../../test/profile-storage'

const connection = {
  baseUrl: 'https://provider.example/v1/', apiKey: 'synthetic-local-test-key', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true,
} as const
const speechConnection = {
  provider: 'azure', region: 'eastus', apiKey: 'synthetic-speech-import-key', storageAcknowledged: true,
} as const
const speechVoices = {
  'zh-Hans': { provider: 'edge', voice: 'zh-CN-YunjianNeural' },
  'en-US': { provider: 'edge', voice: 'en-US-ChristopherNeural' },
} as const
const browserEnglish = { voiceURI: 'local-english', name: 'English local', lang: 'en-US', localService: true }

beforeEach(async () => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
  vi.stubEnv('BASE_URL', '/')
  await resetProfileStorage()
  await initializeWorkspace()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function respond(value: unknown = { aiConnection: connection }, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(value), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

const load = () => initializeLocalAIConnection(new AbortController().signal)
const loadAll = () => initializeLocalConnections(new AbortController().signal)

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

  describe('independent local AI and speech setup', () => {
    it('imports missing speech even when AI is already saved', async () => {
      await saveAIConnection({ ...connection, model: 'manual-model' })
      const savedAI = await db.aiConnections.get('assistant')
      const fetcher = respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.75 })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'loaded', defaultSpeechRate: 'loaded', speechVoices: 'missing' })
      expect(await db.aiConnections.get('assistant')).toEqual(savedAI)
      expect(await db.speechConnections.get('assistant-speech')).toMatchObject(speechConnection)
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'existing', speechVoices: 'missing' })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(fetcher.mock.calls[0]).toEqual([LOCAL_SETTINGS_PATH, expect.objectContaining({
        mode: 'same-origin', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { [LOCAL_SETTINGS_HEADER]: '1' },
      })])
      expect(await db.assistantRuns.count()).toBe(0)
      expect(await db.assistantMessages.count()).toBe(0)
    })

    it('imports missing AI while preserving saved speech without a second provider request', async () => {
      await saveSpeechConnection({ ...speechConnection, region: 'westus' })
      const savedSpeech = await db.speechConnections.get('assistant-speech')
      const fetcher = respond({ aiConnection: connection, speechConnection })
      expect(await loadAll()).toEqual({ aiConnection: 'loaded', speechConnection: 'existing', defaultSpeechRate: 'missing', speechVoices: 'missing' })
      expect(await db.aiConnections.get('assistant')).toMatchObject({ model: connection.model })
      expect(await db.speechConnections.get('assistant-speech')).toEqual(savedSpeech)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it.each([
      [{}, 200, { aiConnection: 'missing', speechConnection: 'missing' }],
      [{}, 404, { aiConnection: 'missing', speechConnection: 'missing' }],
      [{ aiConnection: connection }, 200, { aiConnection: 'loaded', speechConnection: 'missing' }],
      [{ speechConnection }, 200, { aiConnection: 'missing', speechConnection: 'loaded' }],
    ])('treats absent optional sections as missing (case %#)', async (settings, status, expected) => {
      const fetcher = respond(settings, status)
      expect(await loadAll()).toEqual({ ...expected, defaultSpeechRate: 'missing', speechVoices: 'missing' })
      expect(await db.aiConnections.count()).toBe(expected.aiConnection === 'loaded' ? 1 : 0)
      expect(await db.speechConnections.count()).toBe(expected.speechConnection === 'loaded' ? 1 : 0)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('still fetches updated settings when both connections and an explicit default rate are saved', async () => {
      await saveAIConnection(connection)
      await saveSpeechConnection(speechConnection)
      await db.preferences.update('workspace', { defaultSpeechRate: 1 })
      const fetcher = respond({ defaultSpeechRate: 0.5 })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'loaded', speechVoices: 'missing' })
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.5)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('preserves both manual saves made while the local request was pending', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        await saveAIConnection({ ...connection, model: 'manual-model' })
        await saveSpeechConnection({ ...speechConnection, region: 'westus' })
        return new Response(JSON.stringify({ aiConnection: connection, speechConnection }))
      }))
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'missing', speechVoices: 'missing' })
      expect((await db.aiConnections.get('assistant'))?.model).toBe('manual-model')
      expect((await db.speechConnections.get('assistant-speech'))?.region).toBe('westus')
    })

    it('serializes competing speech imports without replacing the first saved revision', async () => {
      await saveAIConnection(connection)
      respond({ speechConnection })
      const revisions: string[] = []
      const put = db.speechConnections.put.bind(db.speechConnections)
      const spy = vi.spyOn(db.speechConnections, 'put').mockImplementation(value => {
        revisions.push(value.revision)
        return put(value)
      })
      const results = await Promise.all([loadAll(), loadAll()])
      expect(results.map(result => result.speechConnection).sort()).toEqual(['existing', 'loaded'])
      expect(spy).toHaveBeenCalledTimes(1)
      expect((await db.speechConnections.get('assistant-speech'))?.revision).toBe(revisions[0])
    })

    it.each(['aiConnection', 'speechConnection'] as const)('keeps the other import independent when %s storage fails', async failed => {
      respond({ aiConnection: connection, speechConnection })
      vi.spyOn(failed === 'aiConnection' ? db.aiConnections : db.speechConnections, 'put').mockRejectedValueOnce(new Error('Storage full'))
      expect(await loadAll()).toEqual({
        aiConnection: failed === 'aiConnection' ? 'error' : 'loaded',
        speechConnection: failed === 'speechConnection' ? 'error' : 'loaded',
        defaultSpeechRate: 'missing',
        speechVoices: 'missing',
      })
      expect(await db.aiConnections.count()).toBe(failed === 'aiConnection' ? 0 : 1)
      expect(await db.speechConnections.count()).toBe(failed === 'speechConnection' ? 0 : 1)
    })

    it('rolls back speech persistence when cancelled during its write', async () => {
      await saveAIConnection(connection)
      const savedAI = await db.aiConnections.get('assistant')
      respond({ speechConnection })
      const controller = new AbortController()
      const put = db.speechConnections.put.bind(db.speechConnections)
      vi.spyOn(db.speechConnections, 'put').mockImplementation(value => {
        controller.abort()
        return put(value)
      })
      await expect(initializeLocalConnections(controller.signal)).rejects.toThrow()
      expect(await db.speechConnections.count()).toBe(0)
      expect(await db.aiConnections.get('assistant')).toEqual(savedAI)
    })

    it('does not persist after cancellation while reading the response body', async () => {
      const controller = new AbortController()
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, status: 200, text: async () => {
          controller.abort()
          return JSON.stringify({ aiConnection: connection, speechConnection })
        },
      })))
      await expect(initializeLocalConnections(controller.signal)).rejects.toThrow()
      expect(await db.aiConnections.count()).toBe(0)
      expect(await db.speechConnections.count()).toBe(0)
    })

    it.each([
      { speechConnection: { ...speechConnection, storageAcknowledged: false } },
      { speechConnection: { ...speechConnection, region: 'https://not-a-region.test' } },
      { speechConnection: { ...speechConnection, apiKey: '' } },
      { speechConnection: { ...speechConnection, provider: 'unsupported' } },
      { aiConnection: { ...connection, storageAcknowledged: false } },
      { speechConnection, unsupported: true },
    ])('rejects invalid configuration without exposing credential values (case %#)', async settings => {
      respond(settings)
      const result = await loadAll()
      expect(result).toEqual({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error' })
      expect(JSON.stringify(result)).not.toContain(speechConnection.apiKey)
      expect(await db.aiConnections.count()).toBe(0)
      expect(await db.speechConnections.count()).toBe(0)
    })

    it('reports an import failure only for a missing connection, preserving saved status', async () => {
      await saveAIConnection(connection)
      respond({ error: speechConnection.apiKey }, 500)
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error' })
    })

    it.each(['invalid JSON', ' '.repeat(32001)])('rejects malformed and oversized bodies (case %#)', async body => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))
      expect(await loadAll()).toEqual({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error' })
      expect(await db.speechConnections.count()).toBe(0)
    })

    it('retains the dev-only flag, loopback restriction, and base-path safety', async () => {
      const fetcher = respond({ speechConnection })
      vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
      expect(await loadAll()).toEqual({ aiConnection: 'unavailable', speechConnection: 'unavailable', defaultSpeechRate: 'unavailable', speechVoices: 'unavailable' })
      vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
      vi.stubEnv('DEV', false)
      expect(await loadAll()).toEqual({ aiConnection: 'unavailable', speechConnection: 'unavailable', defaultSpeechRate: 'unavailable', speechVoices: 'unavailable' })
      vi.stubEnv('DEV', true)
      vi.stubGlobal('location', new URL('https://app.example/'))
      expect(await loadAll()).toEqual({ aiConnection: 'unavailable', speechConnection: 'unavailable', defaultSpeechRate: 'unavailable', speechVoices: 'unavailable' })
      expect(fetcher).not.toHaveBeenCalled()
      vi.stubGlobal('location', new URL('http://localhost:5173/'))
      vi.stubEnv('BASE_URL', '/mandarin/')
      expect(await loadAll()).toEqual({ aiConnection: 'missing', speechConnection: 'loaded', defaultSpeechRate: 'missing', speechVoices: 'missing' })
      expect(fetcher).toHaveBeenCalledWith(`/mandarin${LOCAL_SETTINGS_PATH}`, expect.any(Object))
    })
  })

  describe('independent default Mandarin speech rate import', () => {
    it('uses an imported default for new conversations without touching an existing conversation override', async () => {
      const existing = await createConversation()
      await updateThread(existing, { speechRate: 1.25 })
      const before = await db.assistantThreads.get(existing)
      respond({ defaultSpeechRate: 0.75 })
      expect((await loadAll()).defaultSpeechRate).toBe('loaded')
      const created = await createConversation()
      expect((await db.assistantThreads.get(created))?.speechRate).toBe(0.75)
      expect(await db.assistantThreads.get(existing)).toEqual(before)
    })

    it.each([0.5, 0.75, 1, 1.25])('imports rate-only settings (%s) even when both connections exist', async defaultSpeechRate => {
      await saveAIConnection(connection)
      await saveSpeechConnection(speechConnection)
      const ai = await db.aiConnections.get('assistant')
      const speech = await db.speechConnections.get('assistant-speech')
      const preferences = await db.preferences.get('workspace')
      const fetcher = respond({ defaultSpeechRate })
      const speak = vi.fn()
      const microphone = vi.fn()
      vi.stubGlobal('speechSynthesis', { speak })
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'loaded', speechVoices: 'missing' })
      expect(await db.preferences.get('workspace')).toEqual({ ...preferences, defaultSpeechRate })
      expect(await db.aiConnections.get('assistant')).toEqual(ai)
      expect(await db.speechConnections.get('assistant-speech')).toEqual(speech)
      db.close()
      await db.open()
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(defaultSpeechRate)
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'existing', speechVoices: 'missing' })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(speak).not.toHaveBeenCalled()
      expect(microphone).not.toHaveBeenCalled()
      expect(await db.assistantRuns.count()).toBe(0)
      expect(await db.assistantMessages.count()).toBe(0)
    })

    it('reapplies the explicit JSON preference while still importing both missing connections', async () => {
      await db.preferences.update('workspace', { defaultSpeechRate: 1.25 })
      respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.5 })
      expect(await loadAll()).toEqual({ aiConnection: 'loaded', speechConnection: 'loaded', defaultSpeechRate: 'loaded', speechVoices: 'missing' })
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.5)
    })

    it('reapplies the JSON rate without replacing unrelated preferences saved while the request is in flight', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        await db.preferences.update('workspace', { defaultSpeechRate: 1, name: 'Manual workspace' })
        return new Response(JSON.stringify({ defaultSpeechRate: 0.5 }))
      }))
      expect((await loadAll()).defaultSpeechRate).toBe('loaded')
      expect(await db.preferences.get('workspace')).toMatchObject({ defaultSpeechRate: 0.5, name: 'Manual workspace' })
    })

    it.each([{}, { aiConnection: connection }])('does not persist an implicit default when the key is omitted (case %#)', async settings => {
      const before = await db.preferences.get('workspace')
      const writes = vi.spyOn(db.preferences, 'put')
      respond(settings)
      expect((await loadAll()).defaultSpeechRate).toBe('missing')
      expect(await db.preferences.get('workspace')).toEqual(before)
      expect(await db.preferences.get('workspace')).not.toHaveProperty('defaultSpeechRate')
      expect(writes).not.toHaveBeenCalled()
    })

    it('reapplies a changed JSON default at the next startup for new chats without replacing saved connections or old chat rates', async () => {
      await saveAIConnection({ ...connection, model: 'manual-model' })
      await saveSpeechConnection({ ...speechConnection, region: 'westus' })
      const ai = await db.aiConnections.get('assistant')
      const speech = await db.speechConnections.get('assistant-speech')
      const firstFetch = respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.75 })
      expect((await loadAll()).defaultSpeechRate).toBe('loaded')
      const existingId = await createConversation()
      await updateThread(existingId, { speechRate: 1.25 })
      const existing = await db.assistantThreads.get(existingId)
      const previousDefaultId = await createConversation()
      const previousDefault = await db.assistantThreads.get(previousDefaultId)
      db.close()
      await db.open()
      const secondFetch = respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.5 })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'loaded', speechVoices: 'missing' })
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.5)
      const createdId = await createConversation()
      expect((await db.assistantThreads.get(createdId))?.speechRate).toBe(0.5)
      expect(await db.assistantThreads.get(existingId)).toEqual(existing)
      expect(await db.assistantThreads.get(previousDefaultId)).toEqual(previousDefault)
      expect(previousDefault?.speechRate).toBe(0.75)
      expect(await db.aiConnections.get('assistant')).toEqual(ai)
      expect(await db.speechConnections.get('assistant-speech')).toEqual(speech)
      expect(firstFetch).toHaveBeenCalledTimes(1)
      expect(secondFetch).toHaveBeenCalledTimes(1)
    })

    it.each([200, 404])('preserves the saved default when the key or file is omitted (HTTP %s)', async status => {
      await db.preferences.update('workspace', { defaultSpeechRate: 0.75 })
      const before = await db.preferences.get('workspace')
      const writes = vi.spyOn(db.preferences, 'put')
      respond({}, status)
      expect((await loadAll()).defaultSpeechRate).toBe('existing')
      expect(await db.preferences.get('workspace')).toEqual(before)
      expect(writes).not.toHaveBeenCalled()
    })

    it('preserves the saved default without fetching when development import is disabled', async () => {
      await db.preferences.update('workspace', { defaultSpeechRate: 0.75 })
      vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
      const fetcher = respond({ defaultSpeechRate: 0.5 })
      expect((await loadAll()).defaultSpeechRate).toBe('unavailable')
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.75)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('reports an invalid updated JSON rate even when a default was previously saved, without changing the saved rate', async () => {
      await saveAIConnection(connection)
      await saveSpeechConnection(speechConnection)
      await db.preferences.update('workspace', { defaultSpeechRate: 0.75 })
      respond({ defaultSpeechRate: 0.6 })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'error', speechVoices: 'error' })
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.75)
    })

    it('checks for a later speed-only configuration when both connections exist but the preference is absent', async () => {
      await saveAIConnection(connection)
      await saveSpeechConnection(speechConnection)
      respond({})
      expect((await loadAll()).defaultSpeechRate).toBe('missing')
      respond({ defaultSpeechRate: 0.5 })
      expect((await loadAll()).defaultSpeechRate).toBe('loaded')
    })

    it.each([0, 0.6, -1, 2, '0.75', null, true, {}, []])('rejects invalid rates strictly without changing preferences (case %#)', async defaultSpeechRate => {
      await saveAIConnection(connection)
      await saveSpeechConnection(speechConnection)
      const before = await db.preferences.get('workspace')
      respond({ defaultSpeechRate })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'error', speechVoices: 'error' })
      expect(await db.preferences.get('workspace')).toEqual(before)
    })

    it('rejects all imports before persistence if the rate is invalid', async () => {
      respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.6 })
      expect(await loadAll()).toEqual({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error' })
      expect(await db.aiConnections.count()).toBe(0)
      expect(await db.speechConnections.count()).toBe(0)
      expect(await db.preferences.get('workspace')).not.toHaveProperty('defaultSpeechRate')
    })

    it('serializes competing identical imports without duplicate preference writes', async () => {
      respond({ defaultSpeechRate: 0.75 })
      const writes = vi.spyOn(db.preferences, 'put')
      const results = await Promise.all([loadAll(), loadAll()])
      expect(results.map(result => result.defaultSpeechRate).sort()).toEqual(['existing', 'loaded'])
      expect(writes).toHaveBeenCalledTimes(1)
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.75)
    })

    it.each(['aiConnection', 'speechConnection', 'defaultSpeechRate'] as const)('keeps all imports independent when %s storage fails', async failed => {
      respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.5 })
      const table = failed === 'aiConnection' ? db.aiConnections : failed === 'speechConnection' ? db.speechConnections : db.preferences
      vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('Storage full'))
      expect(await loadAll()).toEqual({
        aiConnection: failed === 'aiConnection' ? 'error' : 'loaded',
        speechConnection: failed === 'speechConnection' ? 'error' : 'loaded',
        defaultSpeechRate: failed === 'defaultSpeechRate' ? 'error' : 'loaded',
        speechVoices: 'missing',
      })
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(failed === 'defaultSpeechRate' ? undefined : 0.5)
    })

    it('rolls back a default-rate write if cancelled during persistence', async () => {
      respond({ defaultSpeechRate: 0.75 })
      const controller = new AbortController()
      const put = db.preferences.put.bind(db.preferences)
      vi.spyOn(db.preferences, 'put').mockImplementation(value => {
        controller.abort()
        return put(value)
      })
      await expect(initializeLocalConnections(controller.signal)).rejects.toThrow()
      expect(await db.preferences.get('workspace')).not.toHaveProperty('defaultSpeechRate')
    })
  })

  describe('file-based voice selections', () => {
    it.each([speechVoices, { 'zh-Hans': speechVoices['zh-Hans'], 'en-US': browserEnglish }])('imports and persists real voice identities without playback or provider calls (case %#)', async voices => {
      const fetcher = respond({ speechVoices: voices })
      const speak = vi.fn()
      const audio = vi.fn()
      const microphone = vi.fn()
      vi.stubGlobal('speechSynthesis', { speak })
      vi.stubGlobal('Audio', audio)
      vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } })
      const writes = vi.spyOn(db.preferences, 'put')
      expect(await loadAll()).toEqual({ aiConnection: 'missing', speechConnection: 'missing', defaultSpeechRate: 'missing', speechVoices: 'loaded' })
      expect((await db.preferences.get('workspace'))?.speechVoices).toEqual(voices)
      db.close()
      await db.open()
      expect((await loadAll()).speechVoices).toBe('existing')
      expect(writes).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(fetcher).toHaveBeenCalledWith(LOCAL_SETTINGS_PATH, expect.any(Object))
      expect(speak).not.toHaveBeenCalled()
      expect(audio).not.toHaveBeenCalled()
      expect(microphone).not.toHaveBeenCalled()
      expect(readBackup(await exportWorkspaceBackup()).preferences.speechVoices).toEqual(voices)
    })

    it('reapplies only specified languages and preserves preferences saved during loading', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        await db.preferences.update('workspace', {
          name: 'Manual workspace', defaultSpeechRate: 1.25,
          speechVoices: { 'en-US': browserEnglish, 'zh-Hans': { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' } },
        })
        return new Response(JSON.stringify({ speechVoices: { 'zh-Hans': speechVoices['zh-Hans'] } }))
      }))
      expect((await loadAll()).speechVoices).toBe('loaded')
      expect(await db.preferences.get('workspace')).toMatchObject({
        name: 'Manual workspace', defaultSpeechRate: 1.25,
        speechVoices: { 'en-US': browserEnglish, 'zh-Hans': speechVoices['zh-Hans'] },
      })
    })

    it('reapplies a changed file on the next startup without overwriting saved connections or chat speed', async () => {
      await saveAIConnection(connection)
      await saveSpeechConnection(speechConnection)
      const ai = await db.aiConnections.get('assistant')
      const speech = await db.speechConnections.get('assistant-speech')
      const id = await createConversation()
      await updateThread(id, { speechRate: 1.25 })
      const thread = await db.assistantThreads.get(id)
      await db.preferences.update('workspace', { speechVoices: { 'en-US': browserEnglish } })
      respond({ aiConnection: { ...connection, model: 'file-model' }, speechConnection: { ...speechConnection, region: 'westus' }, defaultSpeechRate: 0.5, speechVoices })
      expect(await loadAll()).toEqual({ aiConnection: 'existing', speechConnection: 'existing', defaultSpeechRate: 'loaded', speechVoices: 'loaded' })
      expect(await db.preferences.get('workspace')).toMatchObject({ defaultSpeechRate: 0.5, speechVoices })
      expect(await db.assistantThreads.get(id)).toEqual(thread)
      expect(await db.aiConnections.get('assistant')).toEqual(ai)
      expect(await db.speechConnections.get('assistant-speech')).toEqual(speech)
      respond({ speechVoices: { 'en-US': browserEnglish } })
      expect((await loadAll()).speechVoices).toBe('loaded')
      expect((await db.preferences.get('workspace'))?.speechVoices).toEqual({ ...speechVoices, 'en-US': browserEnglish })
    })

    it.each([{}, { speechVoices: {} }, undefined])('does not write implicit voices when omitted (case %#)', async settings => {
      respond(settings ?? {}, settings ? 200 : 404)
      const before = await db.preferences.get('workspace')
      const writes = vi.spyOn(db.preferences, 'put')
      expect((await loadAll()).speechVoices).toBe('missing')
      expect(await db.preferences.get('workspace')).toEqual(before)
      expect(writes).not.toHaveBeenCalled()
      await db.preferences.update('workspace', { speechVoices })
      expect((await loadAll()).speechVoices).toBe('existing')
      expect((await db.preferences.get('workspace'))?.speechVoices).toEqual(speechVoices)
      expect(writes).not.toHaveBeenCalled()
    })

    it.each([
      null, [], { 'fr-FR': speechVoices['en-US'] },
      { 'zh-Hans': speechVoices['en-US'] }, { 'en-US': speechVoices['zh-Hans'] },
      { 'en-US': { provider: 'unknown', voice: 'en-US-ChristopherNeural' } },
      { 'en-US': { ...speechVoices['en-US'], url: 'https://untrusted.example/' } },
      { 'zh-Hans': { provider: 'edge', voice: 'not-a-voice' } },
      { 'en-US': { name: 'Incomplete browser voice' } },
    ])('rejects malformed selections before any persistence (case %#)', async voices => {
      await db.preferences.update('workspace', { speechVoices })
      const before = await db.preferences.get('workspace')
      respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.5, speechVoices: voices })
      expect(await loadAll()).toEqual({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error' })
      expect(await db.preferences.get('workspace')).toEqual(before)
      expect(await db.aiConnections.count()).toBe(0)
      expect(await db.speechConnections.count()).toBe(0)
    })

    it('serializes simultaneous imports without duplicate voice writes', async () => {
      respond({ speechVoices })
      const writes = vi.spyOn(db.preferences, 'put')
      const results = await Promise.all([loadAll(), loadAll()])
      expect(results.map(result => result.speechVoices).sort()).toEqual(['existing', 'loaded'])
      expect(writes).toHaveBeenCalledTimes(1)
    })

    it.each(['defaultSpeechRate', 'speechVoices'] as const)('isolates a failed %s write from the other preference and connections', async failed => {
      respond({ aiConnection: connection, speechConnection, defaultSpeechRate: 0.5, speechVoices })
      const put = db.preferences.put.bind(db.preferences)
      vi.spyOn(db.preferences, 'put').mockImplementation(value => {
        const voiceWrite = value.speechVoices !== undefined
        if (voiceWrite === (failed === 'speechVoices')) throw new Error('Storage full')
        return put(value)
      })
      expect(await loadAll()).toEqual({
        aiConnection: 'loaded', speechConnection: 'loaded',
        defaultSpeechRate: failed === 'defaultSpeechRate' ? 'error' : 'loaded',
        speechVoices: failed === 'speechVoices' ? 'error' : 'loaded',
      })
      expect((await db.preferences.get('workspace'))?.speechVoices).toEqual(failed === 'speechVoices' ? undefined : speechVoices)
      expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(failed === 'defaultSpeechRate' ? undefined : 0.5)
    })

    it('rolls back voice persistence when cancelled during the write', async () => {
      respond({ speechVoices })
      const controller = new AbortController()
      const put = db.preferences.put.bind(db.preferences)
      vi.spyOn(db.preferences, 'put').mockImplementation(value => {
        controller.abort()
        return put(value)
      })
      await expect(initializeLocalConnections(controller.signal)).rejects.toThrow()
      expect(await db.preferences.get('workspace')).not.toHaveProperty('speechVoices')
    })
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
    await expect(load()).rejects.toThrow('Check default.yaml')
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
