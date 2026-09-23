// @vitest-environment node
import { randomUUID, webcrypto } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build, createServer, normalizePath, preview, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { localSettingsSchema, LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_FILE, LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../src/core/local-settings-contracts'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from '../src/core/profiles/codec'
import { createProfileTemplate } from '../src/core/profiles/template'
import { localSettings } from './local-settings'

const key = 'synthetic-local-test-key'
const aiConnection = {
  baseUrl: 'https://provider.example/v1', apiKey: key, model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true as const,
}
const speechConnection = {
  provider: 'azure' as const, region: 'eastus', apiKey: 'synthetic-local-speech-test-key', storageAcknowledged: true as const,
}
const speechVoices = {
  'zh-Hans': { provider: 'edge' as const, voice: 'zh-CN-YunjianNeural' },
  'en-US': { provider: 'edge' as const, voice: 'en-US-ChristopherNeural' },
}
let directory: string
let server: ViteDevServer | undefined
beforeEach(async () => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto)
  directory = join(process.cwd(), `.local-settings-test-${randomUUID()}`)
  await mkdir(join(directory, LOCAL_SETTINGS_DIRECTORY), { recursive: true })
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
function configFile() { return join(directory, LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_FILE) }
function yaml(settings: unknown = {}, id = 'default') {
  return serializeProfileYaml(createEmptyProfile({ id, name: 'Test' }, localSettingsSchema.parse(settings)))
}
async function start(exposeSettings = true, nested = false) {
  const root = nested ? join(directory, 'versions', 'v1') : directory
  await mkdir(root, { recursive: true })
  server = await createServer({
    configFile: false, root, cacheDir: join(directory, '.vite-cache'), base: nested ? '/v1/' : '/', plugins: [localSettings({ exposeSettings, privateRoot: directory })], logLevel: 'silent',
    appType: 'mpa', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { deny: ['**/another-private-file'] } },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return `http://127.0.0.1:${address.port}`
}
function headers(origin: string) { return { [LOCAL_SETTINGS_HEADER]: '1', Origin: origin, 'Sec-Fetch-Site': 'same-origin' } }

describe('development-only profile bootstrap settings', () => {
  it('generates a commented secret-free YAML template without enabling cloud services', () => {
    const source = createProfileTemplate()
    const template = parseProfileYaml(source)
    expect(template.profile).toEqual({ id: 'default', name: 'default' })
    expect(template.settings).not.toHaveProperty('aiConnection')
    expect(template.settings).not.toHaveProperty('speechConnection')
    expect(template.settings.preferences).not.toHaveProperty('speechVoices')
    expect(template.settings.preferences).not.toHaveProperty('defaultSpeechRate')
    for (const field of ['apiType', 'baseUrl', 'apiKey', 'model', 'nativeTools', 'structuredOutput', 'storageAcknowledged']) {
      expect(source).toContain(`#   ${field}:`)
    }
    expect(source).toContain('ALL exports include')
    expect(source).toContain('speechVoices')
  })
  it.each([
    { speechConnection }, { aiConnection, speechConnection }, { aiConnection },
    ...[0.5, 0.75, 1, 1.25].map(defaultSpeechRate => ({ defaultSpeechRate })),
    { aiConnection, speechConnection, defaultSpeechRate: 0.75, speechVoices },
    { speechVoices }, { speechVoices: { 'en-US': { voiceURI: 'local-en', name: 'English local', lang: 'en-US', localService: true } } },
    {},
  ])('extracts all configured settings independently (case %#)', async configured => {
    await writeFile(configFile(), yaml(configured))
    const base = await start()
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(configured)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(server?.config.env)).not.toContain(key)
    expect(JSON.stringify(server?.config.define)).not.toContain(key)
  })
  it('uses the selected profile without stale caching, interpolation, or default fallback', async () => {
    const id = randomUUID()
    const literalKey = `${key}-//$VARIABLE/*literal*/`
    vi.stubEnv('VARIABLE', 'must-not-expand')
    await writeFile(configFile(), yaml({ aiConnection }))
    await writeFile(join(directory, 'data', `${id}.yaml`), '\uFEFF# Comment\n' + yaml({ aiConnection: { ...aiConnection, apiKey: literalKey } }, id))
    const base = await start()
    const endpoint = base + LOCAL_SETTINGS_PATH + `?profile=${id}`
    const response = await fetch(endpoint, { headers: headers(base) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toMatchObject({ aiConnection: { apiKey: literalKey } })
    expect(server?.config.define?.['import.meta.env.DEV_LOCAL_SETTINGS']).toBe(JSON.stringify('true'))
    await writeFile(join(directory, 'data', `${id}.yaml`), yaml({}, id))
    expect(await fetch(endpoint, { headers: headers(base) }).then(response => response.json())).toEqual({})
    expect((await fetch(base + LOCAL_SETTINGS_PATH + `?profile=${randomUUID()}`, { headers: headers(base) })).status).toBe(404)
    for (const query of ['?profile=../default', '?profile=', '?profile=default&profile=default', '?unknown=value']) {
      expect((await fetch(base + LOCAL_SETTINGS_PATH + query, { headers: headers(base) })).status).toBe(400)
    }
  })
  it('does not read root-level YAML or obsolete environment shortcuts', async () => {
    await writeFile(join(directory, LOCAL_SETTINGS_FILE), yaml({ aiConnection }))
    await writeFile(join(directory, '.env.local'), `ASSISTANT_AI_API_KEY=${key}`)
    const base = await start()
    expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(404)
  })
  it.each([
    { aiConnection: { ...aiConnection, storageAcknowledged: false } },
    { aiConnection: { ...aiConnection, nativeTools: 'true' } },
    { aiConnection: { ...aiConnection, baseUrl: 'http://provider.example/v1' } },
    { aiConnection: { ...aiConnection, model: '' } },
    { aiConnection: { ...aiConnection, apiType: 'unsupported' } },
    { speechConnection: { ...speechConnection, provider: 'other' } },
    { speechConnection: { ...speechConnection, region: 'invalid/region' } },
    { speechConnection: { ...speechConnection, storageAcknowledged: false } },
    { speechConnection: { ...speechConnection, apiKey: '' } },
  ])('rejects invalid configured connections without echoing secrets (case %#)', async settings => {
    const snapshot = createEmptyProfile({ id: 'default', name: 'Test' })
    await writeFile(configFile(), stringify({ ...snapshot, settings: { ...snapshot.settings, ...settings } }))
    const base = await start()
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(400)
    const message = await response.text()
    expect(message).toContain('Invalid local settings')
    expect(message).not.toContain(key)
    expect(message).not.toContain(speechConnection.apiKey)
  })
  it.each([null, [], { 'zh-Hans': speechVoices['en-US'] }, { 'en-US': speechVoices['zh-Hans'] },
    { 'en-US': { ...speechVoices['en-US'], url: 'https://untrusted.example/' } },
  ])('retains speech voice validation (case %#)', async speechVoices => {
    const snapshot = createEmptyProfile({ id: 'default', name: 'Test' })
    await writeFile(configFile(), stringify({ ...snapshot, settings: { preferences: { ...snapshot.settings.preferences, speechVoices } } }))
    const base = await start()
    expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(400)
  })
  it.each([0, 0.6, 2, -1, '0.75', null, true, {}, []])('retains speech rate validation (case %#)', async defaultSpeechRate => {
    const snapshot = createEmptyProfile({ id: 'default', name: 'Test' })
    await writeFile(configFile(), stringify({ ...snapshot, settings: { preferences: { ...snapshot.settings.preferences, defaultSpeechRate } } }))
    const base = await start()
    expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(400)
  })
  it('reports nonregular files and malformed YAML rather than resetting them', async () => {
    await mkdir(configFile())
    const base = await start()
    expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(400)
    await rm(configFile(), { recursive: true })
    await writeFile(configFile(), `secret: [${key}`)
    expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(400)
  })
  it('rejects navigation, cross-origin requests, untrusted hosts, and non-GET methods', async () => {
    await writeFile(configFile(), yaml({ aiConnection }))
    const base = await start()
    const endpoint = base + LOCAL_SETTINGS_PATH
    expect((await fetch(endpoint)).status).toBe(403)
    for (const changes of [{ Origin: 'https://untrusted.example' }, { Origin: base.replace('127.0.0.1', 'localhost') }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      expect((await fetch(endpoint, { headers: { ...headers(base), ...changes } })).status).toBe(403)
    }
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(endpoint, { headers: { ...headers(base), Host: 'untrusted.example' } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      request.on('error', reject)
      request.end()
    })
    expect(hostileHostStatus).toBe(403)
    expect((await fetch(endpoint, { method: 'POST', headers: headers(base) })).status).toBe(405)
  })
  it.each([false, true])('denies root data and legacy secrets in root and nested v1 servers (nested=%s)', async nested => {
    await writeFile(configFile(), yaml({ aiConnection }))
    await writeFile(join(directory, 'data', 'profile.template.yaml'), createProfileTemplate())
    await mkdir(join(directory, 'settings'))
    await writeFile(join(directory, 'settings', 'app.settings.jsonc'), JSON.stringify({ aiConnection }))
    await mkdir(join(directory, 'src', 'data'), { recursive: true })
    await writeFile(join(directory, 'src', 'data', 'curriculum.json'), '{"public":true}')
    const base = await start(!nested, nested)
    const paths = [
      '/data/default.yaml', '/data/profile.template.yaml', '/data/default.yaml?raw', '/DATA/DEFAULT.YAML',
      `/@fs/${normalizePath(configFile())}`, `/v1/@fs/${normalizePath(configFile())}`,
      '/v1/data/default.yaml', '/v1/%2e%2e/data/default.yaml', '/%64ata/default.yaml',
      '/v1/%2e%2e%2fdata%2fdefault.yaml', '/v1/%2e%2e%5cdata%5cdefault.yaml', '/%2564ata/default.yaml', '/settings/app.settings.jsonc',
      '/settings/app.settings.json', '/.env.local', '/.git/config', '/private.pem',
    ]
    for (const path of paths) {
      const response = await fetch(base + path)
      expect([403, 404], path).toContain(response.status)
      expect(await response.text()).not.toContain(key)
    }
    expect(server?.config.server.fs.deny).toEqual(expect.arrayContaining(['.env', '.env.*', '**/another-private-file']))
    if (!nested) expect((await fetch(base + '/src/data/curriculum.json')).status).toBe(200)
    else expect((await fetch(base + '/v1' + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(404)
  })
  it('blocks static and filesystem aliases that resolve into root data', async () => {
    await writeFile(configFile(), yaml({ aiConnection }))
    await symlink(join(directory, 'data'), join(directory, 'alias'), 'junction')
    const base = await start()
    for (const path of ['/alias/default.yaml', '/alias/default.yaml?raw', `/@fs/${normalizePath(join(directory, 'alias', 'default.yaml'))}`]) {
      const response = await fetch(base + path)
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain(key)
    }
  })
  it('ignores private data in file watching without excluding tracked src/data', async () => {
    await writeFile(configFile(), yaml({ aiConnection }))
    server = await createServer({
      configFile: false, root: directory, cacheDir: join(directory, '.vite-cache'),
      plugins: [localSettings()], logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, hmr: false },
    })
    const ignored = JSON.stringify(server.config.server.watch?.ignored)
    expect(ignored).toContain('/data')
    expect(ignored).not.toContain('/src/data')
    await vi.waitFor(() => expect(Object.keys(server!.watcher.getWatched()).length).toBeGreaterThan(0))
    const watched = Object.keys(server.watcher.getWatched()).map(path => normalizePath(path))
    expect(watched).not.toContain(normalizePath(join(directory, 'data')))
  })
  it('rejects explicit private imports during builds without echoing contents', async () => {
    await writeFile(configFile(), yaml({ aiConnection }))
    await writeFile(join(directory, 'index.html'), '<script type="module" src="./main.js"></script>')
    await writeFile(join(directory, 'main.js'), "import snapshot from './data/default.yaml?raw'; console.log(snapshot)")
    const result = build({
      configFile: false, root: directory, plugins: [localSettings()], logLevel: 'silent', build: { write: false },
    })
    await expect(result).rejects.toThrow('Private local files cannot be imported')
    await expect(result).rejects.not.toThrow(key)
  })
  it('does not include data in production output or offer bootstrap in preview', async () => {
    await writeFile(configFile(), yaml({ aiConnection }))
    await writeFile(join(directory, 'index.html'), '<script type="module" src="./main.js"></script>')
    await writeFile(join(directory, 'main.js'), 'console.log(import.meta.env)')
    const result = await build({ configFile: false, root: directory, plugins: [localSettings()], logLevel: 'silent', build: { write: false } })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).not.toContain(LOCAL_SETTINGS_FILE)
    await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'dist', 'index.html'), 'Production app')
    const production = await preview({
      configFile: false, root: directory, plugins: [localSettings()], logLevel: 'silent',
      appType: 'mpa', preview: { host: '127.0.0.1', port: 0 },
    })
    try {
      const address = production.httpServer.address()
      if (!address || typeof address === 'string') throw new Error('Missing preview address')
      const base = `http://127.0.0.1:${address.port}`
      expect(production.config.define?.['import.meta.env.DEV_LOCAL_SETTINGS']).toBe(JSON.stringify('false'))
      expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(404)
      expect((await fetch(base + '/data/default.yaml')).status).toBe(403)
    } finally {
      await new Promise<void>((resolve, reject) => {
        production.httpServer.close(error => error ? reject(error) : resolve())
        if ('closeIdleConnections' in production.httpServer) production.httpServer.closeIdleConnections()
      })
    }
  })
})
