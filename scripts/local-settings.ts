import { realpath } from 'node:fs/promises'
import { resolve, posix } from 'node:path'
import { normalizePath, type Connect, type Plugin } from 'vite'
import { LOCAL_SETTINGS_DIRECTORY, LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../src/core/local-settings-contracts'
import { DEFAULT_PROFILE_ID, profileIdSchema } from '../src/core/profiles/identity'
import { isLocalRequest } from './local-request'
import { ProfileFileError, profileLocalSettings, readProfileFile } from './profile-files'

function normalize(value: string): string {
  return normalizePath(value).replace(/\\/g, '/').toLowerCase()
}

export function localSettings({ exposeSettings = true, privateRoot }: { exposeSettings?: boolean, privateRoot?: string } = {}): Plugin {
  let root = ''
  let base = ''
  let servedRoot = ''
  let publicRoot = ''
  const active = new Set<AbortController>()
  const privatePath = (path: string) => {
    const normalized = normalize(path)
    const directory = `${normalize(root)}/${LOCAL_SETTINGS_DIRECTORY}`
    return normalized === directory || normalized.startsWith(`${directory}/`)
      || /(?:^|\/)(?:\.env(?:\.[^/]*)?|app\.settings\.jsonc?|\.git)(?:\/|$)/.test(normalized)
      || /\.(?:crt|pem)$/.test(normalized)
  }
  const protect: Connect.NextHandleFunction = async (request, response, next) => {
    let path = request.url?.split('?')[0] ?? '/'
    try {
      for (let pass = 0; pass < 5 && /%[0-9a-f]{2}/i.test(path); pass++) path = decodeURIComponent(path)
      if (path.includes('%') || path.includes('\0')) throw new Error()
      const decoded = path.replace(/\\/g, '/')
      path = normalize(path)
      const normalized = posix.normalize(path)
      const mounted = base && normalized.startsWith(`${base}/`) ? normalized.slice(base.length) : normalized
      const unversioned = mounted.replace(/^\/v1(?=\/)/, '')
      const fsPath = normalized.replace(/^\/(?:.*\/)?@fs\//, '')
      if ([normalized, mounted, unversioned].some(value => /^\/data(?:\/|$)/.test(value))
        || privatePath(fsPath) || privatePath(normalized) || privatePath(unversioned)) {
        throw new Error()
      }
      const relative = base && decoded.toLowerCase().startsWith(`${base}/`) ? decoded.slice(base.length) : decoded
      const fsMarker = relative.indexOf('/@fs/')
      const candidates = fsMarker >= 0 ? [relative.slice(fsMarker + 5)] : [
        resolve(servedRoot, `.${relative}`), ...(publicRoot ? [resolve(publicRoot, `.${relative}`)] : []),
      ]
      for (const candidate of candidates) {
        try {
          if (privatePath(await realpath(candidate))) throw new Error()
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'EINVAL'].includes(String(error.code)))) throw error
        }
      }
    } catch {
      response.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' })
      response.end('Private local files are not served.')
      return
    }
    next()
  }
  return {
    name: 'local-app-settings',
    enforce: 'pre',
    async config(config, environment) {
      root = await realpath(resolve(privateRoot ?? config.root ?? process.cwd()))
      const directory = `${normalizePath(root)}/${LOCAL_SETTINGS_DIRECTORY}`
      return {
        server: {
          fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/app.settings.json', '**/app.settings.jsonc', directory, `${directory}/**`] },
          watch: { ignored: [directory, `${directory}/**`, '**/app.settings.json', '**/app.settings.jsonc'] },
        },
        ...(exposeSettings ? { define: {
          'import.meta.env.DEV_LOCAL_SETTINGS': JSON.stringify(String(environment.command === 'serve' && !environment.isPreview)),
        } } : {}),
      }
    },
    configResolved(config) {
      base = config.base.startsWith('/') ? normalize(config.base.replace(/\/$/, '')) : ''
      servedRoot = config.root
      publicRoot = config.publicDir
    },
    async load(id) {
      const path = id.split('?')[0]
      if (privatePath(path)) throw new Error('Private local files cannot be imported.')
      if (path.startsWith('\0')) return
      try {
        if (privatePath(await realpath(path))) throw new ProfileFileError(403, 'Private local files cannot be imported.')
      } catch (error) {
        if (error instanceof ProfileFileError) throw new Error(error.message)
        if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'EINVAL'].includes(String(error.code)))) {
          throw new Error('Could not verify module file access.')
        }
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(protect)
    },
    configureServer(server) {
      server.middlewares.use(protect)
      if (!exposeSettings) return
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0]
        if (path !== LOCAL_SETTINGS_PATH && path !== `${base}${LOCAL_SETTINGS_PATH}`) return next()
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        const send = (status: number, value: unknown) => {
          if (response.destroyed || response.writableEnded) return
          response.statusCode = status
          response.end(JSON.stringify(value))
        }
        if (!isLocalRequest(request, server.config.server.https ? 'https' : 'http', LOCAL_SETTINGS_HEADER)) {
          send(403, { error: 'Local settings are only available to the app on this localhost origin.' })
          return
        }
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET')
          send(405, { error: 'Use GET to read local settings.' })
          return
        }
        const query = new URLSearchParams(request.url?.split('?')[1])
        const id = query.get('profile') ?? DEFAULT_PROFILE_ID
        if (!profileIdSchema.safeParse(id).success || [...query.keys()].some(key => key !== 'profile') || query.getAll('profile').length > 1) {
          send(400, { error: 'Invalid local settings profile selection.' })
          return
        }
        if (active.size >= 4) {
          send(429, { error: 'Too many local settings reads. Retry after an active read finishes.' })
          return
        }
        const controller = new AbortController()
        active.add(controller)
        const cancel = () => controller.abort()
        request.once('aborted', cancel)
        response.once('close', cancel)
        const timer = setTimeout(() => {
          cancel()
          send(408, { error: 'Local settings read timed out.' })
        }, 15_000)
        try {
          const result = await readProfileFile(root, id, controller.signal)
          send(200, profileLocalSettings(result.snapshot))
        } catch (error) {
          if (error instanceof ProfileFileError) {
            send(error.status, { error: error.status === 404 ? 'No local settings file is present.' : 'Invalid local settings profile. Check the YAML file and configured connections.' })
          } else {
            send(500, { error: 'Could not read local settings. Check local profile access.' })
          }
        } finally {
          clearTimeout(timer)
          request.off('aborted', cancel)
          response.off('close', cancel)
          active.delete(controller)
        }
      })
    },
    closeBundle() {
      for (const controller of active) controller.abort()
    },
  }
}
