import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockAudio, mockAudio } from '../../test/mock-audio'
import { LOCAL_TTS_HEADER, LOCAL_TTS_PATH, LOCAL_TTS_VOICES_PATH } from '../local-tts-contracts'
import { loadEdgeVoices, startEdgeSpeech } from './edge-speech'
import {
  getPlaybackState, playBrowserSpeech, playBrowserSpeechToEnd, setDefaultSpeechRate,
  setSpeechVoicePreferences, stopBrowserSpeech, subscribePlayback,
} from './speech'
import { speakConversationReply } from './conversation-voice'
import { createGuidedAudio } from '../guided-audio'
import { acquireAudio, interruptAudio } from './audio-owner'

const edge = { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' } as const
const englishEdge = { provider: 'edge', voice: 'en-GB-SoniaNeural' } as const
const browserVoice = { voiceURI: 'english-local', name: 'English local', lang: 'en-US', localService: true, default: false }
const browserPreference = { voiceURI: browserVoice.voiceURI, name: browserVoice.name, lang: browserVoice.lang, localService: browserVoice.localService }
const body = { audio: { contentType: 'audio/mpeg', base64: '//uQRAEC' }, wordBoundaries: [] }
const catalog = { voices: [
  { id: edge.voice, name: 'Xiaoxiao', locale: 'zh-CN', gender: 'Female' },
  { id: englishEdge.voice, name: 'Sonia', locale: 'en-GB', gender: 'Female' },
] }
const fetcher = vi.fn<typeof fetch>()
const synthesis = { getVoices: vi.fn(() => [browserVoice]), speak: vi.fn(), cancel: vi.fn() }
let audio: ReturnType<typeof mockAudio>

class Utterance {
  constructor(public text: string) {}
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_TTS', 'true')
  vi.stubEnv('BASE_URL', '/')
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  synthesis.getVoices.mockClear()
  synthesis.speak.mockReset()
  synthesis.cancel.mockReset()
  fetcher.mockReset().mockImplementation(async () => json(body))
  audio = mockAudio()
  stopBrowserSpeech()
  setSpeechVoicePreferences({ 'zh-Hans': edge, 'en-US': englishEdge })
  setDefaultSpeechRate()
})

