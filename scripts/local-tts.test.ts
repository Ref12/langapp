// @vitest-environment node
import { randomUUID, webcrypto } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { createServer, preview, resolveConfig, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_TTS_HEADER, LOCAL_TTS_MAX_BODY_BYTES, LOCAL_TTS_PATH, LOCAL_TTS_VOICES_PATH, localTtsRequestSchema,
  type EdgeVoice, type LocalTtsResponse,
} from '../src/core/local-tts-contracts'
import { EdgeTtsError, type EdgeTtsResult, type synthesizeEdgeSpeech } from './edge-tts'
import type { listEdgeVoices } from './edge-tts-voices'
import { isLocalRequest } from './local-request'
import { localTts } from './local-tts'

const payload = { text: 'A synthetic test phrase.', voice: 'en-US-AriaNeural', rate: 0.75 }
const audio = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x01, 0x02])
const speech: EdgeTtsResult = {
  audio,
  wordBoundaries: [{ text: 'Hello', startTime: 0.1, duration: 0.3 }, { text: '\u4f60\u597d', startTime: 0.6, duration: 0.25 }],
}
const synthesize = vi.fn<typeof synthesizeEdgeSpeech>()
const listVoices = vi.fn<typeof listEdgeVoices>()
const voices: EdgeVoice[] = [
  { id: 'en-GB-SoniaNeural', name: 'Synthetic provider English name', locale: 'en-GB', gender: 'Female' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: 'Synthetic provider Mandarin name', locale: 'zh-CN-liaoning', gender: 'Female' },
]
let directory: string
let server: ViteDevServer | undefined

