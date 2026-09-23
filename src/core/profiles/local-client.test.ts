import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile, serializeProfileYaml } from './codec'
import { MAX_PROFILE_BYTES } from './contracts'
import { LOCAL_PROFILES_HEADER, LOCAL_PROFILES_PATH } from './local-contracts'
import { listLocalProfiles, localProfilesAvailable, readLocalProfile, saveLocalProfile } from './local-client'

const profile = { id: 'default', name: 'default' }
const revision = 'a'.repeat(64)
const fetcher = vi.fn<typeof fetch>()
let yaml: string

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_PROFILES', 'true')
  vi.stubEnv('BASE_URL', '/')
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
  yaml = serializeProfileYaml(createEmptyProfile(profile))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('local profile client', () => {
  it('reads metadata through the protected same-origin endpoint under the configured base', async () => {
    vi.stubEnv('BASE_URL', '/langapp/')
    fetcher.mockResolvedValueOnce(json({ profiles: [{ ...profile, revision }] }))
    await expect(listLocalProfiles(new AbortController().signal)).resolves.toEqual([{ ...profile, revision }])
    expect(fetcher).toHaveBeenCalledWith(`/langapp${LOCAL_PROFILES_PATH}`, expect.objectContaining({
      method: 'GET', headers: { [LOCAL_PROFILES_HEADER]: '1' }, credentials: 'omit',
      mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
    }))
  })

  it('loads a validated profile plus its revision', async () => {
    fetcher.mockResolvedValueOnce(json({ yaml, revision }))
    await expect(readLocalProfile('default', new AbortController().signal)).resolves.toEqual({ yaml, revision })
    expect(fetcher.mock.calls[0][0]).toBe(`${LOCAL_PROFILES_PATH}/default`)
  })

  it.each([null, revision])('exports only on explicit request with the expected revision (%s)', async expectedRevision => {
    fetcher.mockResolvedValueOnce(json({ profile, revision }))
    await expect(saveLocalProfile(yaml, expectedRevision, new AbortController().signal)).resolves.toEqual({ profile, revision })
    expect(fetcher).toHaveBeenCalledWith(`${LOCAL_PROFILES_PATH}/default`, expect.objectContaining({
      method: 'PUT', headers: { [LOCAL_PROFILES_HEADER]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml, expectedRevision }),
    }))
  })

  it('rejects unsafe IDs and invalid YAML before sending requests', async () => {
    await expect(readLocalProfile('../private', new AbortController().signal)).rejects.toThrow('valid profile')
    await expect(saveLocalProfile('not a profile', null, new AbortController().signal)).rejects.toThrow()
    await expect(saveLocalProfile(yaml, 'untrusted', new AbortController().signal)).rejects.toThrow('Refresh')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not use local APIs in production, preview, or a non-loopback origin', async () => {
    vi.stubEnv('DEV', false)
    expect(localProfilesAvailable()).toBe(false)
    await expect(listLocalProfiles(new AbortController().signal)).rejects.toThrow('development server')
    vi.stubEnv('DEV', true)
    vi.stubEnv('DEV_LOCAL_PROFILES', 'false')
    expect(localProfilesAvailable()).toBe(false)
    vi.stubEnv('DEV_LOCAL_PROFILES', 'true')
    vi.stubGlobal('location', new URL('https://example.test/'))
    expect(localProfilesAvailable()).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not echo a server error body or retry a conflicting write', async () => {
    fetcher.mockResolvedValueOnce(json({ error: 'synthetic-secret' }, 409))
    await expect(saveLocalProfile(yaml, revision, new AbortController().signal)).rejects.toThrow('server copy changed')
    expect(fetcher).toHaveBeenCalledOnce()
    fetcher.mockResolvedValueOnce(json({ error: 'synthetic-secret' }, 500))
    await expect(listLocalProfiles(new AbortController().signal)).rejects.toThrow('HTTP 500')
  })

  it.each([
    { profiles: [{ id: '../bad', name: 'Invalid', revision }] },
    { profiles: [{ ...profile, revision: 'invalid' }] },
    { profiles: [] , secret: 'synthetic-secret' },
  ])('rejects invalid list responses (%#)', async value => {
    fetcher.mockResolvedValueOnce(json(value))
    await expect(listLocalProfiles(new AbortController().signal)).rejects.toThrow('list is invalid')
  })

  it('rejects a file with mismatched profile identity', async () => {
    const id = '8185cd97-7797-468d-84e2-e4850279bf12'
    fetcher.mockResolvedValueOnce(json({ yaml, revision }))
    await expect(readLocalProfile(id, new AbortController().signal)).rejects.toThrow('does not match')
  })

  it('does not claim a save succeeded when the response identifies another profile', async () => {
    fetcher.mockResolvedValueOnce(json({ profile: { id: '8185cd97-7797-468d-84e2-e4850279bf12', name: 'Other' }, revision }))
    await expect(saveLocalProfile(yaml, revision, new AbortController().signal)).rejects.toThrow('could not be confirmed')
  })

  it.each([
    () => new Response('secret', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('secret', { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects malformed content without reflecting it (%#)', async response => {
    fetcher.mockResolvedValueOnce(response())
    await expect(listLocalProfiles(new AbortController().signal)).rejects.toThrow(/invalid/)
  })

  it('sanitizes unexpected transport errors', async () => {
    fetcher.mockRejectedValueOnce(new Error('synthetic-private-response'))
    await expect(listLocalProfiles(new AbortController().signal)).rejects.toThrow('Could not reach')
  })

  it('cancels an oversized streamed response without trusting its declared size', async () => {
    const cancel = vi.fn()
    let bytes = 0
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({
      pull(controller) {
        const chunk = new Uint8Array(256 * 1024).fill(32)
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel,
    }), { headers: { 'Content-Type': 'application/json', 'Content-Length': '1' } }))
    await expect(readLocalProfile('default', new AbortController().signal)).rejects.toThrow('too large')
    expect(cancel).toHaveBeenCalledOnce()
    expect(bytes).toBeLessThan(MAX_PROFILE_BYTES * 2 + 1024 * 1024)
  })

  it('cancels a pending request and bounds its lifetime', async () => {
    vi.useFakeTimers()
    fetcher.mockImplementation((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    const controller = new AbortController()
    const first = listLocalProfiles(controller.signal)
    controller.abort()
    await expect(first).rejects.toThrow('cancelled')
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
    const next = listLocalProfiles(new AbortController().signal)
    const rejection = expect(next).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
})
