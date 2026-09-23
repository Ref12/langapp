// @vitest-environment node
import { randomUUID, webcrypto } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { createServer, preview, type ViteDevServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_TTS_HEADER, LOCAL_TTS_MAX_BODY_BYTES, LOCAL_TTS_PATH, localTtsRequestSchema,
} from '../src/core/local-tts-contracts'
import { EdgeTtsError, type synthesizeEdgeSpeech } from './edge-tts'
import { isLocalRequest } from './local-request'
import { localTts } from './local-tts'

const payload = { text: 'A synthetic test phrase.', voice: 'en-US-AriaNeural', rate: 0.75 }
const audio = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x01, 0x02])
const synthesize = vi.fn<typeof synthesizeEdgeSpeech>()
let directory: string
let server: ViteDevServer | undefined

beforeEach(async () => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto)
  directory = join(process.cwd(), `.local-tts-test-${randomUUID()}`)
  await mkdir(directory)
  synthesize.mockReset().mockResolvedValue(audio)
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
    configFile: false, root: directory, base, plugins: [localTts({ synthesize, timeoutMs })],
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
  return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest(origin + LOCAL_TTS_PATH, {
      method: 'POST', headers: { ...headers(origin), ...changes },
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
    return new Promise<Buffer>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
}

describe('development-only local TTS', () => {
  it('returns the exact completed MP3 without caching or permissive CORS', async () => {
    const origin = await start()
    const response = await post(origin)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('content-length')).toBe(String(audio.length))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(Buffer.from(await response.arrayBuffer())).toEqual(audio)
    expect(synthesize).toHaveBeenCalledWith(payload, expect.any(AbortSignal))
  })

  it('normalizes input and defaults the rate without inventing a voice', async () => {
    const origin = await start()
    const response = await post(origin, { text: '  Synthetic phrase. \n', voice: 'zh-CN-XiaoxiaoNeural' })
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    expect(synthesize.mock.calls[0][0]).toEqual({ text: 'Synthetic phrase.', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 })
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
    for (const rate of [0.5, 0.75, 1, 1.25]) {
      expect(localTtsRequestSchema.safeParse({ ...payload, text: 'Hello \u{1f600}\t\n<&>', rate }).success).toBe(true)
    }
  })

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
    synthesize.mockRejectedValueOnce(new EdgeTtsError(502, 'Edge TTS could not complete synthesis.'))
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
    synthesize.mockResolvedValue(audio)
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
    synthesize.mockResolvedValue(audio)
    expect((await post(origin)).status).toBe(200)
  })

  it('aborts active synthesis when the dev server shuts down', async () => {
    const signals: AbortSignal[] = []
    waitForAbort(signals)
    const origin = await start()
    const pending = post(origin)
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    await server?.close()
    server = undefined
    expect(signals[0].aborted).toBe(true)
    const response = await pending
    expect(response.status).toBe(503)
    await response.text()
  })

  it('does not expose the endpoint in production preview', async () => {
    await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'dist', 'index.html'), 'Production app')
    const production = await preview({
      configFile: false, root: directory, plugins: [localTts({ synthesize })],
      logLevel: 'silent', appType: 'mpa', preview: { host: '127.0.0.1', port: 0 },
    })
    try {
      const address = production.httpServer.address()
      if (!address || typeof address === 'string') throw new Error('Missing preview address')
      expect((await post(`http://127.0.0.1:${address.port}`)).status).toBe(404)
      expect(synthesize).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => {
        production.httpServer.close(error => error ? reject(error) : resolve())
        production.httpServer.closeIdleConnections()
      })
    }
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
