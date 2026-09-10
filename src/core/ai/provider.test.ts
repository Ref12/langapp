import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLocalData, db } from '../database'
import { requestChatCompletion } from './provider'

beforeEach(async () => {
  await clearLocalData()
  await db.aiConnections.put({
    id: 'default', baseUrl: 'https://example.test', apiKey: 'test-key', model: 'test-model',
    configurationVersion: 1, warningAcknowledged: true, updatedAt: new Date().toISOString(),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('LLM cancellation', () => {
  it('never calls fetch for an already-aborted signal', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    controller.abort()
    await expect(requestChatCompletion([], controller.signal)).rejects.toThrow('cancelled')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps cancellation connected while reading the response body', async () => {
    const controller = new AbortController()
    let bodyStarted!: () => void
    const started = new Promise<void>(resolve => { bodyStarted = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        bodyStarted()
      }),
    })))
    const request = requestChatCompletion([], controller.signal)
    await started
    controller.abort()
    await expect(request).rejects.toThrow('cancelled')
  })
  it('does not echo provider payloads in error messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: () => 'secret-content' })))
    await expect(requestChatCompletion([])).rejects.toThrow('AI request failed (401)')
  })
})