beforeEach(async () => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto)
  directory = join(process.cwd(), `.local-tts-test-${randomUUID()}`)
  await mkdir(directory)
  synthesize.mockReset().mockResolvedValue(speech)
  listVoices.mockReset().mockResolvedValue(voices)
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function start({ base = '/', timeoutMs = 45_000 } = {}) {
  server = await createServer({
    configFile: false, root: directory, base, plugins: [localTts({ synthesize, listVoices, timeoutMs })],
    logLevel: 'silent', appType: 'mpa',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Missing local TTS test server address')
  return `http://127.0.0.1:${address.port}`
}

function headers(origin: string) {
  return {
    [LOCAL_TTS_HEADER]: '1', Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
  }
}

function post(origin: string, value: unknown = payload) {
  return fetch(origin + LOCAL_TTS_PATH, { method: 'POST', headers: headers(origin), body: JSON.stringify(value) })
}

function rawPost(origin: string, body: Buffer, changes: OutgoingHttpHeaders = {}) {
  return rawRequest(origin, LOCAL_TTS_PATH, 'POST', body, changes)
}

function rawRequest(origin: string, path: string, method: string, body: Buffer, changes: OutgoingHttpHeaders = {}) {
  return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest(origin + path, {
      method, headers: { ...headers(origin), ...changes },
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode, body: text }))
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

function waitForAbort(signals: AbortSignal[] = []) {
  synthesize.mockImplementation((_request, signal) => {
    signals.push(signal)
    return new Promise<EdgeTtsResult>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
}

function getVoices(origin: string) {
  return fetch(origin + LOCAL_TTS_VOICES_PATH, { headers: { [LOCAL_TTS_HEADER]: '1', Origin: origin } })
}

function waitForCatalogAbort(signals: AbortSignal[] = []) {
  listVoices.mockImplementation(signal => {
    signals.push(signal)
    return new Promise<EdgeVoice[]>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
}

describe('development-only local TTS', () => {
  it('returns base64 MP3 and word timings as UTF-8 JSON without caching or permissive CORS', async () => {
    const origin = await start()
    const response = await post(origin)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const body = await response.text()
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(body)))
    const result: LocalTtsResponse = JSON.parse(body)
    expect(result).toEqual({
      audio: { contentType: 'audio/mpeg', base64: audio.toString('base64') },
      wordBoundaries: speech.wordBoundaries,
    })
    expect(Buffer.from(result.audio.base64, 'base64')).toEqual(audio)
    expect(synthesize).toHaveBeenCalledWith(payload, expect.any(AbortSignal))
  })

  it('returns an explicit empty boundary list if the provider supplied none', async () => {
    synthesize.mockResolvedValueOnce({ audio, wordBoundaries: [] })
    const response = await post(await start())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      audio: { contentType: 'audio/mpeg', base64: audio.toString('base64') }, wordBoundaries: [],
    })
  })

  it('normalizes input and defaults the rate without inventing a voice', async () => {
    const origin = await start()
    const response = await post(origin, { text: '  Synthetic phrase. \n', voice: 'zh-CN-XiaoxiaoNeural' })
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    expect(synthesize.mock.calls[0][0]).toEqual({ text: 'Synthetic phrase.', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 })
  })

  it('passes quarter-speed Mandarin through the local endpoint to synthesis', async () => {
    const request = { text: 'Synthetic phrase.', voice: 'zh-CN-XiaoxiaoNeural', rate: 0.25 }
    const response = await post(await start(), request)
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    expect(synthesize).toHaveBeenCalledWith(request, expect.any(AbortSignal))
  })

  it('supports a configured Vite base without claiming unrelated routes', async () => {
    const origin = await start({ base: '/langapp/' })
    for (const path of [LOCAL_TTS_PATH, `/langapp${LOCAL_TTS_PATH}`]) {
      const response = await fetch(origin + path, { method: 'POST', headers: headers(origin), body: JSON.stringify(payload) })
      expect(response.status).toBe(200)
      await response.arrayBuffer()
    }
    expect((await fetch(origin + '/langapp/unrelated')).status).toBe(404)
    expect(synthesize).toHaveBeenCalledTimes(2)
  })

  it.each([
    {}, { Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' },
    { [LOCAL_TTS_HEADER]: '0' },
  ])('rejects missing intent or cross-origin requests before synthesis (case %#)', async changes => {
    const origin = await start()
    const requestHeaders = Object.keys(changes).length ? { ...headers(origin), ...changes } : {}
    const response = await fetch(origin + LOCAL_TTS_PATH, {
      method: 'POST', headers: requestHeaders, body: JSON.stringify(payload),
    })
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('rejects untrusted Host and mismatched localhost Origin headers', async () => {
    const origin = await start()
    expect((await rawPost(origin, Buffer.from(JSON.stringify(payload)), { Host: 'attacker.example' })).status).toBe(403)
    expect((await rawPost(origin, Buffer.from(JSON.stringify(payload)), { Origin: origin.replace('127.0.0.1', 'localhost') })).status).toBe(403)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PUT', 'OPTIONS'])('requires POST, not %s', async method => {
    const origin = await start()
    const response = await fetch(origin + LOCAL_TTS_PATH, { method, headers: headers(origin) })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(synthesize).not.toHaveBeenCalled()
  })

  it.each([
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    { 'Content-Type': 'application/json; charset=utf-16' },
    { 'Content-Encoding': 'gzip' },
  ])('rejects unsupported encodings (case %#)', async changes => {
    const origin = await start()
    const response = await rawPost(origin, Buffer.from(JSON.stringify(payload)), changes)
    expect(response.status).toBe(415)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it.each([
    null, [], {}, { ...payload, text: '' }, { ...payload, text: ' \n ' }, { ...payload, text: 12 },
    { ...payload, text: 'x'.repeat(1001) }, { ...payload, text: 'bad\u0000text' },
    { ...payload, text: 'bad\ud800text' }, { ...payload, text: 'bad\ufffetext' },
    { ...payload, voice: 'https://attacker.example' }, { ...payload, voice: "en-US-X'Neural" },
    { ...payload, voice: 'fr-FR-DeniseNeural' }, { ...payload, voice: '' },
    { ...payload, rate: 0.6 }, { ...payload, rate: '0.75' }, { ...payload, rate: null },
    { ...payload, url: 'https://attacker.example' },
  ])('rejects invalid input without contacting a provider or echoing the text (case %#)', async value => {
    const origin = await start()
    const response = await post(origin, value)
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain(payload.text)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('accepts valid XML Unicode scalars and every supported rate', () => {
    for (const rate of [0.25, 0.5, 0.75, 0.85, 1, 1.25]) {
      expect(localTtsRequestSchema.safeParse({ ...payload, text: 'Hello \u{1f600}\t\n<&>', rate }).success).toBe(true)
    }
  })

  it.each(['en-GB-SoniaNeural', 'en-AU-NatashaNeural', 'zh-TW-HsiaoChenNeural', 'zh-SG-YanlinNeural', 'zh-CN-liaoning-XiaobeiNeural'])(
    'accepts supported voice %s with the guided-audio rate', async voice => {
      const response = await post(await start(), { ...payload, voice, rate: 0.85 })
      expect(response.status).toBe(200)
      expect(synthesize).toHaveBeenCalledWith({ ...payload, voice, rate: 0.85 }, expect.any(AbortSignal))
      await response.text()
    },
  )

  it('rejects malformed JSON and invalid UTF-8 without reflecting request bytes', async () => {
    const origin = await start()
    for (const body of [Buffer.from('not-json-private-text'), Buffer.from([0xff, 0xfe])]) {
      const response = await rawPost(origin, body)
      expect(response.status).toBe(400)
      expect(response.body).not.toContain('private-text')
    }
    expect(synthesize).not.toHaveBeenCalled()
  })

  it.each([true, false])('bounds both declared and chunked bodies (content length=%s)', async declared => {
    const origin = await start()
    const body = Buffer.alloc(LOCAL_TTS_MAX_BODY_BYTES + 1, ' ')
    const response = await rawPost(origin, body, declared ? { 'Content-Length': body.length } : {})
    expect(response.status).toBe(413)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('reports upstream errors rather than returning success-shaped empty audio', async () => {
    const origin = await start()
    synthesize.mockRejectedValueOnce(new EdgeTtsError(502))
    const response = await post(origin)
    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ error: 'Edge TTS could not complete synthesis.' })
  })

  it('does not expose unexpected provider details in responses or logs', async () => {
    const origin = await start()
    if (!server) throw new Error('Missing server')
    const log = vi.spyOn(server.config.logger, 'error')
    synthesize.mockRejectedValueOnce(new Error(`upstream-url?token=private ${payload.text}`))
    const response = await post(origin)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Could not synthesize local TTS.' })
    expect(log).toHaveBeenCalledWith('Local TTS failed unexpectedly.')
  })

  it('aborts upstream synthesis on deadline and releases the active slot', async () => {
    const signals: AbortSignal[] = []
    waitForAbort(signals)
    const origin = await start({ timeoutMs: 100 })
    const response = await post(origin)
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'Local TTS request timed out.' })
    expect(signals[0].aborted).toBe(true)
    synthesize.mockResolvedValue(speech)
    expect((await post(origin)).status).toBe(200)
  })

  it('bounds stalled request bodies before opening an upstream connection', async () => {
    const origin = await start({ timeoutMs: 100 })
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(origin + LOCAL_TTS_PATH, { method: 'POST', headers: headers(origin) }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      request.on('error', reject)
      request.write('{"text":')
    })
    expect(status).toBe(504)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('aborts upstream synthesis when the HTTP client disconnects', async () => {
    const signals: AbortSignal[] = []
    waitForAbort(signals)
    const origin = await start()
    const controller = new AbortController()
    const response = fetch(origin + LOCAL_TTS_PATH, {
      method: 'POST', headers: headers(origin), body: JSON.stringify(payload), signal: controller.signal,
    }).catch(error => error)
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    controller.abort()
    await response
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true))
  })

  it('limits concurrent requests and recovers after cancellation', async () => {
    const signals: AbortSignal[] = []
    waitForAbort(signals)
    const origin = await start()
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const pending = controllers.map(controller => fetch(origin + LOCAL_TTS_PATH, {
      method: 'POST', headers: headers(origin), body: JSON.stringify(payload), signal: controller.signal,
    }).catch(error => error))
    try {
      await vi.waitFor(() => expect(signals).toHaveLength(4))
      const response = await post(origin)
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('1')
      expect(synthesize).toHaveBeenCalledTimes(4)
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all(pending)
    }
    await vi.waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true))
    synthesize.mockResolvedValue(speech)
    expect((await post(origin)).status).toBe(200)
  })

  it('aborts active synthesis when the dev server shuts down', async () => {
    const signals: AbortSignal[] = []
    waitForAbort(signals)
    const origin = await start()
    const pending = post(origin).then(response => ({ response }), (error: unknown) => ({ error }))
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    await server?.close()
    server = undefined
    expect(signals[0].aborted).toBe(true)
    const outcome = await pending
    if ('response' in outcome) {
      expect(outcome.response.status).toBe(503)
      await outcome.response.text()
    } else {
      // Vite may destroy the HTTP connection before the shutdown response flushes.
      expect(outcome.error).toMatchObject({ message: 'fetch failed', cause: { code: 'UND_ERR_SOCKET' } })
    }
  })

  it('does not expose the endpoint in production preview', async () => {
    await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'dist', 'index.html'), 'Production app')
    const production = await preview({
      configFile: false, root: directory, plugins: [localTts({ synthesize, listVoices })],
      logLevel: 'silent', appType: 'mpa', preview: { host: '127.0.0.1', port: 0 },
    })
    try {
      const address = production.httpServer.address()
      if (!address || typeof address === 'string') throw new Error('Missing preview address')
      expect((await post(`http://127.0.0.1:${address.port}`)).status).toBe(404)
      expect((await getVoices(`http://127.0.0.1:${address.port}`)).status).toBe(404)
      expect(production.config.define?.['import.meta.env.DEV_LOCAL_TTS']).toBe(JSON.stringify('false'))
      expect(synthesize).not.toHaveBeenCalled()
      expect(listVoices).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => {
        production.httpServer.close(error => error ? reject(error) : resolve())
        if ('closeIdleConnections' in production.httpServer) production.httpServer.closeIdleConnections()
      })
    }
  })
})

describe('development-only Edge voice catalog', () => {
  it('fetches metadata without text, returns the shared JSON shape, and allows explicit refresh', async () => {
    const origin = await start()
    expect(server?.config.define?.['import.meta.env.DEV_LOCAL_TTS']).toBe(JSON.stringify('true'))
    for (let index = 0; index < 2; index++) {
      const response = await getVoices(origin)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      const body = await response.text()
      expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(body)))
      expect(JSON.parse(body)).toEqual({ voices })
    }
    expect(listVoices).toHaveBeenCalledTimes(2)
    expect(listVoices).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('supports both canonical and configured-base catalog paths without claiming child paths', async () => {
    const origin = await start({ base: '/langapp/' })
    for (const path of [LOCAL_TTS_VOICES_PATH, `/langapp${LOCAL_TTS_VOICES_PATH}?refresh=1`]) {
      const response = await fetch(origin + path, { headers: headers(origin) })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ voices })
    }
    expect((await fetch(origin + `/langapp${LOCAL_TTS_VOICES_PATH}/unrelated`)).status).toBe(404)
    expect(listVoices).toHaveBeenCalledTimes(2)
  })

  it.each([
    {}, { Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { [LOCAL_TTS_HEADER]: '0' },
  ])('rejects missing intent and foreign origins before listing voices (case %#)', async changes => {
    const origin = await start()
    const response = await fetch(origin + LOCAL_TTS_VOICES_PATH, {
      headers: Object.keys(changes).length ? { ...headers(origin), ...changes } : {},
    })
    expect(response.status).toBe(403)
    expect(listVoices).not.toHaveBeenCalled()
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('rejects foreign hosts and mismatched loopback origins using the existing request guard', async () => {
    const origin = await start()
    for (const changes of [{ Host: 'attacker.example' }, { Origin: origin.replace('127.0.0.1', 'localhost') }]) {
      expect((await rawRequest(origin, LOCAL_TTS_VOICES_PATH, 'GET', Buffer.alloc(0), changes)).status).toBe(403)
    }
    expect(listVoices).not.toHaveBeenCalled()
  })

  it.each(['POST', 'HEAD', 'PUT', 'OPTIONS'])('allows catalog GET only, not %s', async method => {
    const origin = await start()
    const response = await fetch(origin + LOCAL_TTS_VOICES_PATH, { method, headers: headers(origin) })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(listVoices).not.toHaveBeenCalled()
    expect(synthesize).not.toHaveBeenCalled()
  })

  it.each([502, 504] as const)('propagates safe catalog provider status %s', async status => {
    listVoices.mockRejectedValueOnce(new EdgeTtsError(status, 'catalog'))
    const response = await getVoices(await start())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({
      error: status === 504 ? 'Edge TTS timed out.' : 'Edge TTS could not load the voice catalog.',
    })
  })

  it.each([null, {}, [{ id: 'en-US-AriaNeural' }], [{ ...voices[0], id: 'fr-FR-DeniseNeural' }]])(
    'rejects invalid injected catalog results rather than returning HTTP 200 (case %#)', async value => {
      listVoices.mockResolvedValueOnce(value as EdgeVoice[])
      const response = await getVoices(await start())
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'Edge TTS could not load the voice catalog.' })
    },
  )

  it('sanitizes unexpected catalog failures in both HTTP responses and logs', async () => {
    const origin = await start()
    if (!server) throw new Error('Missing server')
    const log = vi.spyOn(server.config.logger, 'error')
    listVoices.mockRejectedValueOnce(new Error('private upstream catalog URL and response'))
    const response = await getVoices(origin)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Could not load local TTS voices.' })
    expect(log).toHaveBeenCalledWith('Local TTS failed unexpectedly.')
  })

  it('applies the endpoint deadline and frees the catalog concurrency slot', async () => {
    const signals: AbortSignal[] = []
    waitForCatalogAbort(signals)
    const origin = await start({ timeoutMs: 100 })
    const response = await getVoices(origin)
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'Local TTS request timed out.' })
    expect(signals[0].aborted).toBe(true)
    listVoices.mockResolvedValue(voices)
    expect((await getVoices(origin)).status).toBe(200)
  })

  it('aborts the upstream catalog lookup when the client disconnects', async () => {
    const signals: AbortSignal[] = []
    waitForCatalogAbort(signals)
    const origin = await start()
    const controller = new AbortController()
    const pending = fetch(origin + LOCAL_TTS_VOICES_PATH, {
      headers: headers(origin), signal: controller.signal,
    }).catch(error => error)
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    controller.abort()
    await pending
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true))
  })

  it('shares the concurrency limit between catalog and synthesis and recovers after cancellation', async () => {
    const signals: AbortSignal[] = []
    waitForCatalogAbort(signals)
    waitForAbort(signals)
    const origin = await start()
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const pending = controllers.map((controller, index) => fetch(origin + (index < 2 ? LOCAL_TTS_PATH : LOCAL_TTS_VOICES_PATH), {
      method: index < 2 ? 'POST' : 'GET', body: index < 2 ? JSON.stringify(payload) : undefined,
      headers: headers(origin), signal: controller.signal,
    }).catch(error => error))
    try {
      await vi.waitFor(() => expect(signals).toHaveLength(4))
      for (const response of [await getVoices(origin), await post(origin)]) {
        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('1')
      }
      expect(listVoices).toHaveBeenCalledTimes(2)
      expect(synthesize).toHaveBeenCalledTimes(2)
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all(pending)
    }
    await vi.waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true))
    listVoices.mockResolvedValue(voices)
    expect((await getVoices(origin)).status).toBe(200)
  })

  it('aborts active catalog requests when the dev server shuts down', async () => {
    const signals: AbortSignal[] = []
    waitForCatalogAbort(signals)
    const origin = await start()
    const pending = getVoices(origin).then(response => ({ response }), (error: unknown) => ({ error }))
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    await server?.close()
    server = undefined
    expect(signals[0].aborted).toBe(true)
    const outcome = await pending
    if ('response' in outcome) {
      expect(outcome.response.status).toBe(503)
      await outcome.response.text()
    } else {
      expect(outcome.error).toMatchObject({ message: 'fetch failed', cause: { code: 'UND_ERR_SOCKET' } })
    }
  })

  it('does not install local TTS routes or its enabled flag in a production build', async () => {
    const config = await resolveConfig({
      configFile: false, root: directory, plugins: [localTts({ synthesize, listVoices })], logLevel: 'silent',
    }, 'build')
    expect(config.plugins.some(plugin => plugin.name === 'local-edge-tts')).toBe(false)
    expect(config.define?.['import.meta.env.DEV_LOCAL_TTS']).toBeUndefined()
  })
})

describe('shared local request guard', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts loopback connections from %s', remoteAddress => {
    expect(isLocalRequest({
      headers: { host: 'localhost:5173', [LOCAL_TTS_HEADER]: '1' }, socket: { remoteAddress },
    }, 'http', LOCAL_TTS_HEADER)).toBe(true)
  })

  it.each([undefined, '192.168.1.10', '203.0.113.4'])('rejects remote or unknown peers even with a loopback Host (%s)', remoteAddress => {
    expect(isLocalRequest({
      headers: { host: 'localhost:5173', [LOCAL_TTS_HEADER]: '1' }, socket: { remoteAddress },
    }, 'http', LOCAL_TTS_HEADER)).toBe(false)
  })

  it.each(['attacker.example', 'user:password@localhost:5173', '[invalid'])('rejects an untrusted host %s', host => {
    expect(isLocalRequest({
      headers: { host, [LOCAL_TTS_HEADER]: '1' }, socket: { remoteAddress: '127.0.0.1' },
    }, 'http', LOCAL_TTS_HEADER)).toBe(false)
  })
})