afterEach(async () => {
  interruptAudio()
  stopBrowserSpeech()
  setSpeechVoicePreferences()
  setDefaultSpeechRate()
  await flush()
  expect(vi.getTimerCount()).toBe(0)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Edge catalog client', () => {
  it('loads catalog metadata without requesting speech and honors the Vite base', async () => {
    vi.stubEnv('BASE_URL', '/langapp/')
    fetcher.mockResolvedValueOnce(json(catalog))
    const controller = new AbortController()
    await expect(loadEdgeVoices(controller.signal)).resolves.toEqual(catalog.voices)
    expect(fetcher).toHaveBeenCalledWith(`/langapp${LOCAL_TTS_VOICES_PATH}`, expect.objectContaining({
      method: 'GET', headers: { [LOCAL_TTS_HEADER]: '1' }, credentials: 'omit',
      cache: 'no-store', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal),
    }))
    expect(MockAudio.instances).toHaveLength(0)
  })

  it('rejects malformed catalogs and does not fall back to invented voices', async () => {
    fetcher.mockResolvedValueOnce(json({ voices: [{ id: 'unknown' }] }))
    await expect(loadEdgeVoices(new AbortController().signal)).rejects.toThrow('catalog was invalid')
  })

  it('aborts catalog loading on cancellation', async () => {
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    const controller = new AbortController()
    const pending = loadEdgeVoices(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
})

describe('shared Edge playback', () => {
  it.each([0.25, 0.5])('keeps English Edge audio at normal speed for requested rate %s and awaits the real end event', async rate => {
    vi.stubGlobal('speechSynthesis', undefined)
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    const pending = playBrowserSpeechToEnd('edge', 'Hello', 'en-US', rate)
    expect(getPlaybackState()).toMatchObject({ activeId: 'edge', phase: 'loading-audio', voiceKind: 'edge' })
    await flush()
    expect(fetcher).toHaveBeenCalledWith(LOCAL_TTS_PATH, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text: 'Hello', voice: englishEdge.voice, rate: 1 }),
    }))
    const clip = MockAudio.instances[0]
    expect(clip.play).toHaveBeenCalledOnce()
    expect(clip.playbackRate).toBe(1)
    expect(audio.createObjectURL.mock.calls[0][0].type).toBe('audio/mpeg')
    expect(getPlaybackState().phase).toBe('starting')
    clip.onplaying?.()
    expect(getPlaybackState()).toMatchObject({ phase: 'speaking', voiceKind: 'edge' })
    const finished = vi.fn()
    void pending.then(finished)
    await flush()
    expect(finished).not.toHaveBeenCalled()
    clip.onended?.()
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expect(clip.pause).toHaveBeenCalledOnce()
    expect(clip.removeAttribute).toHaveBeenCalledWith('src')
    expect(audio.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-audio-1')
    expect(getPlaybackState()).toEqual({})
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it.each([0.25, 0.75] as const)('uses the saved Mandarin default %s without changing the decoded clip playback rate', async rate => {
    setDefaultSpeechRate(rate)
    const pending = playBrowserSpeechToEnd('mandarin', '\u4f60\u597d', 'zh-Hans')
    await flush()
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ rate })
    expect(MockAudio.instances[0].playbackRate).toBe(1)
    MockAudio.instances[0].onended?.()
    await expect(pending).resolves.toEqual({ status: 'completed' })
  })

  it('splits long text without losing characters, cutting surrogate pairs, or completing between clips', async () => {
    const text = `${'x'.repeat(999)}\u{1f600}${'y'.repeat(1000)}`
    const pending = playBrowserSpeechToEnd('long', text, 'en-US')
    await flush()
    const sent: string[] = []
    for (let index = 0; index < 3; index++) {
      const value = JSON.parse(String(fetcher.mock.calls[index][1]?.body))
      sent.push(value.text)
      expect(value.text.length).toBeLessThanOrEqual(1000)
      MockAudio.instances[index].onended?.()
      await flush()
    }
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expect(sent.join('')).toBe(text)
    expect(audio.revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('prefers sentence boundaries for chunking and cancels before requesting remaining chunks', async () => {
    const text = `${'a'.repeat(700)}. ${'b'.repeat(500)}.`
    const pending = playBrowserSpeechToEnd('long', text, 'en-US')
    await flush()
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text).toBe(`${'a'.repeat(700)}.`)
    stopBrowserSpeech()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('cancels a pending download and ignores its late result', async () => {
    let respond!: (response: Response) => void
    fetcher.mockImplementation(() => new Promise(resolve => { respond = resolve }))
    const pending = playBrowserSpeechToEnd('pending', 'Hello', 'en-US')
    await flush()
    const signal = fetcher.mock.calls[0][1]?.signal
    stopBrowserSpeech()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(signal?.aborted).toBe(true)
    respond(json(body))
    await flush()
    expect(MockAudio.instances).toHaveLength(0)
    expect(getPlaybackState()).toEqual({})
  })

  it('does not send anything when cancelled immediately or synchronously superseded by a subscriber', async () => {
    const pending = playBrowserSpeechToEnd('cancel', 'Hello', 'en-US')
    stopBrowserSpeech()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    const unsubscribe = subscribePlayback(() => {
      if (getPlaybackState().phase === 'loading-audio') stopBrowserSpeech()
    })
    try {
      await expect(playBrowserSpeechToEnd('superseded', 'Hello', 'en-US')).resolves.toEqual({ status: 'cancelled' })
    } finally { unsubscribe() }
    await flush()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('interrupts an owner for a preview and stops active audio on preference changes', async () => {
    const interrupted = vi.fn()
    acquireAudio(interrupted)
    playBrowserSpeech('preview', 'Hello', 'en-US')
    expect(interrupted).toHaveBeenCalledOnce()
    await flush()
    const clip = MockAudio.instances[0]
    const lateEnd = clip.onended
    setSpeechVoicePreferences({ 'en-US': browserPreference })
    expect(clip.pause).toHaveBeenCalledOnce()
    lateEnd?.()
    await flush()
    expect(getPlaybackState()).toEqual({})
    playBrowserSpeech('native', 'Hello', 'en-US')
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['false', undefined])('fails explicitly outside the local Edge server (flag %s)', async flag => {
    vi.stubEnv('DEV_LOCAL_TTS', flag)
    const pending = playBrowserSpeechToEnd('unsupported', 'Hello', 'en-US')
    await expect(pending).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('local development server') })
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    () => new Response('No route', { status: 404 }),
    () => new Response('provider unavailable', { status: 502 }),
    () => new Response('<html>Not JSON</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => json({ audio: { contentType: 'audio/mpeg', base64: 'not base64' }, wordBoundaries: [] }),
    () => json({ audio: body.audio, wordBoundaries: 'invalid' }),
  ])('rejects invalid or unsuccessful responses without starting native speech (case %#)', async response => {
    fetcher.mockResolvedValueOnce(response())
    await expect(playBrowserSpeechToEnd('invalid', 'Hello', 'en-US')).resolves.toMatchObject({ status: 'error' })
    expect(MockAudio.instances).toHaveLength(0)
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('bounds HTTP response bytes before decoding audio', async () => {
    fetcher.mockResolvedValueOnce(new Response(' '.repeat(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }))
    await expect(playBrowserSpeechToEnd('oversized', 'Hello', 'en-US')).resolves.toMatchObject({
      status: 'error', error: expect.stringContaining('size limit'),
    })
    expect(MockAudio.instances).toHaveLength(0)
  })

  it('times out a stalled fetch and aborts its request', async () => {
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    const pending = playBrowserSpeechToEnd('stalled', 'Hello', 'en-US')
    await flush()
    await vi.advanceTimersByTimeAsync(50_000)
    await expect(pending).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('timed out') })
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('reports autoplay denial and releases the audio URL', async () => {
    MockAudio.onCreate = clip => { clip.play.mockRejectedValue(new Error('NotAllowedError')) }
    await expect(playBrowserSpeechToEnd('blocked', 'Hello', 'en-US')).resolves.toMatchObject({
      status: 'error', error: expect.stringContaining('blocked Edge audio'),
    })
    expect(audio.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('does not report success when play emits end synchronously and then rejects', async () => {
    MockAudio.onCreate = clip => {
      clip.play.mockImplementation(() => { clip.onended?.(); return Promise.reject(new Error('failed')) })
    }
    await expect(playBrowserSpeechToEnd('failed', 'Hello', 'en-US')).resolves.toMatchObject({ status: 'error' })
    expect(audio.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('handles decode errors and start/end timeouts without leaving active playback', async () => {
    for (const failure of ['decode', 'start', 'end']) {
      const pending = playBrowserSpeechToEnd(failure, 'Hello', 'en-US')
      await flush()
      const clip = MockAudio.instances[MockAudio.instances.length - 1]
      if (failure === 'decode') clip.onerror?.()
      else if (failure === 'start') await vi.advanceTimersByTimeAsync(10_000)
      else { clip.onplaying?.(); await vi.advanceTimersByTimeAsync(17_000) }
      await expect(pending).resolves.toMatchObject({ status: 'error' })
      expect(getPlaybackState().activeId).toBeUndefined()
    }
    expect(audio.revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('surfaces cancellation cleanup failures and does not start replacement playback', async () => {
    const pending = playBrowserSpeechToEnd('first', 'Hello', 'en-US')
    await flush()
    MockAudio.instances[0].pause.mockImplementation(() => { throw new Error('stuck') })
    await expect(playBrowserSpeechToEnd('second', 'Hello', 'en-US')).resolves.toMatchObject({
      status: 'error', error: expect.stringContaining('could not stop Edge audio'),
    })
    await expect(pending).resolves.toMatchObject({ status: 'error' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(audio.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('keeps an owning flow active until its real Edge clip has ended', async () => {
    const interrupted = vi.fn()
    const lease = acquireAudio(interrupted)
    const pending = playBrowserSpeechToEnd('practice-reference', '\u8336', 'zh-Hans')
    await flush()
    expect(lease.isCurrent()).toBe(true)
    expect(interrupted).not.toHaveBeenCalled()
    MockAudio.instances[0].onended?.()
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expect(lease.isCurrent()).toBe(true)
    lease.release()
  })

  it('uses mixed browser and Edge voices sequentially in spoken replies', async () => {
    setSpeechVoicePreferences({ 'en-US': browserPreference, 'zh-Hans': edge })
    const reply = speakConversationReply([
      { type: 'speech', text: 'Tea', locale: 'en-US' },
      { type: 'speech', text: '\u8336', locale: 'zh-Hans' },
    ], 0.75)
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    const utterance: Utterance = synthesis.speak.mock.calls[0][0]
    utterance.onend?.()
    await flush()
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ voice: edge.voice, rate: 0.75 })
    MockAudio.instances[0].onended?.()
    await expect(reply.done).resolves.toEqual({ status: 'completed' })
  })

  it('supports guided audio at its existing 0.85 Mandarin speed', async () => {
    const guided = createGuidedAudio('lesson', [{ kind: 'speech', locale: 'zh-Hans', text: '\u8336', modelId: 'model' }], vi.fn())
    guided.start()
    await flush()
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ rate: 0.85 })
    guided.stop()
    guided.dispose()
    await flush()
  })

  it('cancels the direct player without retaining an audio element', async () => {
    const playback = startEdgeSpeech('Hello', englishEdge, 'en-US', 1, vi.fn())
    await flush()
    expect(playback.cancel()).toBeUndefined()
    await expect(playback.done).resolves.toEqual({ status: 'cancelled' })
    expect(MockAudio.instances[0].onended).toBeNull()
  })

  it.each([' ', 'a'.repeat(8001)])('rejects invalid direct-player text before any request', async text => {
    const playback = startEdgeSpeech(text, englishEdge, 'en-US', 1, vi.fn())
    await expect(playback.done).resolves.toMatchObject({ status: 'error' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(MockAudio.instances).toHaveLength(0)
  })
})
