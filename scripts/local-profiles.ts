import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { MAX_PROFILE_BYTES } from '../src/core/profiles/contracts'
import { profileIdSchema } from '../src/core/profiles/identity'
import { LOCAL_PROFILES_HEADER, LOCAL_PROFILES_PATH, localProfileSaveInputSchema } from '../src/core/profiles/local-contracts'
import { isLocalRequest } from './local-request'
import { initializeProfileDirectory, listProfileFiles, ProfileFileError, readProfileFile, saveProfileFile } from './profile-files'

export const MAX_PROFILE_REQUEST_BYTES = MAX_PROFILE_BYTES * 2 + 16_384

function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      request.off('data', data)
      request.off('end', end)
      request.off('error', fail)
      signal.removeEventListener('abort', abort)
    }
    const fail = () => { cleanup(); reject(new ProfileFileError(400, 'Could not read local profile request.')) }
    const abort = () => { cleanup(); reject(new ProfileFileError(408, 'Local profile request was interrupted.')) }
    const data = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_PROFILE_REQUEST_BYTES) {
        cleanup()
        reject(new ProfileFileError(413, 'Local profile request exceeds the size limit.'))
      } else chunks.push(chunk)
    }
    const end = () => {
      cleanup()
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) } catch {
        reject(new ProfileFileError(400, 'Local profiles require valid UTF-8 JSON.'))
      }
    }
    if (signal.aborted) { abort(); return }
    request.on('data', data)
    request.on('end', end)
    request.on('error', fail)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function localProfiles({
  timeoutMs = 30_000,
  initialize = initializeProfileDirectory,
  read = readProfileFile,
  list = listProfileFiles,
  save = saveProfileFile,
}: {
  timeoutMs?: number,
  initialize?: typeof initializeProfileDirectory,
  read?: typeof readProfileFile,
  list?: typeof listProfileFiles,
  save?: typeof saveProfileFile,
} = {}): Plugin {
  const active = new Set<AbortController>()
  return {
    name: 'local-profiles',
    apply: 'serve',
    config(_config, environment) {
      return { define: { 'import.meta.env.DEV_LOCAL_PROFILES': JSON.stringify(String(!environment.isPreview)) } }
    },
    async configureServer(server) {
      const initialization = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          initialize(server.config.root, initialization.signal),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              initialization.abort()
              reject(new Error('Local profile initialization timed out. Original settings were preserved unless migration completed.'))
            }, timeoutMs)
          }),
        ])
      } finally { clearTimeout(timer) }
      const base = server.config.base.startsWith('/') ? server.config.base.replace(/\/$/, '') : ''
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0] ?? ''
        const endpoint = path === LOCAL_PROFILES_PATH || path.startsWith(`${LOCAL_PROFILES_PATH}/`) ? LOCAL_PROFILES_PATH
          : path === `${base}${LOCAL_PROFILES_PATH}` || path.startsWith(`${base}${LOCAL_PROFILES_PATH}/`) ? `${base}${LOCAL_PROFILES_PATH}` : undefined
        if (!endpoint) return next()
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        const send = (status: number, value: unknown) => {
          if (response.destroyed || response.writableEnded) return
          response.statusCode = status
          if (status >= 400) response.setHeader('Connection', 'close')
          response.end(JSON.stringify(value))
        }
        if (!isLocalRequest(request, server.config.server.https ? 'https' : 'http', LOCAL_PROFILES_HEADER)) {
          send(403, { error: 'Local profiles are only available to the app on this localhost origin.' })
          return
        }
        const id = path === endpoint ? undefined : path.slice(endpoint.length + 1)
        if ((id !== undefined && !profileIdSchema.safeParse(id).success) || request.url?.includes('?')) {
          send(400, { error: 'Invalid local profile path.' })
          return
        }
        if (request.method !== 'GET' && !(id !== undefined && request.method === 'PUT')) {
          response.setHeader('Allow', id === undefined ? 'GET' : 'GET, PUT')
          send(405, { error: 'Use GET to read profiles or PUT to save a named profile.' })
          return
        }
        if (request.method === 'PUT' && (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
          || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity'))) {
          send(415, { error: 'Local profiles require uncompressed application/json.' })
          return
        }
        if (Number(request.headers['content-length']) > MAX_PROFILE_REQUEST_BYTES) {
          send(413, { error: 'Local profile request exceeds the size limit.' })
          return
        }
        if (active.size >= 4) {
          response.setHeader('Retry-After', '1')
          send(429, { error: 'Too many local profile operations. Retry after an active operation finishes.' })
          return
        }
        const controller = new AbortController()
        active.add(controller)
        const cancel = () => controller.abort()
        request.once('aborted', cancel)
        response.once('close', cancel)
        const deadline = setTimeout(() => {
          cancel()
          send(408, { error: 'Local profile operation timed out. Refresh the list before retrying an export.' })
        }, timeoutMs)
        try {
          if (request.method === 'PUT' && id !== undefined) {
            const parsed = localProfileSaveInputSchema.safeParse(await readBody(request, controller.signal))
            if (!parsed.success) throw new ProfileFileError(400, 'Expected profile YAML and an expectedRevision string or null.')
            send(200, await save(server.config.root, id, parsed.data, controller.signal))
          } else if (id !== undefined) {
            const result = await read(server.config.root, id, controller.signal)
            send(200, { yaml: result.yaml, revision: result.revision })
          } else {
            send(200, await list(server.config.root, controller.signal))
          }
        } catch (error) {
          if (error instanceof ProfileFileError) send(error.status, { error: error.message })
          else send(500, { error: 'Could not access local profiles. No profile contents are included in this error.' })
        } finally {
          clearTimeout(deadline)
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
