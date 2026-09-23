// @vitest-environment node
import { ReadableStream } from 'node:stream/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EdgeTtsError } from './edge-tts'
import { listEdgeVoices } from './edge-tts-voices'

const fetchMock = vi.fn<typeof fetch>()
const limit = 2 * 1024 * 1024
const safeMessage = 'Edge TTS could not load the voice catalog.'
const privateError = new Error('Synthetic private upstream URL, token and response details')
const voice = {
  ShortName: 'en-US-AriaNeural', Name: 'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)',
  FriendlyName: 'Microsoft Aria Online (Natural) - English (United States)', Locale: 'en-US', Gender: 'Female',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-22T12:34:59.999Z'))
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function response(value: unknown = [voice], options: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...options, headers: { 'content-type': 'application/json; charset=utf-8', ...options.headers },
  })
}

function start() {
  const controller = new AbortController()
  const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
  return { controller, removeAbort, result: listEdgeVoices(controller.signal) }
}

function assertFailure(result: ReturnType<typeof listEdgeVoices>, status: 502 | 504 = 502) {
  return expect(result).rejects.toMatchObject({
    name: 'EdgeTtsError', status, message: status === 504 ? 'Edge TTS timed out.' : safeMessage,
  })
}

describe('Edge catalog request protocol', () => {
  it('uses the fixed HTTPS catalog URL, current client identity and five-minute GEC without synthesis text', async () => {
    fetchMock.mockResolvedValueOnce(response())
    const { result, controller, removeAbort } = start()
    await expect(result).resolves.toEqual([{
      id: voice.ShortName, name: voice.FriendlyName, locale: voice.Locale, gender: voice.Gender,
    }])
    const [input, init] = fetchMock.mock.calls[0]
    const url = new URL(String(input))
    expect(url.origin).toBe('https://speech.platform.bing.com')
    expect(url.pathname).toBe('/consumer/speech/synthesize/readaloud/voices/list')
    expect([...url.searchParams.keys()].sort()).toEqual(['Sec-MS-GEC', 'Sec-MS-GEC-Version', 'trustedclienttoken'])
    expect(url.searchParams.get('trustedclienttoken')).toMatch(/^[A-F0-9]{32}$/)
    expect(url.searchParams.get('Sec-MS-GEC')).toBe('6043E00D83E4740FEAE1FAB745400A2AE23270E93B1CBB4B6C2A825305EC1BCA')
    expect(url.searchParams.get('Sec-MS-GEC-Version')).toBe('1-143.0.3650.75')
    expect(init).toEqual({
      method: 'GET', headers: expect.any(Object), signal: expect.any(AbortSignal), redirect: 'error',
    })
    expect(init?.headers).toMatchObject({
      'User-Agent': expect.stringMatching(/Chrome\/143\.0\.0\.0.+Edg\/143\.0\.0\.0$/),
      'Accept-Language': 'en-US,en;q=0.9',
      Authority: 'speech.platform.bing.com',
      'Sec-CH-UA': '" Not;A Brand";v="99", "Microsoft Edge";v="143", "Chromium";v="143"',
      'Sec-CH-UA-Mobile': '?0', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
      Cookie: expect.stringMatching(/^muid=[A-F0-9]{32};$/),
    })
    expect(new Headers(init?.headers).has('Origin')).toBe(false)
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
    expect(init?.signal?.aborted).toBe(false)
  })

  it('fetches each refresh without caching and generates a fresh synthetic cookie', async () => {
    fetchMock.mockImplementation(async () => response())
    await start().result
    await start().result
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const cookies = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('cookie'))
    expect(cookies[0]).not.toBe(cookies[1])
  })
})

