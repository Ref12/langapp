// @vitest-environment node
import type { EventEmitter } from 'node:events'
import type { ClientOptions, RawData } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalTtsRequest } from '../src/core/local-tts-contracts'
import { EdgeTtsError, synthesizeEdgeSpeech } from './edge-tts'

type SendCallback = (error?: Error) => void
interface TestSocket extends EventEmitter {
  readyState: number
  url: URL
  options: ClientOptions
  sent: string[]
  callbacks: SendCallback[]
  send: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
  open(): void
  peerClose(): void
}

const mock = vi.hoisted(() => ({
  sockets: [] as TestSocket[],
  constructorError: undefined as Error | undefined,
  onConstruct: undefined as (() => void) | undefined,
  sendError: undefined as Error | undefined,
  sendThrow: undefined as Error | undefined,
}))

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class MockWebSocket extends EventEmitter {
    static CLOSED = 3
    readyState = 0
    sent: string[] = []
    callbacks: SendCallback[] = []

    constructor(readonly url: URL, readonly options: ClientOptions) {
      super()
      if (mock.constructorError) throw mock.constructorError
      mock.sockets.push(this)
      mock.onConstruct?.()
    }

    send = vi.fn((frame: string, callback: SendCallback) => {
      if (mock.sendThrow) throw mock.sendThrow
      this.sent.push(frame)
      this.callbacks.push(callback)
      if (mock.sendError) callback(mock.sendError)
    })

    terminate = vi.fn(() => {
      if (this.readyState === 3) return
      const wasConnecting = this.readyState === 0
      this.readyState = 2
      void Promise.resolve().then(() => {
        if (wasConnecting) this.emit('error', new Error('Synthetic handshake cancellation'))
        this.peerClose()
      })
    })

    open(): void {
      this.readyState = 1
      this.emit('open')
    }

    peerClose(): void {
      this.readyState = 3
      this.emit('close', 1006, Buffer.from('Synthetic private upstream close reason'))
    }
  }
  return { default: MockWebSocket }
})

const request: LocalTtsRequest = { text: 'Synthetic text only.', voice: 'zh-CN-XiaoxiaoNeural', rate: 1 }
const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x0d, 0x0a, 0x00, 0x01])
const safeMessage = 'Edge TTS could not complete synthesis.'
const privateError = new Error('Synthetic private URL/token/text/SSML upstream details')
const frameLimit = 256 * 1024
const audioLimit = 2 * 1024 * 1024

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-22T12:34:59.999Z'))
  mock.sockets.length = 0
  mock.constructorError = undefined
  mock.onConstruct = undefined
  mock.sendError = undefined
  mock.sendThrow = undefined
})

