// @vitest-environment node
import { randomUUID, webcrypto } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build, createServer, preview, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile, serializeProfileYaml } from '../src/core/profiles/codec'
import { MAX_PROFILE_BYTES } from '../src/core/profiles/contracts'
import { LOCAL_PROFILES_HEADER, LOCAL_PROFILES_PATH, localProfileSaveReplySchema } from '../src/core/profiles/local-contracts'
import { localProfiles, MAX_PROFILE_REQUEST_BYTES } from './local-profiles'
import { localSettings } from './local-settings'
import { isLocalRequest } from './local-request'

let root: string
let server: ViteDevServer | undefined
const key = 'synthetic-profile-key'
function yaml(id = 'default', name = 'Default') {
  return serializeProfileYaml(createEmptyProfile({ id, name }, {
    aiConnection: { baseUrl: 'https://example.test/v1', apiKey: key, model: 'test', nativeTools: false, structuredOutput: false, storageAcknowledged: true },
    speechConnection: { provider: 'azure', region: 'eastus', apiKey: 'synthetic-azure-key', storageAcknowledged: true },
  }))
}
function headers(base: string) { return { [LOCAL_PROFILES_HEADER]: '1', Origin: base, 'Content-Type': 'application/json' } }
async function start(options: Parameters<typeof localProfiles>[0] = {}, base = '/') {
  server = await createServer({
    configFile: false, root, base, cacheDir: join(root, '.vite-cache'), plugins: [localSettings(), localProfiles(options)], logLevel: 'silent', appType: 'mpa',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  return `http://127.0.0.1:${address.port}`
}
beforeEach(async () => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto)
  root = join(process.cwd(), `.local-profiles-test-${randomUUID()}`)
  await mkdir(root)
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('root-development protected local profiles API', () => {
  it('lists, creates, reads and revision-updates a named YAML snapshot with both credentials intact', async () => {
    const base = await start()
    const endpoint = base + LOCAL_PROFILES_PATH
    expect(await fetch(endpoint, { headers: headers(base) }).then(r => r.json())).toEqual({ profiles: [] })
    const id = randomUUID()
    const text = yaml(id, 'Named profile')
    const create = await fetch(`${endpoint}/${id}`, { method: 'PUT', headers: headers(base), body: JSON.stringify({ yaml: text, expectedRevision: null }) })
    expect(create.status).toBe(200)
    const saved = localProfileSaveReplySchema.parse(await create.json())
    expect(saved).toMatchObject({ profile: { id, name: 'Named profile' }, revision: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const read = await fetch(`${endpoint}/${id}`, { headers: headers(base) })
    expect(read.headers.get('cache-control')).toBe('no-store')
    expect(read.headers.get('access-control-allow-origin')).toBeNull()
    expect(await read.json()).toEqual({ yaml: text, revision: saved.revision })
    expect(await fetch(endpoint, { headers: headers(base) }).then(r => r.json())).toEqual({ profiles: [{ id, name: 'Named profile', revision: saved.revision }] })
    for (const expectedRevision of [null, '0'.repeat(64)]) {
      expect((await fetch(`${endpoint}/${id}`, { method: 'PUT', headers: headers(base), body: JSON.stringify({ yaml: text, expectedRevision }) })).status).toBe(409)
    }
    const update = await fetch(`${endpoint}/${id}`, { method: 'PUT', headers: headers(base), body: JSON.stringify({ yaml: yaml(id, 'Renamed'), expectedRevision: saved.revision }) })
    expect(update.status).toBe(200)
    expect(await readFile(join(root, 'data', `${id}.yaml`), 'utf8')).toContain('synthetic-azure-key')
    expect(JSON.stringify(server?.config.define)).not.toContain(key)
    expect(JSON.stringify(server?.config.env)).not.toContain(key)
    expect(server?.config.define?.['import.meta.env.DEV_LOCAL_PROFILES']).toBe(JSON.stringify('true'))
  })
  it('supports a deployment base and rejects missing, invalid and mismatched IDs', async () => {
    const base = await start({}, '/app/')
    const endpoint = base + '/app' + LOCAL_PROFILES_PATH
    expect((await fetch(`${endpoint}/${randomUUID()}`, { headers: headers(base) })).status).toBe(404)
    for (const path of ['/unsafe', '/default/extra', '/%252e%252e', '/default?raw', '/default.yaml']) {
      expect((await fetch(endpoint + path, { headers: headers(base) })).status).toBe(400)
    }
    expect((await fetch(endpoint + '/default', { method: 'PUT', headers: headers(base), body: JSON.stringify({ yaml: yaml(randomUUID()), expectedRevision: null }) })).status).toBe(400)
    expect((await fetch(base + '/app/data/default.yaml')).status).toBe(403)
  })
  it('enforces intent, loopback, same origin, host and allowed methods without CORS', async () => {
    const base = await start()
    const endpoint = base + LOCAL_PROFILES_PATH
    expect((await fetch(endpoint)).status).toBe(403)
    const blockedHeaders: Record<string, string>[] = [
      { Origin: 'https://hostile.test' }, { Origin: 'null' }, { Origin: base.replace('127.0.0.1', 'localhost') },
      { 'Sec-Fetch-Site': 'cross-site' }, { [LOCAL_PROFILES_HEADER]: 'true' },
    ]
    for (const extra of blockedHeaders) {
      const response = await fetch(endpoint, { headers: { ...headers(base), ...extra } })
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
    expect(isLocalRequest({ headers: { host: 'localhost', [LOCAL_PROFILES_HEADER]: '1' }, socket: { remoteAddress: '192.0.2.1' } }, 'http', LOCAL_PROFILES_HEADER)).toBe(false)
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(endpoint, { headers: { ...headers(base), Host: 'hostile.test' } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      request.on('error', reject)
      request.end()
    })
    expect(hostStatus).toBe(403)
    for (const method of ['POST', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      expect((await fetch(endpoint, { method, headers: headers(base) })).status).toBe(405)
    }
    expect((await fetch(endpoint, { method: 'PUT', headers: headers(base), body: '{}' })).status).toBe(405)
  })
  it('rejects malformed/uncompressed/overlarge JSON and does not echo secrets', async () => {
    const base = await start()
    const endpoint = base + LOCAL_PROFILES_PATH + '/default'
    for (const body of ['{ synthetic-profile-key', '{}', JSON.stringify({ yaml: yaml(), expectedRevision: null, apiKey: key }), JSON.stringify({ yaml: yaml(), expectedRevision: 'bad' })]) {
      const response = await fetch(endpoint, { method: 'PUT', headers: headers(base), body })
      expect(response.status).toBe(400)
      expect(await response.text()).not.toContain(key)
    }
    const invalidHeaders: Record<string, string>[] = [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]
    for (const extra of invalidHeaders) {
      expect((await fetch(endpoint, { method: 'PUT', headers: { ...headers(base), ...extra }, body: '{}' })).status).toBe(415)
    }
    const invalidUtf8 = await fetch(endpoint, { method: 'PUT', headers: headers(base), body: Buffer.from([0xff]) })
    expect(invalidUtf8.status).toBe(400)
    const oversized = await fetch(endpoint, { method: 'PUT', headers: headers(base), body: JSON.stringify({ yaml: ' '.repeat(MAX_PROFILE_BYTES + 1), expectedRevision: null }) })
    expect(oversized.status).toBe(413)
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(endpoint, { method: 'PUT', headers: { ...headers(base), 'Content-Length': String(MAX_PROFILE_REQUEST_BYTES + 1) } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      request.on('error', reject)
      request.end()
    })
    expect(status).toBe(413)
  })
  it('reports malformed disk entries and bounds listings instead of hiding bad snapshots', async () => {
    const base = await start()
    await writeFile(join(root, 'data', 'default.yaml'), 'malformed synthetic-profile-key')
    const response = await fetch(base + LOCAL_PROFILES_PATH, { headers: headers(base) })
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain(key)
  })
  it('times out slow bodies and does not create a snapshot', async () => {
    const base = await start({ timeoutMs: 100 })
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(base + LOCAL_PROFILES_PATH + '/default', { method: 'PUT', headers: { ...headers(base), 'Content-Length': '1000' } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      request.on('error', reject)
      request.write('{')
    })
    expect(status).toBe(408)
    await expect(readFile(join(root, 'data', 'default.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('times out stalled filesystem operations with a finite response', async () => {
    const base = await start({ timeoutMs: 100, list: async (_root, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    expect((await fetch(base + LOCAL_PROFILES_PATH, { headers: headers(base) })).status).toBe(408)
  })
  it('limits concurrent operations and aborts work on client disconnection', async () => {
    const signals: AbortSignal[] = []
    const base = await start({ timeoutMs: 5_000, list: async (_root, signal) => new Promise((_resolve, reject) => {
      signals.push(signal!)
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    const requests = Array.from({ length: 4 }, () => {
      const request = httpRequest(base + LOCAL_PROFILES_PATH, { headers: headers(base) })
      request.on('error', () => {})
      request.end()
      return request
    })
    await vi.waitFor(() => expect(signals).toHaveLength(4))
    const limited = await fetch(base + LOCAL_PROFILES_PATH, { headers: headers(base) })
    expect(limited.status).toBe(429)
    for (const request of requests) request.destroy()
    await vi.waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true))
  })
  it('never initializes, embeds data, or exposes profile routes for build/preview', async () => {
    const initialize = vi.fn()
    await mkdir(join(root, 'data'))
    await writeFile(join(root, 'data', 'default.yaml'), yaml())
    await writeFile(join(root, 'index.html'), '<script type="module" src="./main.js"></script>')
    await writeFile(join(root, 'main.js'), 'console.log(import.meta.env.DEV_LOCAL_PROFILES)')
    const result = await build({ configFile: false, root, plugins: [localSettings(), localProfiles({ initialize })], logLevel: 'silent', build: { write: false } })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(initialize).not.toHaveBeenCalled()
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist', 'index.html'), 'Production')
    const production = await preview({
      configFile: false, root, plugins: [localSettings(), localProfiles({ initialize })], logLevel: 'silent',
      appType: 'mpa', preview: { host: '127.0.0.1', port: 0 },
    })
    try {
      const address = production.httpServer.address()
      if (!address || typeof address === 'string') throw new Error('No preview address')
      const base = `http://127.0.0.1:${address.port}`
      expect((await fetch(base + LOCAL_PROFILES_PATH, { headers: headers(base) })).status).toBe(404)
      expect((await fetch(base + LOCAL_PROFILES_PATH + '/default', { method: 'PUT', headers: headers(base), body: '{}' })).status).toBe(404)
      expect(production.config.define?.['import.meta.env.DEV_LOCAL_PROFILES']).toBe(JSON.stringify('false'))
      expect(initialize).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => {
        production.httpServer.close(error => error ? reject(error) : resolve())
        if ('closeIdleConnections' in production.httpServer) production.httpServer.closeIdleConnections()
      })
    }
  })
})