describe('bounded upstream catalog validation', () => {
  it('keeps every supported provider voice, filters other languages, and uses the actual provider name as fallback', async () => {
    const otherVoices = [
      ['en-GB-SoniaNeural', 'en-GB'], ['en-AU-NatashaNeural', 'en-AU'], ['en-ZA-LeahNeural', 'en-ZA'],
      ['zh-CN-XiaoxiaoNeural', 'zh-CN'], ['zh-TW-HsiaoChenNeural', 'zh-TW'], ['zh-SG-YanlinNeural', 'zh-SG'],
      ['zh-CN-liaoning-XiaobeiNeural', 'zh-CN-liaoning'], ['zh-CN-shaanxi-XiaoniNeural', 'zh-CN-shaanxi'],
      ['fr-FR-DeniseNeural', 'fr-FR'], ['zh-HK-HiuGaaiNeural', 'zh-HK'], ['de-DE-KatjaNeural', 'de-DE'],
    ].map(([ShortName, Locale]) => ({ ...voice, ShortName, Locale, FriendlyName: undefined }))
    fetchMock.mockResolvedValueOnce(response([voice, ...otherVoices]))
    const voices = await start().result
    expect(voices.map(item => item.id)).toEqual([voice.ShortName, ...otherVoices.slice(0, 8).map(item => item.ShortName)])
    expect(voices[1].name).toBe(voice.Name)
    expect(voices[7].locale).toBe('zh-CN-liaoning')
    expect(voices.every(item => Object.keys(item).sort().join(',') === 'gender,id,locale,name')).toBe(true)
  })

  it('accepts additional bounded provider metadata without exposing it in the local catalog', async () => {
    fetchMock.mockResolvedValueOnce(response([{
      ...voice, SuggestedCodec: 'audio-24khz-48kbitrate-mono-mp3', Status: 'GA',
      VoiceTag: { ContentCategories: ['General'], VoicePersonalities: ['Friendly'] },
    }]))
    expect(await start().result).toEqual([{
      id: voice.ShortName, name: voice.FriendlyName, locale: voice.Locale, gender: voice.Gender,
    }])
  })

  it.each([
    null, {}, [], [null], [{}], [{ ...voice, ShortName: 1 }], [{ ...voice, Name: null }],
    [{ ...voice, Name: undefined }], [{ ...voice, FriendlyName: 1 }], [{ ...voice, FriendlyName: '' }],
    [{ ...voice, Gender: '' }], [{ ...voice, Gender: 'x'.repeat(31) }],
    [{ ...voice, Locale: ' ' }], [{ ...voice, Locale: 'en-US\n' }],
    [{ ...voice, Name: 'x'.repeat(513) }], [{ ...voice, Name: ' ' }],
    [{ ...voice, FriendlyName: '\u0000' }], [{ ...voice, ShortName: 'x'.repeat(201) }],
    [{ ...voice, Locale: 'zh-CN' }], [{ ...voice, Locale: 'en-us' }],
    [{ ...voice, ShortName: 'zh-CN-liaoning-XiaobeiNeural', Locale: 'zh-CN' }],
    [voice, voice], [{ ...voice, ShortName: 'fr-FR-DeniseNeural', Locale: 'fr-FR' }],
    [voice, { ...voice, ShortName: 'fr-FR-DeniseNeural', Locale: 'fr-FR', Gender: null }],
    [voice, { ...voice, ShortName: 'fr-FR-DeniseNeural', Locale: 'de-DE' }],
    Array.from({ length: 4097 }, () => voice),
    Array.from({ length: 1001 }, (_, index) => ({ ...voice, ShortName: `en-US-Test${index}Neural` })),
  ])('rejects malformed full catalogs rather than hiding errors behind partial or empty success (case %#)', async value => {
    fetchMock.mockResolvedValueOnce(response(value))
    await assertFailure(start().result)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    Buffer.from('private invalid JSON'), Buffer.from([0xff, 0xfe]), Buffer.from(''),
  ])('rejects invalid JSON/UTF-8 without reflecting bytes (case %#)', async bytes => {
    fetchMock.mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'application/json' } }))
    await assertFailure(start().result)
  })

  it.each([204, 206, 301, 302, 403, 429, 500])('rejects upstream HTTP %s without retry or redirect', async status => {
    fetchMock.mockResolvedValueOnce(status === 204 ? new Response(null, { status }) : response([voice], { status }))
    await assertFailure(start().result)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['text/html', 'application/json; charset=utf-16', ''])('rejects unexpected content type %s', async contentType => {
    fetchMock.mockResolvedValueOnce(response([voice], { headers: { 'content-type': contentType } }))
    await assertFailure(start().result)
  })

  it('bounds declared bytes before reading a body and cancels its stream', async () => {
    const cancel = vi.fn()
    const pull = vi.fn()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel, pull }), {
      headers: { 'content-type': 'application/json', 'content-length': String(limit + 1) },
    }))
    await assertFailure(start().result)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it.each([undefined, '1'])('bounds actual streamed bytes regardless of content-length=%s', async length => {
    const cancel = vi.fn()
    let chunks = 0
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      pull(controller) {
        chunks++
        controller.enqueue(Buffer.alloc(256 * 1024, ' '))
      },
      cancel,
    }), { headers: { 'content-type': 'application/json', ...(length ? { 'content-length': length } : {}) } }))
    await assertFailure(start().result)
    expect(cancel).toHaveBeenCalledOnce()
    expect(chunks).toBeLessThanOrEqual(10)
  })

  it('accepts exactly the catalog byte limit, including UTF-8 characters split across chunks', async () => {
    const body = Buffer.from(JSON.stringify([{ ...voice, FriendlyName: '合成测试' }]))
    const bytes = Buffer.concat([body, Buffer.alloc(limit - body.length, ' ')])
    const split = body.indexOf(Buffer.from('合')) + 1
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split))
        controller.enqueue(bytes.subarray(split))
        controller.close()
      },
    }), { headers: { 'content-type': 'application/json', 'content-length': String(limit) } }))
    expect((await start().result)[0].name).toBe('合成测试')
  })

  it('sanitizes fetch and body-stream errors and releases cancellation listeners', async () => {
    fetchMock.mockRejectedValueOnce(privateError)
    const first = start()
    await assertFailure(first.result)
    expect(first.removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(privateError) },
    }), { headers: { 'content-type': 'application/json' } }))
    await assertFailure(start().result)
  })
})

describe('catalog cancellation and deadlines', () => {
  function stallFetch() {
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
  }

  function stallBody() {
    fetchMock.mockImplementation(async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
      },
    }), { headers: { 'content-type': 'application/json' } }))
  }

  it('does not contact the provider for a pre-aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(listEdgeVoices(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['headers', 'body'])('aborts stalled %s at the single 15-second deadline', async phase => {
    if (phase === 'headers') stallFetch()
    else stallBody()
    const { result, removeAbort } = start()
    const rejected = assertFailure(result, 504)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it.each(['headers', 'body'])('propagates client cancellation while awaiting %s', async phase => {
    if (phase === 'headers') stallFetch()
    else stallBody()
    const { result, controller } = start()
    await vi.advanceTimersByTimeAsync(1)
    const reason = new Error('Synthetic client cancellation')
    const rejected = expect(result).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('retains the safe Edge error type for an explicit catalog failure', async () => {
    fetchMock.mockRejectedValueOnce(new EdgeTtsError(502, 'catalog'))
    await assertFailure(start().result)
  })
})