afterEach(async () => {
  await Promise.resolve()
  expect(vi.getTimerCount()).toBe(0)
  for (const socket of mock.sockets) {
    expect(socket.readyState).toBe(3)
    expect(socket.eventNames()).toEqual([])
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function start(value: LocalTtsRequest = request, open = true) {
  const controller = new AbortController()
  const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
  const result = synthesizeEdgeSpeech(value, controller.signal)
  const socket = mock.sockets[mock.sockets.length - 1]
  if (open) socket.open()
  return { result, socket, controller, removeAbort }
}

function textFrame(path: string, body = '', headers = ''): Buffer {
  return Buffer.from(`Path:${path}\r\n${headers}\r\n${body}`)
}

function wordMetadata(text: unknown = 'Hello', offset: unknown = 1_000_000, duration: unknown = 2_000_000) {
  return { Type: 'WordBoundary', Data: { Offset: offset, Duration: duration, text: { Text: text } } }
}

function metadataFrame(...items: unknown[]): Buffer {
  return textFrame('audio.metadata', JSON.stringify({ Metadata: items }))
}

function binaryFrame(body = mp3, headers = 'Path:audio\r\nContent-Type:audio/mpeg\r\n'): Buffer {
  const header = Buffer.from(headers)
  const prefix = Buffer.alloc(2)
  prefix.writeUInt16BE(header.length)
  return Buffer.concat([prefix, header, body])
}

function receive(socket: TestSocket, frame: RawData, binary = false): void {
  socket.emit('message', frame, binary)
}

function complete(socket: TestSocket): void {
  receive(socket, binaryFrame(), true)
  receive(socket, textFrame('turn.end'))
}

function assertSafeFailure(result: ReturnType<typeof synthesizeEdgeSpeech>, status: 502 | 504 = 502) {
  return expect(result).rejects.toMatchObject({
    name: 'EdgeTtsError',
    status,
    message: status === 504 ? 'Edge TTS timed out.' : safeMessage,
  })
}

describe('Edge speech request protocol', () => {
  it('uses only the pinned host, Edge identity, generated identifiers and safe socket options', async () => {
    const { socket, result } = start()
    expect(socket.url.protocol).toBe('wss:')
    expect(socket.url.hostname).toBe('speech.platform.bing.com')
    expect(socket.url.pathname).toBe('/consumer/speech/synthesize/readaloud/edge/v1')
    expect([...socket.url.searchParams.keys()].sort()).toEqual([
      'ConnectionId', 'Sec-MS-GEC', 'Sec-MS-GEC-Version', 'TrustedClientToken',
    ])
    expect(socket.url.searchParams.get('TrustedClientToken')?.length).toBe(32)
    expect(socket.url.searchParams.get('ConnectionId')).toMatch(/^[a-f0-9]{32}$/)
    expect(socket.url.searchParams.get('Sec-MS-GEC-Version')).toBe('1-143.0.3650.75')
    expect(socket.options).toMatchObject({
      handshakeTimeout: 10_000, maxPayload: frameLimit, followRedirects: false, perMessageDeflate: false,
    })
    expect(socket.options.rejectUnauthorized).not.toBe(false)
    const headers = socket.options.headers!
    expect(headers['User-Agent']).toMatch(/Chrome\/143\.0\.0\.0.+Edg\/143\.0\.0\.0$/)
    expect(headers['Accept-Language']).toBe('en-US,en;q=0.9')
    expect(headers.Origin).toBe('chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold')
    expect(headers.Cookie).toMatch(/^muid=[A-F0-9]{32};$/)
    complete(socket)
    await expect(result).resolves.toEqual({ audio: mp3, wordBoundaries: [] })
  })

  it.each([
    ['2026-09-22T12:30:00Z', '6043E00D83E4740FEAE1FAB745400A2AE23270E93B1CBB4B6C2A825305EC1BCA'],
    ['2026-09-22T12:34:59.999Z', '6043E00D83E4740FEAE1FAB745400A2AE23270E93B1CBB4B6C2A825305EC1BCA'],
    ['2026-09-22T12:35:00Z', '3307D3E8192CD2D78E0EFF2A53A8CFD4201DF3DB9B9E652FDC144AC0B074CC14'],
    ['1970-01-01T00:00:00Z', '7ECB79D14E3AA576D2D79E6D487A1388156D91E614B1BE11C64226A29BC8DD8C'],
  ])('computes the Windows-epoch, five-minute GEC vector at %s', async (date, expected) => {
    vi.setSystemTime(new Date(date))
    const { socket, result } = start()
    expect(socket.url.searchParams.get('Sec-MS-GEC')).toBe(expected)
    complete(socket)
    await result
  })

  it('sends text configuration before escaped SSML with protocol headers and timestamps', async () => {
    const { socket, result } = start({ ...request, text: `A & B <tag> "quoted" 'text' 中文\nnext` })
    expect(socket.sent).toHaveLength(2)
    const [config, ssml] = socket.sent
    const [configHeaders, configBody] = config.split('\r\n\r\n')
    expect(configHeaders).toBe(
      'X-Timestamp:Tue Sep 22 2026 12:34:59 GMT+0000 (Coordinated Universal Time)\r\n'
      + 'Content-Type:application/json; charset=utf-8\r\nPath:speech.config',
    )
    expect(JSON.parse(configBody)).toEqual({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          },
        },
      },
    })
    expect(ssml).toMatch(/^X-RequestId:[a-f0-9]{32}\r\nContent-Type:application\/ssml\+xml\r\n/)
    expect(ssml).toContain('GMT+0000 (Coordinated Universal Time)Z\r\nPath:ssml\r\n\r\n')
    expect(ssml).toContain('xml:lang="zh-CN"')
    expect(ssml).toContain('name="Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)"')
    expect(ssml).toContain('<prosody pitch="+0Hz" rate="+0%" volume="+0%">')
    expect(ssml).toContain('A &amp; B &lt;tag&gt; &quot;quoted&quot; &apos;text&apos; 中文\nnext')
    expect(ssml).toMatch(/<\/prosody><\/voice><\/speak>$/)
    complete(socket)
    await result
  })

  it.each([
    [0.5, '-50%'], [0.75, '-25%'], [0.85, '-15%'], [1, '+0%'], [1.25, '+25%'],
  ] as const)('maps Mandarin rate %s exactly to %s', async (rate, expected) => {
    const { socket, result } = start({ ...request, rate })
    expect(socket.sent[1]).toContain(`rate="${expected}"`)
    complete(socket)
    await result
  })

  it.each(['en-US-AriaNeural', 'en-GB-SoniaNeural', 'en-AU-NatashaNeural', 'en-IN-NeerjaNeural'])(
    'keeps English %s at normal speed for every requested rate', async voice => {
      for (const rate of [0.5, 0.75, 0.85, 1, 1.25] as const) {
        const { socket, result } = start({ ...request, voice, rate })
        expect(socket.sent[1]).toContain('rate="+0%"')
        expect(socket.sent[1]).toContain(`xml:lang="${voice.slice(0, 5)}"`)
        complete(socket)
        await result
      }
    },
  )

  it.each([
    ['zh-CN-liaoning-XiaobeiNeural', 'zh-CN-liaoning', 'XiaobeiNeural'],
    ['zh-CN-shaanxi-XiaoniNeural', 'zh-CN-shaanxi', 'XiaoniNeural'],
    ['zh-TW-HsiaoChenNeural', 'zh-TW', 'HsiaoChenNeural'],
    ['zh-SG-YanlinNeural', 'zh-SG', 'YanlinNeural'],
  ])('converts %s into the provider full voice name without losing regional segments', async (voice, locale, name) => {
    const { socket, result } = start({ ...request, voice, rate: 0.85 })
    expect(socket.sent[1]).toContain(`xml:lang="${locale}"`)
    expect(socket.sent[1]).toContain(`name="Microsoft Server Speech Text to Speech Voice (${locale}, ${name})"`)
    expect(socket.sent[1]).toContain('rate="-15%"')
    complete(socket)
    await result
  })

  it.each(['fr-FR-DeniseNeural', 'zh-HK-HiuGaaiNeural', 'en-US-X"Neural', 'zh-CN"><voice-XNeural'])(
    'rejects unsafe or unsupported voice %s before opening the socket', async voice => {
      await assertSafeFailure(synthesizeEdgeSpeech({ ...request, voice }, new AbortController().signal))
      expect(mock.sockets).toHaveLength(0)
    },
  )

  it('does not reuse connection IDs, request IDs or synthetic cookies', async () => {
    const first = start()
    complete(first.socket)
    await first.result
    const second = start()
    expect(second.socket.url.searchParams.get('ConnectionId')).not.toBe(first.socket.url.searchParams.get('ConnectionId'))
    expect(second.socket.sent[1].split('\r\n')[0]).not.toBe(first.socket.sent[1].split('\r\n')[0])
    expect(second.socket.options.headers!.Cookie).not.toBe(first.socket.options.headers!.Cookie)
    complete(second.socket)
    await second.result
  })
})

