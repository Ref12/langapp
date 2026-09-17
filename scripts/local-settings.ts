import type { IncomingMessage } from 'node:http'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { parse, type ParseError } from 'jsonc-parser'
import { LOOPBACK_HOSTNAMES } from '../src/core/assistant/contracts'
import { localSettingsSchema, LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_FILE, LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../src/core/local-settings-contracts'

const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const maxConfigBytes = 32 * 1024

function isLocalRequest(request: IncomingMessage, protocol: string): boolean {
  if (!localAddresses.has(request.socket.remoteAddress ?? '')
    || request.headers[LOCAL_SETTINGS_HEADER] !== '1') return false
  let origin: URL
  try {
    origin = new URL(`${protocol}://${request.headers.host}`)
  } catch {
    return false
  }
  return LOOPBACK_HOSTNAMES.includes(origin.hostname) && !origin.username && !origin.password
    && (!request.headers.origin || request.headers.origin === origin.origin)
    && (!request.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))
}

async function readConfiguration(root: string): Promise<unknown> {
  const file = await open(join(root, LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_FILE), 'r')
  try {
    const buffer = Buffer.alloc(maxConfigBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > maxConfigBytes) throw new RangeError('Local settings exceed the size limit.')
    const errors: ParseError[] = []
    const value: unknown = parse(buffer.toString('utf8', 0, length).replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true })
    if (errors.length) throw new SyntaxError('Local settings contain invalid JSONC.')
    return value
  } finally {
    await file.close()
  }
}

export function localSettings({ exposeSettings = true } = {}): Plugin {
  return {
    name: 'local-app-settings',
    apply: 'serve',
    config(_config, environment) {
      return {
        // A custom deny list replaces Vite's defaults, so retain those protections.
        server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/app.settings.json', `**/${LOCAL_SETTINGS_FILE}`] } },
        ...(exposeSettings ? { define: { 'import.meta.env.DEV_LOCAL_SETTINGS': JSON.stringify(String(!environment.isPreview)) } } : {}),
      }
    },
    configureServer(server) {
      if (!exposeSettings) return
      const base = server.config.base.startsWith('/') ? server.config.base.replace(/\/$/, '') : ''
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0]
        if (path !== LOCAL_SETTINGS_PATH && path !== `${base}${LOCAL_SETTINGS_PATH}`) return next()
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        const send = (status: number, value: unknown) => {
          response.statusCode = status
          response.end(JSON.stringify(value))
        }
        if (!isLocalRequest(request, server.config.server.https ? 'https' : 'http')) {
          send(403, { error: 'Local settings are only available to the app on this localhost origin.' })
          return
        }
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET')
          send(405, { error: 'Use GET to read local settings.' })
          return
        }
        try {
          const settings = localSettingsSchema.safeParse(await readConfiguration(server.config.root))
          if (!settings.success) {
            send(400, { error: `Invalid local settings. Check ${LOCAL_SETTINGS_FILE}, including aiConnection.storageAcknowledged.` })
            return
          }
          send(200, settings.data)
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            send(404, { error: 'No local settings file is present.' })
          } else if (error instanceof SyntaxError || error instanceof RangeError) {
            send(400, { error: `Invalid local settings. ${LOCAL_SETTINGS_FILE} must be valid JSONC no larger than 32 KiB.` })
          } else {
            send(500, { error: `Could not read local settings. Check access to ${LOCAL_SETTINGS_FILE}.` })
          }
        }
      })
    },
  }
}
