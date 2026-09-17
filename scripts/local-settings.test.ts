// @vitest-environment node
import { webcrypto } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, createServer, normalizePath, preview, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse, type ParseError } from 'jsonc-parser'
import {
  localSettingsSchema, LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_FILE, LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH,
} from '../src/core/local-settings-contracts'
import { localSettings } from './local-settings'

const key = 'synthetic-local-test-key'
const settings = {
  aiConnection: {
    baseUrl: 'https://provider.example/v1', apiKey: key, model: 'test-model',
    nativeTools: false, structuredOutput: false, storageAcknowledged: true,
  },
}
let directory: string
let server: ViteDevServer | undefined

beforeEach(async () => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto)
  directory = await mkdtemp(join(tmpdir(), 'langapp-settings-'))
  await mkdir(join(directory, LOCAL_SETTINGS_DIRECTORY))
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function configFile() {
  return join(directory, LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_FILE)
}

async function start(exposeSettings = true) {
  server = await createServer({
    configFile: false, root: directory, plugins: [localSettings({ exposeSettings })], logLevel: 'silent',
    appType: 'mpa',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { deny: ['**/another-private-file'] } },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return `http://127.0.0.1:${address.port}`
}

function headers(origin: string) {
  return { [LOCAL_SETTINGS_HEADER]: '1', Origin: origin, 'Sec-Fetch-Site': 'same-origin' }
}

describe('development-only local app settings', () => {
  it('provides a commented JSONC template explaining every field and requiring storage opt-in', async () => {
    const source = await readFile(new URL('../settings/app.settings.template.jsonc', import.meta.url), 'utf8')
    const errors: ParseError[] = []
    const template: unknown = parse(source, errors)
    expect(errors).toEqual([])
    expect(template).toMatchObject({ aiConnection: {
      apiType: 'responses', apiKey: '', model: '', nativeTools: false, structuredOutput: false, storageAcknowledged: false,
    } })
    for (const field of ['aiConnection', 'apiType', 'baseUrl', 'apiKey', 'model', 'nativeTools', 'structuredOutput', 'storageAcknowledged']) {
      expect(source).toMatch(new RegExp(`//[^\\n]*\\n\\s*"${field}":`))
    }
    const filled = source.replace('"apiKey": ""', `"apiKey": "${key}"`)
      .replace('"model": ""', '"model": "test-model"')
      .replace('"storageAcknowledged": false', '"storageAcknowledged": true')
    expect(localSettingsSchema.safeParse(parse(filled)).success).toBe(true)
  })

  it('reads settings from the settings folder without caching, interpolation, or environment overrides', async () => {
    const literalKey = `${key}-//$VARIABLE/*literal*/`
    vi.stubEnv('VARIABLE', 'must-not-expand')
    vi.stubEnv('ASSISTANT_AI_MODEL', 'must-not-override')
    const configured = { aiConnection: { ...settings.aiConnection, apiKey: literalKey } }
    await writeFile(configFile(), JSON.stringify(configured))
    const base = await start()
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toEqual(configured)
    expect(server?.config.define?.['import.meta.env.DEV_LOCAL_SETTINGS']).toBe(JSON.stringify('true'))
    expect(JSON.stringify(server?.config.env)).not.toContain(key)
    expect(JSON.stringify(server?.config.define)).not.toContain(key)
    await writeFile(configFile(), JSON.stringify({ aiConnection: { ...settings.aiConnection, model: 'updated-model' } }))
    const updated = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) }).then(response => response.json())
    expect(updated).toMatchObject({ aiConnection: { model: 'updated-model' } })
  })

  it('does not read a root-level file or the obsolete environment shortcut', async () => {
    await writeFile(join(directory, LOCAL_SETTINGS_FILE), JSON.stringify(settings))
    await writeFile(join(directory, '.env.local'), `ASSISTANT_AI_API_KEY=${key}`)
    const base = await start()
    expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(404)
  })

  it('accepts an empty settings object and UTF-8 JSON with a byte order mark', async () => {
    await writeFile(configFile(), '\uFEFF{}')
    const base = await start()
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('supports line/block comments and trailing commas without changing string values', async () => {
    const value = `{
      // App-level settings
      "aiConnection": {
        /* Only a local template comment */
        "apiType": "responses",
        "baseUrl": "https://provider.example/v1",
        "apiKey": "${key}/*literal*/",
        "model": "test-model",
        "nativeTools": false,
        "structuredOutput": true,
        "storageAcknowledged": true,
      },
    }`
    await writeFile(configFile(), value)
    const base = await start()
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      aiConnection: { apiKey: `${key}/*literal*/`, apiType: 'responses', structuredOutput: true },
    })
  })

  it.each([
    JSON.stringify({ aiConnection: { ...settings.aiConnection, storageAcknowledged: false } }),
    JSON.stringify({ aiConnection: { ...settings.aiConnection, nativeTools: 'true' } }),
    JSON.stringify({ aiConnection: { ...settings.aiConnection, baseUrl: 'http://provider.example/v1' } }),
    JSON.stringify({ aiConnection: { ...settings.aiConnection, model: '' } }),
    JSON.stringify({ aiConnection: settings.aiConnection, unknownSection: {} }),
    JSON.stringify({ aiConnection: { ...settings.aiConnection, apiType: 'unsupported' } }),
    `${JSON.stringify(settings)} trailing-junk`,
    `${JSON.stringify(settings)} /* unterminated`,
    `{"aiConnection": {"apiKey": "${key}",`,
    ' '.repeat(32 * 1024 + 1),
    'null',
  ])('rejects invalid settings without echoing secrets (case %#)', async value => {
    await writeFile(configFile(), value)
    const base = await start()
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(400)
    const message = await response.text()
    expect(message).toContain('Invalid local settings')
    expect(message).not.toContain(key)
  })

  it('reports file access failures rather than pretending settings are missing', async () => {
    await mkdir(configFile())
    const base = await start()
    const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('Could not read local settings')
  })

  it('rejects navigation, cross-origin requests, untrusted hosts, and non-GET methods', async () => {
    await writeFile(configFile(), JSON.stringify(settings))
    const base = await start()
    const endpoint = base + LOCAL_SETTINGS_PATH
    expect((await fetch(endpoint)).status).toBe(403)
    const blockedHeaders: Record<string, string>[] = [
      { Origin: 'https://untrusted.example' },
      { Origin: base.replace('127.0.0.1', 'localhost') },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]
    for (const changes of blockedHeaders) {
      const response = await fetch(endpoint, { headers: { ...headers(base), ...changes } })
      expect(response.status, JSON.stringify(changes)).toBe(403)
      expect(await response.text()).not.toContain(key)
    }
    // Fetch can discard a Host override; use HTTP directly for this case.
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

  it.each([true, false])('blocks direct file access, including when only protecting v1 (exposeSettings=%s)', async expose => {
    await writeFile(configFile(), JSON.stringify(settings))
    await writeFile(join(directory, LOCAL_SETTINGS_DIRECTORY, 'app.settings.json'), JSON.stringify(settings))
    const base = await start(expose)
    const relative = `/${LOCAL_SETTINGS_DIRECTORY}/${LOCAL_SETTINGS_FILE}`
    for (const path of [relative, `${relative}?raw`, `${relative}?url`, relative.toUpperCase(), `/@fs/${normalizePath(configFile())}`, `/${LOCAL_SETTINGS_DIRECTORY}/app.settings.json`]) {
      const response = await fetch(base + path)
      expect([403, 404], path).toContain(response.status)
      expect(await response.text()).not.toContain(key)
    }
    expect(server?.config.server.fs.deny).toEqual(expect.arrayContaining(['.env', '.env.*', '**/another-private-file']))
    if (!expose) {
      expect(server?.config.define?.['import.meta.env.DEV_LOCAL_SETTINGS']).toBeUndefined()
      expect((await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })).status).toBe(404)
    }
  })

  it('does not include settings in production output or offer an endpoint in preview', async () => {
    await writeFile(configFile(), JSON.stringify(settings))
    await writeFile(join(directory, 'index.html'), '<script type="module" src="./main.js"></script>')
    await writeFile(join(directory, 'main.js'), 'console.log(import.meta.env)')
    const result = await build({
      configFile: false, root: directory, plugins: [localSettings()], logLevel: 'silent',
      build: { write: false },
    })
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
      const response = await fetch(base + LOCAL_SETTINGS_PATH, { headers: headers(base) })
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain(key)
    } finally {
      await new Promise<void>((resolve, reject) => {
        production.httpServer.close(error => error ? reject(error) : resolve())
        if ('closeIdleConnections' in production.httpServer) production.httpServer.closeIdleConnections()
      })
    }
  })
})
