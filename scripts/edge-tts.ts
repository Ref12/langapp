import { createHash, randomBytes } from 'node:crypto'
import type { ClientRequest, IncomingMessage } from 'node:http'
import WebSocket, { type RawData } from 'ws'
import { z } from 'zod'
import { edgeVoiceIdSchema } from '../src/core/assistant/contracts'
import type { LocalTtsRequest, LocalTtsWordBoundary } from '../src/core/local-tts-contracts'

// Public client identification, not a user credential. Protocol reference:
// https://github.com/rany2/edge-tts/blob/master/src/edge_tts/constants.py
const CLIENT_ID = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CLIENT_VERSION = '143.0.3650.75'
const CLIENT_MAJOR_VERSION = CLIENT_VERSION.split('.')[0]
const CONNECT_TIMEOUT_MS = 10_000
const OVERALL_TIMEOUT_MS = 30_000
const MAX_AUDIO_BYTES = 2 * 1024 * 1024
const MAX_FRAME_BYTES = 256 * 1024
const MAX_METADATA_BYTES = 512 * 1024
const MAX_WORD_BOUNDARIES = 1000
const MAX_METADATA_ENTRIES = 4096
const TICKS_PER_SECOND = 10_000_000
const MAX_HEADER_BYTES = 8 * 1024
const MAX_FRAMES = 4096
const utf8 = new TextDecoder('utf-8', { fatal: true })
const ticksSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const metadataSchema = z.object({
  Metadata: z.array(z.discriminatedUnion('Type', [
    z.object({
      Type: z.literal('WordBoundary'),
      Data: z.object({
        Offset: ticksSchema,
        Duration: ticksSchema,
        text: z.object({ Text: z.string().min(1).max(6000) }),
      }).refine(data => data.Offset <= Number.MAX_SAFE_INTEGER - data.Duration),
    }),
    z.object({ Type: z.literal('SentenceBoundary') }),
    z.object({ Type: z.literal('SessionEnd') }),
  ])).max(MAX_METADATA_ENTRIES),
})
const xmlEntities: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
}

export interface EdgeTtsResult {
  audio: Buffer
  wordBoundaries: LocalTtsWordBoundary[]
}

export class EdgeTtsError extends Error {
  constructor(readonly status: 502 | 504, operation: 'synthesis' | 'catalog' = 'synthesis') {
    super(status === 504 ? 'Edge TTS timed out.' : operation === 'catalog'
      ? 'Edge TTS could not load the voice catalog.' : 'Edge TTS could not complete synthesis.')
    this.name = 'EdgeTtsError'
  }
}

export function buildEdgeUrl(endpoint: 'synthesis' | 'voices'): URL {
  const windowsSeconds = BigInt(Math.floor(Date.now() / 1000)) + 11_644_473_600n
  const ticks = (windowsSeconds - windowsSeconds % 300n) * 10_000_000n
  const gec = createHash('sha256').update(`${ticks}${CLIENT_ID}`).digest('hex').toUpperCase()
  const url = new URL(endpoint === 'voices'
    ? 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list'
    : 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1')
  url.searchParams.set(endpoint === 'voices' ? 'trustedclienttoken' : 'TrustedClientToken', CLIENT_ID)
  url.searchParams.set('Sec-MS-GEC', gec)
  url.searchParams.set('Sec-MS-GEC-Version', `1-${CLIENT_VERSION}`)
  if (endpoint === 'synthesis') url.searchParams.set('ConnectionId', randomBytes(16).toString('hex'))
  return url
}

export function edgeClientHeaders(endpoint: 'synthesis' | 'voices'): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + `(KHTML, like Gecko) Chrome/${CLIENT_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CLIENT_MAJOR_VERSION}.0.0.0`,
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
    ...(endpoint === 'synthesis' ? {
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    } : {
      Authority: 'speech.platform.bing.com',
      'Sec-CH-UA': `" Not;A Brand";v="99", "Microsoft Edge";v="${CLIENT_MAJOR_VERSION}", "Chromium";v="${CLIENT_MAJOR_VERSION}"`,
      'Sec-CH-UA-Mobile': '?0',
      Accept: '*/*',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    }),
  }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!)
}