describe('bounded Edge speech response parsing', () => {
  it('returns exact MP3 bytes only after turn.end, preserving the first audio bytes', async () => {
    const { socket, result, removeAbort } = start()
    const resolved = vi.fn()
    void result.then(resolved)
    receive(socket, textFrame('turn.start', '{}', 'Content-Type:application/json\r\n'))
    receive(socket, textFrame('response', '{"audio":{"type":"inline"}}', 'Content-Type:application/json; charset=utf-8\r\n'))
    receive(socket, textFrame('audio.metadata', '{"Metadata":[]}'))
    const id = /^X-RequestId:([a-f0-9]+)/.exec(socket.sent[1])![1]
    const headers = `X-RequestId:${id}\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n`
    receive(socket, binaryFrame(mp3, headers), true)
    receive(socket, binaryFrame(Buffer.from([0x0d, 0x0a, 0xff, 0xfa]), headers), true)
    receive(socket, binaryFrame(Buffer.alloc(0), 'Path:audio\r\n'), true)
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()
    expect(socket.terminate).not.toHaveBeenCalled()
    receive(socket, textFrame('turn.end', '{}', `X-RequestId:${id}\r\n`))
    await expect(result).resolves.toEqual({
      audio: Buffer.concat([mp3, Buffer.from([0x0d, 0x0a, 0xff, 0xfa])]), wordBoundaries: [],
    })
    expect(socket.terminate).toHaveBeenCalledOnce()
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it.each(['arraybuffer', 'buffers'] as const)('accepts ws RawData represented as %s', async representation => {
    const { socket, result } = start()
    const frame = binaryFrame()
    const raw = representation === 'arraybuffer'
      ? Uint8Array.from(frame).buffer
      : [frame.subarray(0, 7), frame.subarray(7)]
    receive(socket, raw, true)
    receive(socket, textFrame('turn.end'))
    await expect(result).resolves.toEqual({ audio: mp3, wordBoundaries: [] })
  })

  it.each([false, true])('rejects premature close (received audio: %s)', async withAudio => {
    const { socket, result } = start()
    if (withAudio) receive(socket, binaryFrame(), true)
    socket.peerClose()
    await assertSafeFailure(result)
  })

  it('rejects turn.end without audio, even after an empty final audio frame', async () => {
    const { socket, result } = start()
    receive(socket, binaryFrame(Buffer.alloc(0), 'Path:audio\r\n'), true)
    receive(socket, textFrame('turn.end'))
    await assertSafeFailure(result)
  })

  const invalidBinary: [string, () => Buffer][] = [
    ['missing prefix', () => Buffer.from([0])],
    ['zero header length', () => Buffer.from([0, 0])],
    ['header length beyond frame', () => Buffer.from([0, 9, 13, 10])],
    ['header length includes prefix', () => {
      const frame = binaryFrame(Buffer.alloc(0), 'Path:audio\r\n')
      frame.writeUInt16BE(frame.length)
      return frame
    }],
    ['header length omits its trailing CRLF', () => {
      const frame = binaryFrame()
      frame.writeUInt16BE(frame.readUInt16BE(0) - 2)
      return frame
    }],
    ['unterminated header', () => binaryFrame(mp3, 'Path:audio')],
    ['header without colon', () => binaryFrame(mp3, 'Path audio\r\n')],
    ['duplicate path', () => binaryFrame(mp3, 'Path:audio\r\npath:audio\r\n')],
    ['embedded header newline', () => binaryFrame(mp3, 'Path:audio\nbad\r\n')],
    ['wrong path', () => binaryFrame(mp3, 'Path:response\r\nContent-Type:audio/mpeg\r\n')],
    ['missing path', () => binaryFrame(mp3, 'Content-Type:audio/mpeg\r\n')],
    ['wrong content type', () => binaryFrame(mp3, 'Path:audio\r\nContent-Type:audio/wav\r\n')],
    ['audio without content type', () => binaryFrame(mp3, 'Path:audio\r\n')],
    ['empty typed audio', () => binaryFrame(Buffer.alloc(0))],
    ['oversized headers', () => binaryFrame(mp3, `Path:audio\r\nPadding:${'x'.repeat(8192)}\r\n`)],
    ['invalid UTF-8 header', () => {
      const frame = binaryFrame(mp3, 'Path:audio\r\nBad:x\r\n')
      frame[18] = 0xff
      return frame
    }],
  ]

  it.each(invalidBinary)('rejects binary %s', async (_name, makeFrame) => {
    const { socket, result } = start()
    receive(socket, makeFrame(), true)
    await assertSafeFailure(result)
  })

  const invalidText: [string, () => Buffer][] = [
    ['missing separator', () => Buffer.from('Path:turn.end')],
    ['empty headers', () => Buffer.from('\r\n\r\n{}')],
    ['missing path', () => Buffer.from('Content-Type:application/json\r\n\r\n{}')],
    ['unknown path', () => textFrame('unrecognized', '{}')],
    ['provider error path', () => textFrame('error', '{"error":"private details"}')],
    ['wrong content type', () => textFrame('turn.end', '{}', 'Content-Type:text/html\r\n')],
    ['invalid JSON', () => textFrame('turn.end', '{broken')],
    ['nonobject JSON', () => textFrame('turn.end', 'null')],
    ['array JSON', () => textFrame('turn.end', '[]')],
    ['empty response JSON', () => textFrame('response')],
    ['empty metadata JSON', () => textFrame('audio.metadata')],
    ['error JSON', () => textFrame('turn.end', '{"error":{"message":"private upstream details"}}')],
    ['nested provider failure', () => textFrame('response', '{"audio":{"status":"failed"}}')],
    ['provider HTTP status JSON', () => textFrame('response', '{"statusCode":403}')],
    ['provider error headers', () => textFrame('turn.end', '', 'X-Error-Code:Forbidden\r\n')],
    ['wrong request ID', () => textFrame('turn.end', '', 'X-RequestId:unrelated\r\n')],
    ['invalid UTF-8 body', () => Buffer.concat([textFrame('turn.end'), Buffer.from([0xff])])],
    ['too many headers', () => textFrame('turn.end', '', Array.from({ length: 33 }, (_, i) => `Extra${i}:x\r\n`).join(''))],
  ]

  it.each(invalidText)('rejects text %s even after valid audio', async (_name, makeFrame) => {
    const { socket, result } = start()
    receive(socket, binaryFrame(), true)
    receive(socket, makeFrame())
    await assertSafeFailure(result)
  })

  it('rejects messages before the WebSocket opens', async () => {
    const { socket, result } = start(request, false)
    receive(socket, binaryFrame(), true)
    await assertSafeFailure(result)
  })

  it('accepts exactly 2 MiB of audio, but never more', async () => {
    const { socket, result } = start()
    for (let index = 0; index < 16; index++) receive(socket, binaryFrame(Buffer.alloc(128 * 1024, index)), true)
    receive(socket, textFrame('turn.end'))
    const { audio } = await result
    expect(audio.length).toBe(audioLimit)
    expect(audio[0]).toBe(0)
    expect(audio[audio.length - 1]).toBe(15)

    const second = start()
    for (let index = 0; index < 16; index++) receive(second.socket, binaryFrame(Buffer.alloc(128 * 1024)), true)
    receive(second.socket, binaryFrame(Buffer.from([1])), true)
    await assertSafeFailure(second.result)
  })

  it.each(['binary', 'text', 'fragmented'] as const)('rejects oversized %s frames before parsing', async kind => {
    const { socket, result } = start()
    const frame = Buffer.alloc(frameLimit + 1)
    receive(socket, kind === 'fragmented' ? [frame.subarray(0, 5), frame.subarray(5)] : frame, kind !== 'text')
    await assertSafeFailure(result)
  })

  it('caps total metadata, not just individual frame size', async () => {
    const { socket, result } = start()
    const frame = textFrame('audio.metadata', JSON.stringify({ Metadata: [], padding: 'x'.repeat(200_000) }))
    receive(socket, frame)
    receive(socket, frame)
    expect(socket.terminate).not.toHaveBeenCalled()
    receive(socket, frame)
    await assertSafeFailure(result)
  })

  it('bounds the number of empty audio frames', async () => {
    const { socket, result } = start()
    for (let index = 0; index <= 4096; index++) receive(socket, binaryFrame(Buffer.alloc(0), 'Path:audio\r\n'), true)
    await assertSafeFailure(result)
  })
})

describe('Edge word boundary metadata', () => {
  it('collects every word across batches, including metadata after audio, in clip-relative seconds', async () => {
    const { socket, result } = start()
    const resolved = vi.fn()
    void result.then(resolved)
    receive(socket, metadataFrame(
      { Type: 'SentenceBoundary', Data: { text: { Text: 'Not a word boundary.' } } },
      wordMetadata('Hello', 1_250_000, 2_345_678),
      wordMetadata('\u4f60\u597d', 4_000_000, 2_000_000),
    ))
    receive(socket, binaryFrame(), true)
    receive(socket, metadataFrame(wordMetadata('Hello', 10_000_000, 1_000_000), { Type: 'SessionEnd' }))
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()
    receive(socket, textFrame('turn.end'))
    await expect(result).resolves.toEqual({
      audio: mp3,
      wordBoundaries: [
        { text: 'Hello', startTime: 0.125, duration: 0.2345678 },
        { text: '\u4f60\u597d', startTime: 0.4, duration: 0.2 },
        { text: 'Hello', startTime: 1, duration: 0.1 },
      ],
    })
  })

  it('unescapes word text once without treating literal escaped entities as markup', async () => {
    const { socket, result } = start()
    receive(socket, metadataFrame(wordMetadata('&lt;&gt;&amp;&quot;&apos; &amp;lt;')))
    complete(socket)
    expect((await result).wordBoundaries).toEqual([{ text: `<>&"' &lt;`, startTime: 0.1, duration: 0.2 }])
  })

  it('retains zero-length boundaries and submillisecond precision without rounding', async () => {
    const { socket, result } = start()
    receive(socket, metadataFrame(wordMetadata('First', 0, 0), wordMetadata('Second', 1, 1)))
    complete(socket)
    expect((await result).wordBoundaries).toEqual([
      { text: 'First', startTime: 0, duration: 0 },
      { text: 'Second', startTime: 0.0000001, duration: 0.0000001 },
    ])
  })

  it.each([['zh-CN-XiaoxiaoNeural', 0.5], ['en-US-AriaNeural', 1.25]] as const)(
    'does not rescale provider timings for voice %s and requested rate %s', async (voice, rate) => {
      const { socket, result } = start({ ...request, voice, rate })
      receive(socket, metadataFrame(wordMetadata('Word', 10_000_000, 2_000_000)))
      complete(socket)
      expect((await result).wordBoundaries).toEqual([{ text: 'Word', startTime: 1, duration: 0.2 }])
    },
  )

  it.each([
    {}, { Metadata: null }, { Metadata: {} }, { Metadata: [null] },
    { Metadata: [{ Type: 'UnknownBoundary' }] },
    { Metadata: [{ Type: 'WordBoundary' }] },
    { Metadata: [{ Type: 'WordBoundary', Data: null }] },
    { Metadata: [{ Type: 'WordBoundary', Data: { Offset: 1, Duration: 2 } }] },
    { Metadata: [{ Type: 'WordBoundary', Data: { Offset: 1, Duration: 2, text: { Text: 'Word' } }, error: 'Synthetic failure' }] },
  ])('rejects malformed metadata instead of returning incomplete highlighting (case %#)', async metadata => {
    const { socket, result } = start()
    receive(socket, binaryFrame(), true)
    receive(socket, textFrame('audio.metadata', JSON.stringify(metadata)))
    await assertSafeFailure(result)
  })

  it.each([
    wordMetadata('', 0, 1), wordMetadata(null, 0, 1), wordMetadata(12, 0, 1),
    wordMetadata('x'.repeat(6001), 0, 1),
    ...[-1, 0.1, '1000000', null, Number.MAX_SAFE_INTEGER + 1].map(offset => wordMetadata('Word', offset, 1)),
    ...[-1, 0.1, '1000000', null, Number.MAX_SAFE_INTEGER + 1].map(duration => wordMetadata('Word', 0, duration)),
    wordMetadata('Word', Number.MAX_SAFE_INTEGER, 1),
  ])('rejects invalid text or unsafe/noninteger timing ticks (case %#)', async word => {
    const { socket, result } = start()
    receive(socket, metadataFrame(word))
    await assertSafeFailure(result)
  })

  it.each([false, true])('rejects descending word offsets rather than reordering them (separate frames=%s)', async separate => {
    const { socket, result } = start()
    const first = wordMetadata('First', 5_000_000)
    const second = wordMetadata('Second', 1_000_000)
    if (separate) {
      receive(socket, metadataFrame(first))
      receive(socket, metadataFrame(second))
    } else {
      receive(socket, metadataFrame(first, second))
    }
    await assertSafeFailure(result)
  })

  it.each([false, true])('accepts exactly 1000 words plus nonword markers (separate frames=%s)', async separate => {
    const { socket, result } = start()
    const words = Array.from({ length: 1000 }, (_, index) => wordMetadata('Word', index * 100_000, 10_000))
    if (separate) {
      receive(socket, metadataFrame(...words.slice(0, 500)))
      receive(socket, metadataFrame(...words.slice(500), { Type: 'SessionEnd' }))
    } else {
      receive(socket, metadataFrame({ Type: 'SentenceBoundary' }, ...words, { Type: 'SessionEnd' }))
    }
    complete(socket)
    const response = await result
    expect(response.wordBoundaries).toHaveLength(1000)
    expect(response.wordBoundaries.at(-1)).toEqual({ text: 'Word', startTime: 9.99, duration: 0.001 })
    expect(response.audio).toEqual(mp3)
  })

  it.each([false, true])('bounds total word counts even across frames (separate frames=%s)', async separate => {
    const { socket, result } = start()
    const words = Array.from({ length: 1001 }, (_, index) => wordMetadata('Word', index * 100_000, 10_000))
    if (separate) {
      receive(socket, metadataFrame(...words.slice(0, 500)))
      expect(socket.terminate).not.toHaveBeenCalled()
      receive(socket, metadataFrame(...words.slice(500)))
    } else {
      receive(socket, metadataFrame(...words))
    }
    await assertSafeFailure(result)
  })

  it('discards partial timings on cancellation and does not leak them into the next request', async () => {
    const { socket, result, controller } = start()
    receive(socket, metadataFrame(wordMetadata()))
    receive(socket, binaryFrame(), true)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    const next = start()
    complete(next.socket)
    await expect(next.result).resolves.toEqual({ audio: mp3, wordBoundaries: [] })
  })
})

describe('Edge speech failure and cancellation lifecycle', () => {
  it('exposes only fixed safe error messages', () => {
    expect(new EdgeTtsError(502)).toMatchObject({ name: 'EdgeTtsError', status: 502, message: safeMessage })
    expect(new EdgeTtsError(504)).toMatchObject({ name: 'EdgeTtsError', status: 504, message: 'Edge TTS timed out.' })
  })

  it.each([403, 429, 500, 302])('rejects HTTP %s without retry, redirect or upstream details', async statusCode => {
    const { socket, result } = start(request, false)
    const response = { statusCode, destroy: vi.fn() }
    socket.emit('unexpected-response', {}, response)
    await assertSafeFailure(result)
    expect(response.destroy).toHaveBeenCalledOnce()
    expect(socket.terminate).toHaveBeenCalledOnce()
    expect(mock.sockets).toHaveLength(1)
  })

  it.each([false, true])('sanitizes socket errors during %s open state', async open => {
    const { socket, result } = start(request, open)
    socket.emit('error', privateError)
    await assertSafeFailure(result)
  })

  it('sanitizes constructor failures and clears deadlines', async () => {
    mock.constructorError = privateError
    await assertSafeFailure(synthesizeEdgeSpeech(request, new AbortController().signal))
    expect(mock.sockets).toHaveLength(0)
  })

  it.each(['sendError', 'sendThrow'] as const)('sanitizes %s and does not send SSML after failure', async mode => {
    mock[mode] = privateError
    const { socket, result } = start()
    await assertSafeFailure(result)
    expect(socket.send).toHaveBeenCalledOnce()
  })

  it('handles an asynchronous send callback failure', async () => {
    const { socket, result } = start()
    socket.callbacks[0](privateError)
    await assertSafeFailure(result)
  })

  it('does not construct a socket when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(synthesizeEdgeSpeech(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.sockets).toHaveLength(0)
  })

  it.each([false, true])('immediately terminates when aborted (opened: %s) and releases listeners', async open => {
    const { socket, result, controller, removeAbort } = start(request, open)
    const pendingMessage = socket.listeners('message')[0]
    const pendingOpen = socket.listeners('open')[0]
    controller.abort()
    expect(socket.terminate).toHaveBeenCalledOnce()
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
    pendingMessage(binaryFrame(), true)
    pendingOpen?.()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(socket.sent).toHaveLength(open ? 2 : 0)
  })

  it('preserves the supplied abort reason and discards partial audio', async () => {
    const { socket, result, controller } = start()
    receive(socket, binaryFrame(), true)
    const reason = new Error('Synthetic cancellation reason')
    controller.abort(reason)
    await expect(result).rejects.toBe(reason)
  })

  it('handles abort during construction before signal listener registration', async () => {
    const controller = new AbortController()
    mock.onConstruct = () => controller.abort()
    const result = synthesizeEdgeSpeech(request, controller.signal)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.sockets[0].terminate).toHaveBeenCalledOnce()
    expect(mock.sockets[0].sent).toEqual([])
  })

  it('ignores abort and stale callbacks after successful completion', async () => {
    const { socket, result, controller } = start()
    const pendingMessage = socket.listeners('message')[0]
    const pendingError = socket.listeners('error')[0]
    complete(socket)
    await expect(result).resolves.toEqual({ audio: mp3, wordBoundaries: [] })
    controller.abort()
    pendingMessage(binaryFrame(), true)
    pendingError(privateError)
    socket.callbacks[0](privateError)
    await expect(result).resolves.toEqual({ audio: mp3, wordBoundaries: [] })
    expect(socket.terminate).toHaveBeenCalledOnce()
  })

  it('clears timeout state and ignores stale sends after failure', async () => {
    const { socket, result } = start()
    socket.emit('error', privateError)
    await assertSafeFailure(result)
    socket.callbacks[0](privateError)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(socket.terminate).toHaveBeenCalledOnce()
  })

  it('fails a stalled handshake at 10 seconds with a safe 504', async () => {
    const { socket, result } = start(request, false)
    const rejected = assertSafeFailure(result, 504)
    await vi.advanceTimersByTimeAsync(9999)
    expect(socket.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(socket.sent).toEqual([])
    expect(socket.terminate).toHaveBeenCalledOnce()
  })

  it('does not restart the overall 30-second deadline when the handshake succeeds', async () => {
    const { socket, result } = start(request, false)
    const rejected = assertSafeFailure(result, 504)
    await vi.advanceTimersByTimeAsync(9000)
    socket.open()
    receive(socket, binaryFrame(), true)
    await vi.advanceTimersByTimeAsync(20_999)
    expect(socket.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
  })

  it('does not extend the overall deadline for metadata traffic', async () => {
    const { socket, result } = start()
    const rejected = assertSafeFailure(result, 504)
    for (let index = 0; index < 3; index++) {
      receive(socket, textFrame('audio.metadata', '{"Metadata":[]}'))
      await vi.advanceTimersByTimeAsync(10_000)
    }
    await rejected
  })
})
