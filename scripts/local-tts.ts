import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import {
  LOCAL_TTS_HEADER, LOCAL_TTS_MAX_BODY_BYTES, LOCAL_TTS_PATH, LOCAL_TTS_VOICES_PATH,
  edgeVoiceCatalogSchema, localTtsRequestSchema,
  type LocalTtsResponse,
} from '../src/core/local-tts-contracts'
import { EdgeTtsError, synthesizeEdgeSpeech } from './edge-tts'
import { listEdgeVoices } from './edge-tts-voices'
import { isLocalRequest } from './local-request'

class LocalTtsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(new LocalTtsError(408, 'Local TTS request was interrupted.'))
    const onError = () => fail(new LocalTtsError(400, 'Could not read the local TTS request.'))
    const onData = (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > LOCAL_TTS_MAX_BODY_BYTES) {
        fail(new LocalTtsError(413, 'Local TTS requests must not exceed 16 KiB.'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      try {
        resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
      } catch {
        reject(new LocalTtsError(400, 'Local TTS requires a valid UTF-8 JSON body.'))
      }
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function localTts({
  synthesize = synthesizeEdgeSpeech,
  listVoices = listEdgeVoices,
  timeoutMs = 45_000,
}: {
  synthesize?: typeof synthesizeEdgeSpeech
  listVoices?: typeof listEdgeVoices
  timeoutMs?: number
} = {}): Plugin {
  const active = new Set<AbortController>()
  return {
    name: 'local-edge-tts',
    apply: 'serve',
    config(_config, environment) {
      return { define: { 'import.meta.env.DEV_LOCAL_TTS': JSON.stringify(String(!environment.isPreview)) } }
    },
    configureServer(server) {
      const base = server.config.base.startsWith('/') ? server.config.base.replace(/\/$/, '') : ''
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0]
        const catalogRequest = path === LOCAL_TTS_VOICES_PATH || path === `${base}${LOCAL_TTS_VOICES_PATH}`
        if (!catalogRequest && path !== LOCAL_TTS_PATH && path !== `${base}${LOCAL_TTS_PATH}`) return next()
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        const sendError = (status: number, error: string) => {
          response.statusCode = status
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Connection', 'close')
          response.end(JSON.stringify({ error }))
        }
        if (!isLocalRequest(request, server.config.server.https ? 'https' : 'http', LOCAL_TTS_HEADER)) {
          sendError(403, 'Local TTS is only available to the app on this localhost origin.')
          return
        }
        const method = catalogRequest ? 'GET' : 'POST'
        if (request.method !== method) {
          response.setHeader('Allow', method)
          sendError(405, catalogRequest ? 'Use GET to list local TTS voices.' : 'Use POST to synthesize local TTS.')
          return
        }
        if (!catalogRequest && (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
          || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity'))) {
          sendError(415, 'Local TTS requires uncompressed application/json.')
          return
        }
        if (Number(request.headers['content-length']) > LOCAL_TTS_MAX_BODY_BYTES) {
          sendError(413, 'Local TTS requests must not exceed 16 KiB.')
          return
        }
        if (active.size >= 4) {
          response.setHeader('Retry-After', '1')
          sendError(429, 'Too many local TTS requests. Wait for an active request to finish.')
          return
        }
        const controller = new AbortController()
        active.add(controller)
        const cancel = () => controller.abort()
        request.once('aborted', cancel)
        response.once('close', cancel)
        const timer = setTimeout(
          () => controller.abort(new LocalTtsError(504, 'Local TTS request timed out.')),
          catalogRequest ? Math.min(timeoutMs, 15_000) : timeoutMs,
        )
        try {
          let result: LocalTtsResponse | ReturnType<typeof edgeVoiceCatalogSchema.parse>
          if (catalogRequest) {
            const catalog = edgeVoiceCatalogSchema.safeParse({ voices: await listVoices(controller.signal) })
            if (!catalog.success) throw new EdgeTtsError(502, 'catalog')
            result = catalog.data
          } else {
            const parsed = localTtsRequestSchema.safeParse(await readBody(request, controller.signal))
            if (!parsed.success) {
              throw new LocalTtsError(400, 'Expected text (1-1000 characters), a supported English or Mandarin Neural voice, and an optional rate of 0.25, 0.5, 0.75, 0.85, 1, or 1.25.')
            }
            const { audio, wordBoundaries } = await synthesize(parsed.data, controller.signal)
            result = {
              audio: { contentType: 'audio/mpeg', base64: audio.toString('base64') },
              wordBoundaries,
            }
          }
          controller.signal.throwIfAborted()
          const body = JSON.stringify(result)
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Content-Length', Buffer.byteLength(body))
          response.end(body)
        } catch (error) {
          if (response.destroyed) return
          const failure = controller.signal.aborted ? controller.signal.reason : error
          if (failure instanceof LocalTtsError || failure instanceof EdgeTtsError) {
            sendError(failure.status, failure.message)
          } else {
            server.config.logger.error('Local TTS failed unexpectedly.')
            sendError(500, catalogRequest ? 'Could not load local TTS voices.' : 'Could not synthesize local TTS.')
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
      for (const controller of active) {
        controller.abort(new LocalTtsError(503, 'Local TTS server is shutting down.'))
      }
    },
  }
}