function requestFrames(request: LocalTtsRequest, requestId: string): [string, string] {
  const timestamp = new Date().toUTCString().replace(
    /^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/,
    '$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)',
  )
  const separator = request.voice.lastIndexOf('-')
  const locale = request.voice.slice(0, separator)
  const voice = `Microsoft Server Speech Text to Speech Voice (${locale}, ${request.voice.slice(separator + 1)})`
  const rate = request.voice.startsWith('en-') ? '+0%' : ({
    0.5: '-50%', 0.75: '-25%', 0.85: '-15%', 1: '+0%', 1.25: '+25%',
  } as const)[request.rate]
  const config = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        },
      },
    },
  })
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`
    + `<voice name="${escapeXml(voice)}"><prosody pitch="+0Hz" rate="${rate}" volume="+0%">`
    + `${escapeXml(request.text)}</prosody></voice></speak>`
  return [
    `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}\r\n`,
    // The trailing Z on the already formatted SSML timestamp is part of the wire protocol.
    `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`,
  ]
}

function parseHeaders(bytes: Buffer): Map<string, string> {
  if (bytes.length === 0 || bytes.length > MAX_HEADER_BYTES) throw new EdgeTtsError(502)
  const lines = utf8.decode(bytes).replace(/\r\n$/, '').split('\r\n')
  if (lines.length > 32) throw new EdgeTtsError(502)
  const headers = new Map<string, string>()
  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):([^\r\n]*)$/.exec(line)
    if (!match || Array.from(match[2]).some(character => {
      const code = character.charCodeAt(0)
      return (code < 32 && code !== 9) || code === 127
    })) throw new EdgeTtsError(502)
    const key = match[1].toLowerCase()
    if (headers.has(key)) throw new EdgeTtsError(502)
    headers.set(key, match[2].trim())
  }
  return headers
}

function frameBuffer(data: RawData): Buffer {
  const size = Array.isArray(data)
    ? data.reduce((total, part) => total + part.length, 0)
    : data.byteLength
  if (size > MAX_FRAME_BYTES) throw new EdgeTtsError(502)
  return Array.isArray(data) ? Buffer.concat(data, size) : Buffer.isBuffer(data) ? data : Buffer.from(data)
}

function providerFailed(value: Record<string, unknown>): boolean {
  const pending: unknown[] = [value]
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== 'object') continue
    for (const [key, field] of Object.entries(current)) {
      if (/^(?:x-)?error(?:-?code|-?details|-?message)?$/i.test(key) && field) return true
      if (/^(?:x-)?status(?:-?code)?$/i.test(key)
        && (Number(field) >= 400 || /^(?:error|failed|failure)$/i.test(String(field)))) return true
      if (field && typeof field === 'object') pending.push(field)
    }
  }
  return false
}

function parseWordBoundaries(value: unknown): LocalTtsWordBoundary[] {
  const metadata = metadataSchema.safeParse(value)
  if (!metadata.success) throw new EdgeTtsError(502)
  return metadata.data.Metadata.flatMap(item => item.Type === 'WordBoundary' ? [{
    text: item.Data.text.Text.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => xmlEntities[entity]),
    startTime: item.Data.Offset / TICKS_PER_SECOND,
    duration: item.Data.Duration / TICKS_PER_SECOND,
  }] : [])
}

function stopSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.CLOSED) return
  // ws emits an asynchronous error when terminate() interrupts a handshake.
  // Keep only this drain listener until close, then release it too.
  const ignoreError = () => {}
  socket.on('error', ignoreError)
  socket.once('close', () => socket.off('error', ignoreError))
  socket.terminate()
}

export async function synthesizeEdgeSpeech(request: LocalTtsRequest, signal: AbortSignal): Promise<EdgeTtsResult> {
  const abortReason = () => signal.reason ?? Object.assign(new Error('Speech synthesis was aborted.'), { name: 'AbortError' })
  if (signal.aborted) throw abortReason()
  if (!edgeVoiceIdSchema.safeParse(request.voice).success) throw new EdgeTtsError(502)

  return new Promise<EdgeTtsResult>((resolve, reject) => {
    let socket: WebSocket | undefined
    let settled = false
    let opened = false
    let audioBytes = 0
    let metadataBytes = 0
    let frames = 0
    const chunks: Buffer[] = []
    const wordBoundaries: LocalTtsWordBoundary[] = []
    const requestId = randomBytes(16).toString('hex')
    const connectTimer = setTimeout(() => finish(new EdgeTtsError(504)), CONNECT_TIMEOUT_MS)
    const overallTimer = setTimeout(() => finish(new EdgeTtsError(504)), OVERALL_TIMEOUT_MS)

    function finish(error?: unknown, audio?: Buffer): void {
      if (settled) return
      settled = true
      clearTimeout(connectTimer)
      clearTimeout(overallTimer)
      signal.removeEventListener('abort', onAbort)
      if (socket) {
        socket.off('open', onOpen)
        socket.off('message', onMessage)
        socket.off('error', onError)
        socket.off('close', onClose)
        socket.off('unexpected-response', onUnexpectedResponse)
        stopSocket(socket)
      }
      chunks.length = 0
      if (audio) resolve({ audio, wordBoundaries: [...wordBoundaries] })
      else reject(error)
      wordBoundaries.length = 0
    }

    function onAbort(): void { finish(abortReason()) }
    function onError(): void { finish(new EdgeTtsError(502)) }
    function onClose(): void { onError() }
    function onUnexpectedResponse(_request: ClientRequest, response: IncomingMessage): void {
      onError()
      response.destroy()
    }
    function onOpen(): void {
      if (settled || !socket) return
      opened = true
      clearTimeout(connectTimer)
      try {
        for (const frame of requestFrames(request, requestId)) {
          if (settled) break
          socket.send(frame, error => { if (error) onError() })
        }
      } catch {
        onError()
      }
    }

    function onMessage(data: RawData, isBinary: boolean): void {
      if (settled) return
      try {
        if (!opened || ++frames > MAX_FRAMES) throw new EdgeTtsError(502)
        const frame = frameBuffer(data)
        let headers: Map<string, string>
        let body: Buffer
        if (isBinary) {
          if (frame.length < 2) throw new EdgeTtsError(502)
          const headerLength = frame.readUInt16BE(0)
          if (headerLength > frame.length - 2) throw new EdgeTtsError(502)
          // The length counts header bytes, including their trailing CRLF,
          // but excludes the two-byte length prefix. Never skip audio bytes.
          const header = frame.subarray(2, 2 + headerLength)
          if (header.length < 2 || header.readUInt16BE(header.length - 2) !== 0x0d0a) {
            throw new EdgeTtsError(502)
          }
          headers = parseHeaders(header)
          body = frame.subarray(2 + headerLength)
        } else {
          metadataBytes += frame.length
          if (metadataBytes > MAX_METADATA_BYTES) throw new EdgeTtsError(502)
          const boundary = frame.indexOf('\r\n\r\n')
          if (boundary < 0) throw new EdgeTtsError(502)
          headers = parseHeaders(frame.subarray(0, boundary))
          body = frame.subarray(boundary + 4)
        }
        const responseId = headers.get('x-requestid')
        if (responseId && responseId.toLowerCase() !== requestId) throw new EdgeTtsError(502)
        if (providerFailed(Object.fromEntries(headers))) throw new EdgeTtsError(502)
        const path = headers.get('path')
        const contentType = headers.get('content-type')?.toLowerCase()
        if (isBinary) {
          if (path !== 'audio') throw new EdgeTtsError(502)
          if (!contentType && body.length === 0) return
          if (contentType !== 'audio/mpeg' || body.length === 0) throw new EdgeTtsError(502)
          audioBytes += body.length
          if (audioBytes > MAX_AUDIO_BYTES) throw new EdgeTtsError(502)
          chunks.push(Buffer.from(body))
          return
        }
        if (!['turn.start', 'response', 'audio.metadata', 'turn.end'].includes(path ?? '')) {
          throw new EdgeTtsError(502)
        }
        if (contentType && !/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
          throw new EdgeTtsError(502)
        }
        const text = utf8.decode(body).trim()
        if (text) {
          const parsed: unknown = JSON.parse(text)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            || providerFailed(parsed as Record<string, unknown>)) throw new EdgeTtsError(502)
          if (path === 'audio.metadata') {
            for (const boundary of parseWordBoundaries(parsed)) {
              const previous = wordBoundaries.at(-1)
              if (wordBoundaries.length >= MAX_WORD_BOUNDARIES
                || (previous && boundary.startTime < previous.startTime)) throw new EdgeTtsError(502)
              wordBoundaries.push(boundary)
            }
          }
        } else if (path === 'response' || path === 'audio.metadata') {
          throw new EdgeTtsError(502)
        }
        if (path === 'turn.end') {
          if (audioBytes === 0) throw new EdgeTtsError(502)
          finish(undefined, Buffer.concat(chunks, audioBytes))
        }
      } catch {
        onError()
      }
    }

    try {
      socket = new WebSocket(buildEdgeUrl('synthesis'), {
        handshakeTimeout: CONNECT_TIMEOUT_MS,
        maxPayload: MAX_FRAME_BYTES,
        followRedirects: false,
        perMessageDeflate: false,
        headers: edgeClientHeaders('synthesis'),
      })
      socket.once('open', onOpen)
      socket.on('message', onMessage)
      socket.on('error', onError)
      socket.once('close', onClose)
      socket.once('unexpected-response', onUnexpectedResponse)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    } catch {
      onError()
    }
  })
}
