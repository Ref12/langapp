import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockAudio, mockAudio } from '../../test/mock-audio'
import { withAutoCompletedSpeechPreparation } from '../../test/mock-speech-preparation'
import { acquireAudio, interruptAudio } from './audio-owner'
import type { SpeechRate } from './contracts'
import { createPracticePlayback, type PracticePlaybackOptions, type PracticePlaybackState } from './practice-playback'
import {
  clearVoiceCache, getPlaybackState, playBrowserSpeech, playBrowserSpeechToEnd,
  setDefaultSpeechRate, setSpeechVoicePreferences, stopBrowserSpeech, subscribePlayback,
} from './speech'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: ((event?: { error: string }) => void) | null
}

const mandarin = { name: 'Mandarin', voiceURI: 'zh', lang: 'zh-CN', localService: true, default: false }
const english = { ...mandarin, name: 'English', voiceURI: 'en', lang: 'en-US' }
const mandarinPreference = { name: mandarin.name, voiceURI: mandarin.voiceURI, lang: mandarin.lang, localService: mandarin.localService }
const synthesis = {
  getVoices: vi.fn<() => SpeechSynthesisVoice[]>(),
  speak: vi.fn<(utterance: Utterance) => void>(),
  cancel: vi.fn<() => void>(),
  resume: vi.fn<() => void>(),
  paused: false,
}
const phrases = ['茶', '我想喝茶', '今天我想喝茶']
const defaults: PracticePlaybackOptions = { pacing: 'self-paced', rate: 0.75, pauseSeconds: 3, repetitions: 1 }
type Controller = ReturnType<typeof createPracticePlayback>
let controllers: Controller[]
let subscriptions: (() => void)[]
let player: Controller
let states: PracticePlaybackState[]
const utterance = () => synthesis.speak.mock.calls[synthesis.speak.mock.calls.length - 1][0]
const flush = async () => { await vi.advanceTimersByTimeAsync(0) }
const finish = async () => { utterance().onend?.(); await flush() }
const guided = (settings: Partial<PracticePlaybackOptions> = {}) => {
  player.configure(phrases, { ...defaults, pacing: 'guided', ...settings })
}
const create = (
  texts = phrases,
  options = defaults,
  changed: (state: PracticePlaybackState) => void = state => states.push(state),
) => {
  const controller = createPracticePlayback(`practice-${controllers.length}`, texts, options, changed)
  controllers.push(controller)
  return controller
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  synthesis.getVoices.mockReset().mockReturnValue([mandarin, english])
  synthesis.speak.mockReset()
  synthesis.cancel.mockReset()
  synthesis.resume.mockReset()
  synthesis.paused = false
  stopBrowserSpeech()
  setSpeechVoicePreferences()
  setDefaultSpeechRate()
  clearVoiceCache()
  synthesis.cancel.mockClear()
  controllers = []
  subscriptions = []
  states = []
  player = create()
})

afterEach(async () => {
  subscriptions.forEach(unsubscribe => unsubscribe())
  synthesis.cancel.mockReset()
  controllers.forEach(controller => controller.dispose())
  interruptAudio()
  stopBrowserSpeech()
  await flush()
  expect(vi.getTimerCount()).toBe(0)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('practice playback using the real shared speech engine', () => {
  it('constructs idle and configures paused without enumerating voices or claiming audio', () => {
    const interrupted = vi.fn()
    const lease = acquireAudio(interrupted)
    expect(player.getState()).toEqual({ status: 'idle', index: 0, repetition: 1 })
    player.configure(phrases, defaults)
    expect(player.getState()).toEqual({ status: 'paused', index: 0, repetition: 1 })
    expect(synthesis.getVoices).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(synthesis.cancel).not.toHaveBeenCalled()
    expect(interrupted).not.toHaveBeenCalled()
    expect(lease.isCurrent()).toBe(true)
    lease.release()
  })

  it.each(['play', 'next', 'previous', 'select'] as const)('keeps %s in the Android tap stack with empty enumeration', action => {
    synthesis.getVoices.mockReturnValue([])
    player.configure(phrases, defaults, 1)
    let tapping = true
    synthesis.speak.mockImplementation(model => {
      expect(tapping).toBe(true)
      expect(model.lang).toBe('zh-CN')
      expect(model.rate).toBe(0.75)
    })
    if (action === 'select') player.select(2)
    else player[action]()
    tapping = false
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(player.getState().index).toBe(action === 'previous' ? 0 : action === 'play' ? 1 : 2)
  })

  it('self-paced speech waits for actual end, stays on the selected row, and never auto-advances', async () => {
    player.select(1)
    utterance().onstart?.()
    await vi.advanceTimersByTimeAsync(5000)
    expect(player.getState()).toEqual({ status: 'playing', index: 1, repetition: 1 })
    await finish()
    expect(player.getState()).toEqual({ status: 'idle', index: 1, repetition: 1 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(synthesis.speak).toHaveBeenCalledOnce()
    player.play()
    expect(utterance().text).toBe(phrases[1])
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('ignores repetitions and response timers in self-paced mode', async () => {
    player.configure(phrases, { ...defaults, repetitions: 5 })
    player.play()
    await finish()
    expect(vi.getTimerCount()).toBe(0)
    expect(player.getState()).toMatchObject({ status: 'idle', repetition: 1 })
  })

  it('repeats each guided row, advances after response gaps, and finishes after the final gap', async () => {
    guided({ repetitions: 2 })
    player.play()
    for (let index = 0; index < phrases.length; ++index) {
      for (let repetition = 1; repetition <= 2; ++repetition) {
        expect(player.getState()).toEqual({ status: 'playing', index, repetition })
        expect(utterance().text).toBe(phrases[index])
        utterance().onstart?.()
        await vi.advanceTimersByTimeAsync(1000)
        expect(player.getState().status).toBe('playing')
        await finish()
        expect(player.getState()).toEqual({ status: 'responding', index, repetition })
        const count = synthesis.speak.mock.calls.length
        await vi.advanceTimersByTimeAsync(2999)
        expect(player.getState().status).toBe('responding')
        expect(synthesis.speak).toHaveBeenCalledTimes(count)
        await vi.advanceTimersByTimeAsync(1)
      }
    }
    expect(player.getState()).toEqual({ status: 'completed', index: 2, repetition: 2 })
    expect(synthesis.speak).toHaveBeenCalledTimes(6)
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    expect(player.getState()).toEqual({ status: 'playing', index: 2, repetition: 1 })
    expect(utterance().text).toBe(phrases[2])
  })

  it.each([0.25, 0.5, 0.75, 1, 1.25] as const)('starts the same response gap after real end at Mandarin speed %s', async rate => {
    guided({ rate, pauseSeconds: 2 })
    player.play()
    utterance().onstart?.()
    expect(utterance().rate).toBe(rate)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(player.getState().status).toBe('playing')
    expect(synthesis.speak).toHaveBeenCalledOnce()
    await finish()
    await vi.advanceTimersByTimeAsync(1999)
    expect(player.getState().status).toBe('responding')
    await vi.advanceTimersByTimeAsync(1)
    expect(player.getState()).toMatchObject({ status: 'playing', index: 1 })
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('passes only Mandarin to practice speech and does not alter the shared English rate', () => {
    guided({ rate: 0.25 })
    player.play()
    expect(utterance()).toMatchObject({ lang: 'zh-CN', rate: 0.25 })
    playBrowserSpeech('english', 'Tea', 'en-US', 0.25)
    expect(utterance()).toMatchObject({ lang: 'en-US', rate: 1 })
  })

  it('jumps and plays immediately from paused or active rows, clamps navigation, and rejects stale ends', async () => {
    guided()
    player.previous()
    expect(player.getState().index).toBe(0)
    const staleEnd = utterance().onend
    player.next()
    expect(utterance().text).toBe(phrases[1])
    player.pause()
    player.next()
    expect(utterance().text).toBe(phrases[2])
    player.next()
    expect(player.getState().index).toBe(2)
    player.previous()
    expect(utterance().text).toBe(phrases[1])
    player.select(0)
    staleEnd?.()
    await flush()
    expect(player.getState()).toEqual({ status: 'playing', index: 0, repetition: 1 })
    expect(synthesis.speak).toHaveBeenCalledTimes(6)
  })

  it.each(['utterance', 'gap'] as const)('pause cancels the %s; play restarts the same row and its repetition count', async phase => {
    guided({ repetitions: 3 })
    player.select(1)
    await finish()
    await vi.advanceTimersByTimeAsync(3000)
    expect(player.getState().repetition).toBe(2)
    const staleEnd = utterance().onend
    if (phase === 'gap') await finish()
    player.pause()
    expect(player.getState()).toEqual({ status: 'paused', index: 1, repetition: 2 })
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    expect(player.getState()).toEqual({ status: 'playing', index: 1, repetition: 1 })
    expect(utterance().text).toBe(phrases[1])
  })

  it.each(['utterance', 'gap'] as const)('settings and list changes halt the %s, clamp the index, and never autoplay', async phase => {
    guided()
    player.select(2)
    const staleEnd = utterance().onend
    if (phase === 'gap') await finish()
    player.configure(['水', '我想喝水'], { ...defaults, rate: 0.5, pauseSeconds: 5, repetitions: 4 })
    expect(player.getState()).toEqual({ status: 'paused', index: 1, repetition: 1 })
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(synthesis.speak).toHaveBeenCalledOnce()
    player.play()
    expect(utterance()).toMatchObject({ text: '我想喝水', rate: 0.5 })
    player.configure(phrases, defaults, 0)
    expect(player.getState()).toEqual({ status: 'paused', index: 0, repetition: 1 })
  })

  it('copies configuration and state so callers cannot mutate a running playlist', async () => {
    const texts = [...phrases]
    const options = { ...defaults, pacing: 'guided' as const }
    player.configure(texts, options, 1)
    texts[1] = 'wrong'
    options.pauseSeconds = 30
    player.getState().index = 77
    player.play()
    states[states.length - 1].index = 70
    expect(player.getState().index).toBe(1)
    expect(utterance().text).toBe(phrases[1])
    await finish()
    await vi.advanceTimersByTimeAsync(3000)
    expect(player.getState().index).toBe(2)
  })

  it.each(['listed', 'system'] as const)('handles synchronous %s onstart and onend without invented completion timers', async source => {
    if (source === 'system') synthesis.getVoices.mockReturnValue([])
    synthesis.speak.mockImplementation(model => { model.onstart?.(); model.onend?.() })
    player.play()
    await flush()
    expect(player.getState()).toEqual({ status: 'idle', index: 0, repetition: 1 })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('speech failures and cancellation', () => {
  it.each(['pending', 'settled'] as const)('pause clears an ordinary %s playback error without cancelling unowned audio', async phase => {
    player.play()
    utterance().onerror?.({ error: 'not-allowed' })
    if (phase === 'settled') {
      await flush()
      expect(player.getState().status).toBe('error')
    }
    synthesis.cancel.mockClear().mockImplementation(() => { throw new Error('No native audio remains to cancel') })
    player.pause()
    expect(player.getState()).toEqual({ status: 'paused', index: 0, repetition: 1 })
    expect(synthesis.cancel).not.toHaveBeenCalled()
    await flush()
    expect(player.getState().status).toBe('paused')
  })

  it('pause retains a genuine stop failure until a retry actually stops the native audio', () => {
    player.play()
    synthesis.cancel.mockImplementation(() => { throw new Error('Native audio is still playing') })
    player.pause()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    player.pause()
    expect(player.getState().status).toBe('error')
    synthesis.cancel.mockReset()
    player.pause()
    expect(player.getState()).toEqual({ status: 'paused', index: 0, repetition: 1 })
    expect(synthesis.cancel).toHaveBeenCalledOnce()
  })

  it.each(['missing voice', 'unsupported', 'error', 'start timeout', 'end timeout', 'blocked', 'ended then threw'] as const)(
    'surfaces a real shared-engine %s failure without advancing', async failure => {
      guided()
      if (failure === 'missing voice') {
        setSpeechVoicePreferences({ 'zh-Hans': mandarinPreference })
        synthesis.getVoices.mockReturnValue([])
      }
      if (failure === 'unsupported') vi.stubGlobal('SpeechSynthesisUtterance', undefined)
      if (failure === 'blocked') synthesis.speak.mockImplementationOnce(() => { throw new Error('blocked') })
      if (failure === 'ended then threw') synthesis.speak.mockImplementationOnce(model => {
        model.onend?.()
        throw new Error('not completed')
      })
      player.play()
      if (failure === 'missing voice') await vi.advanceTimersByTimeAsync(3000)
      if (failure === 'start timeout') await vi.advanceTimersByTimeAsync(10_000)
      if (failure === 'end timeout') {
        utterance().onstart?.()
        await vi.advanceTimersByTimeAsync(30_000)
      }
      if (failure === 'error') utterance().onerror?.({ error: 'not-allowed' })
      await flush()
      expect(player.getState()).toMatchObject({ status: 'error', index: 0, repetition: 1, error: expect.any(String) })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(synthesis.speak.mock.calls.length).toBe(['missing voice', 'unsupported'].includes(failure) ? 0 : 1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('does not count a stopped utterance as completed even if native cancel calls a captured onend', async () => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    synthesis.cancel.mockImplementationOnce(() => staleEnd?.())
    player.pause()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it.each(['pause', 'next', 'configure', 'dispose', 'other audio'] as const)('keeps %s cancellation failure visible and prevents overlapping playback', async action => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    synthesis.cancel.mockImplementation(() => { throw new Error('native cancel failed') })
    if (action === 'pause') player.pause()
    if (action === 'next') player.next()
    if (action === 'configure') player.configure(['水'], defaults)
    if (action === 'dispose') player.dispose()
    if (action === 'other audio') playBrowserSpeech('other', 'Tea', 'en-US')
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    player.play()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(player.getState().status).toBe('error')
    synthesis.cancel.mockReset()
    if (action !== 'dispose') {
      player.play()
      expect(synthesis.speak).toHaveBeenCalledTimes(2)
      expect(player.getState().status).toBe('playing')
    }
  })

  it('retains an audio barrier while cancellation is failing, including after dispose', () => {
    player.play()
    synthesis.cancel.mockImplementation(() => { throw new Error('native cancel failed') })
    player.dispose()
    expect(() => acquireAudio(vi.fn())).toThrow('could not stop speech')
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('does not lose cancellation failure when ownership changes before the speech error promise settles', () => {
    player.play()
    synthesis.cancel.mockImplementation(() => { throw new Error('native cancel failed') })
    utterance().onerror?.()
    expect(() => acquireAudio(vi.fn())).toThrow('could not stop speech')
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('surfaces external Stop cancellation failure rather than hiding it behind paused', async () => {
    guided()
    player.play()
    synthesis.cancel.mockImplementation(() => { throw new Error('native cancel failed') })
    expect(stopBrowserSpeech()).toContain('could not stop speech')
    await flush()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    stopBrowserSpeech()
    player.pause()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['configure', 'dispose'] as const)('does not hide a known cancellation failure when %s is called during another Stop', async action => {
    player.play()
    synthesis.cancel.mockImplementation(() => { throw new Error('native cancel failed') })
    player.pause()
    stopBrowserSpeech()
    if (action === 'configure') player.configure(['水'], defaults)
    else player.dispose()
    await flush()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
  })

  it('stops before beginning when an existing non-playlist owner cannot be interrupted', () => {
    acquireAudio(() => { throw new Error('Capture cannot stop') })
    player.play()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('Capture cannot stop') })
    player.play()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('Capture cannot stop') })
    expect(synthesis.speak).not.toHaveBeenCalled()
  })
})

describe('practice playback through the real shared Edge Audio path', () => {
  const fetcher = vi.fn<typeof fetch>()
  const response = () => new Response(JSON.stringify({
    audio: { contentType: 'audio/mpeg', base64: '//uQRAEC' }, wordBoundaries: [],
  }), { headers: { 'Content-Type': 'application/json' } })
  beforeEach(() => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('DEV_LOCAL_TTS', 'true')
    vi.stubGlobal('fetch', fetcher)
    fetcher.mockReset().mockImplementation(async () => response())
    mockAudio()
    setSpeechVoicePreferences({ 'zh-Hans': { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' } })
  })

  it('waits for Audio ended before the response gap, including for the final row', async () => {
    player.configure(['茶'], { ...defaults, pacing: 'guided', rate: 0.5 })
    expect(fetcher).not.toHaveBeenCalled()
    player.play()
    await flush()
    const clip = MockAudio.instances[0]
    expect(clip.play).toHaveBeenCalledOnce()
    expect(clip.playbackRate).toBe(1)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ text: '茶', rate: 0.5 })
    clip.onplaying?.()
    await vi.advanceTimersByTimeAsync(3000)
    expect(player.getState().status).toBe('playing')
    clip.onended?.()
    await flush()
    expect(player.getState().status).toBe('responding')
    await vi.advanceTimersByTimeAsync(2999)
    expect(player.getState().status).toBe('responding')
    await vi.advanceTimersByTimeAsync(1)
    expect(player.getState()).toEqual({ status: 'completed', index: 0, repetition: 1 })
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('waits for every actual Audio chunk before treating one long phrase as completed', async () => {
    player.configure(['茶'.repeat(1500)], { ...defaults, pacing: 'guided' })
    player.play()
    await flush()
    MockAudio.instances[0].onended?.()
    await flush()
    expect(player.getState().status).toBe('playing')
    expect(MockAudio.instances).toHaveLength(2)
    MockAudio.instances[1].onended?.()
    await flush()
    expect(player.getState().status).toBe('responding')
  })

  it('aborts an in-flight download and never plays its late response after disposal', async () => {
    let respond!: (value: Response) => void
    fetcher.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
    player.play()
    await flush()
    const signal = fetcher.mock.calls[0][1]?.signal
    player.dispose()
    expect(signal?.aborted).toBe(true)
    respond(response())
    await flush()
    expect(MockAudio.instances).toHaveLength(0)
    expect(player.getState().status).toBe('paused')
  })

  it('cancels native Audio and ignores captured late ended callbacks', async () => {
    guided()
    player.play()
    await flush()
    const clip = MockAudio.instances[0]
    const lateEnd = clip.onended
    player.pause()
    lateEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(clip.pause).toHaveBeenCalled()
    expect(player.getState().status).toBe('paused')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('surfaces real decoding errors without starting a response gap', async () => {
    guided()
    player.play()
    await flush()
    MockAudio.instances[0].onerror?.()
    await flush()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('decoded or played') })
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['pause', 'error'] as const)('keeps failed Edge cleanup from %s blocked rather than retrying with unrelated browser cancel', async action => {
    player.play()
    await flush()
    MockAudio.instances[0].pause.mockImplementation(() => { throw new Error('Audio is stuck') })
    if (action === 'pause') player.pause()
    else MockAudio.instances[0].onerror?.()
    await flush()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop Edge audio') })
    player.play()
    player.configure(phrases, defaults)
    await flush()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop Edge audio') })
    expect(() => acquireAudio(vi.fn())).toThrow('could not stop Edge audio')
  })
})

describe('ownership, stale callbacks, and unmount', () => {
  it.each(['utterance', 'gap', 'pending completion'] as const)('external Stop invalidates the %s without starting a later row', async phase => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    if (phase === 'gap') await finish()
    if (phase === 'pending completion') staleEnd?.()
    stopBrowserSpeech()
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it.each(['utterance', 'gap', 'pending completion'] as const)('another audio lease replaces the %s and owns the result', async phase => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    if (phase === 'gap') await finish()
    if (phase === 'pending completion') staleEnd?.()
    const interrupted = vi.fn()
    const nextLease = acquireAudio(interrupted)
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState().status).toBe('paused')
    expect(nextLease.isCurrent()).toBe(true)
    expect(interrupted).not.toHaveBeenCalled()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    nextLease.release()
  })

  it.each(['utterance', 'gap'] as const)('another Hear replaces the %s and remains untouched by pause/dispose', async phase => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    if (phase === 'gap') await finish()
    playBrowserSpeech('other', 'Tea', 'en-US')
    expect(getPlaybackState().activeId).toBe('other')
    player.pause()
    player.dispose()
    staleEnd?.()
    await flush()
    expect(getPlaybackState().activeId).toBe('other')
    await finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it.each(['utterance', 'gap'] as const)('speech interruption subscription catches unleased replacement during the %s', async phase => {
    guided()
    player.play()
    if (phase === 'gap') await finish()
    const other = playBrowserSpeechToEnd('unleased', 'Tea', 'en-US')
    await flush()
    expect(player.getState().status).toBe('paused')
    expect(getPlaybackState().activeId).toBe('unleased')
    await finish()
    await expect(other).resolves.toEqual({ status: 'completed' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('voice preference changes stop a response gap without starting another row', async () => {
    guided()
    player.play()
    await finish()
    setSpeechVoicePreferences({ 'zh-Hans': mandarinPreference })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it.each(['utterance', 'gap', 'pending completion'] as const)('dispose cancels the %s and every disposed mutator stays inert', async phase => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    if (phase === 'gap') await finish()
    if (phase === 'pending completion') staleEnd?.()
    player.dispose()
    const count = synthesis.cancel.mock.calls.length
    const owner = acquireAudio(vi.fn())
    player.play()
    player.next()
    player.previous()
    player.select(1)
    player.configure(phrases, defaults)
    player.pause()
    player.dispose()
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(synthesis.cancel).toHaveBeenCalledTimes(count)
    expect(owner.isCurrent()).toBe(true)
    owner.release()
  })
})

describe('synchronous subscriber and native lifecycle reentry', () => {
  it.each(['pause', 'configure', 'select', 'dispose', 'lease'] as const)('a playing subscriber can %s without the old row starting', action => {
    let once = true
    player = create(phrases, defaults, state => {
      if (state.status !== 'playing' || !once) return
      once = false
      if (action === 'pause') player.pause()
      if (action === 'configure') player.configure(['水'], defaults)
      if (action === 'select') player.select(2)
      if (action === 'dispose') player.dispose()
      if (action === 'lease') acquireAudio(vi.fn())
    })
    player.play()
    expect(synthesis.speak).toHaveBeenCalledTimes(action === 'select' ? 1 : 0)
    if (action === 'select') expect(utterance().text).toBe(phrases[2])
    else expect(player.getState().status).toBe('paused')
  })

  it.each(['pause', 'configure', 'dispose', 'lease'] as const)('a responding subscriber can %s without leaving a stale gap timer', async action => {
    player = create(phrases, { ...defaults, pacing: 'guided' }, state => {
      if (state.status !== 'responding') return
      if (action === 'pause') player.pause()
      if (action === 'configure') player.configure(phrases, defaults)
      if (action === 'dispose') player.dispose()
      if (action === 'lease') acquireAudio(vi.fn())
    })
    player.play()
    await finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pause', 'dispose', 'lease'] as const)('a shared speech starting subscriber can %s before native speak', async action => {
    subscriptions.push(subscribePlayback(() => {
      if (getPlaybackState().phase !== 'starting') return
      if (action === 'pause') player.pause()
      if (action === 'dispose') player.dispose()
      if (action === 'lease') acquireAudio(vi.fn())
    }))
    player.play()
    await flush()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(player.getState().status).toBe('paused')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not steal a newer lease claimed by an interrupted owner', () => {
    const interrupted = vi.fn()
    acquireAudio(() => { acquireAudio(interrupted) })
    player.play()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(player.getState().status).toBe('paused')
    expect(interrupted).not.toHaveBeenCalled()
    interruptAudio()
    expect(interrupted).toHaveBeenCalledOnce()
  })

  it('does not start reentrantly while acquiring an owner that then fails to stop', () => {
    acquireAudio(() => {
      player.play()
      throw new Error('Capture cannot stop')
    })
    player.play()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('Capture cannot stop') })
  })

  it('prevents reentrant Play during native stop from starting overlapping speech', async () => {
    guided()
    player.play()
    synthesis.cancel.mockImplementationOnce(() => player.play())
    player.next()
    await flush()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('still changing') })
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed native cancellation visible when a subscriber configures during cancel', async () => {
    player.play()
    synthesis.cancel.mockImplementationOnce(() => {
      player.configure(['水'], defaults)
      throw new Error('native cancellation failed')
    })
    player.pause()
    await flush()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('invalidates startup if native shared-engine cancellation synchronously calls pause', async () => {
    // begin first cancels existing unleased speech, then the shared engine cancels.
    synthesis.cancel.mockImplementationOnce(() => {})
      .mockImplementationOnce(() => player.pause())
    player.play()
    await flush()
    expect(player.getState().status).toBe('paused')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not restart inside an external Stop notification or its native cancel', async () => {
    let restart = true
    player = create(phrases, defaults, state => {
      if (state.status === 'paused' && restart) {
        restart = false
        player.play()
      }
    })
    player.play()
    synthesis.cancel.mockImplementationOnce(() => player.play())
    stopBrowserSpeech()
    await flush()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(player.getState().status).not.toBe('playing')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pause', 'external Stop'] as const)('rejects a new audio owner during native %s before cancellation is known to succeed', async action => {
    player.play()
    synthesis.cancel.mockImplementationOnce(() => {
      expect(() => acquireAudio(vi.fn())).toThrow('still stopping')
      throw new Error('native cancel failed')
    })
    if (action === 'pause') player.pause()
    else stopBrowserSpeech()
    await flush()
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('could not stop speech') })
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })
})

describe('API validation', () => {
  const invalidInputs: [string, string[], PracticePlaybackOptions][] = [
    ['empty list', [], defaults],
    ['too many phrases', Array.from({ length: 81 }, () => '茶'), defaults],
    ['blank phrase', [' \n '], defaults],
    ['long phrase', ['茶'.repeat(3001)], defaults],
    ['non-string phrase', [null] as unknown as string[], defaults],
    ['sparse phrase list', new Array<string>(1), defaults],
    ['invalid pacing', phrases, { ...defaults, pacing: 'auto' as 'guided' }],
    ['invalid rate', phrases, { ...defaults, rate: 0.8 as SpeechRate }],
    ['NaN rate', phrases, { ...defaults, rate: NaN as SpeechRate }],
    ['short pause', phrases, { ...defaults, pauseSeconds: 0 }],
    ['long pause', phrases, { ...defaults, pauseSeconds: 31 }],
    ['NaN pause', phrases, { ...defaults, pauseSeconds: NaN }],
    ['infinite pause', phrases, { ...defaults, pauseSeconds: Infinity }],
    ['zero repetitions', phrases, { ...defaults, repetitions: 0 }],
    ['too many repetitions', phrases, { ...defaults, repetitions: 6 }],
    ['fractional repetitions', phrases, { ...defaults, repetitions: 1.5 }],
    ['NaN repetitions', phrases, { ...defaults, repetitions: NaN }],
    ['missing options', phrases, null as unknown as PracticePlaybackOptions],
  ]

  it.each(invalidInputs)('rejects initial %s without audio activation and can recover with valid configuration', (_name, texts, options) => {
    player = create(texts, options)
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.any(String) })
    player.play()
    player.next()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(synthesis.cancel).not.toHaveBeenCalled()
    player.configure(phrases, defaults)
    player.play()
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it.each(invalidInputs)('invalid %s configuration stops existing audio and all subsequent timers', async (_name, texts, options) => {
    guided()
    player.play()
    const staleEnd = utterance().onend
    player.configure(texts, options)
    staleEnd?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(player.getState()).toMatchObject({ status: 'error', error: expect.any(String) })
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([-1, 3, 1.5, NaN, Infinity])('rejects invalid row %s for selection and explicit configuration', async index => {
    guided()
    player.play()
    await finish()
    player.select(index)
    expect(player.getState()).toMatchObject({ status: 'error', index: 0, error: expect.any(String) })
    expect(vi.getTimerCount()).toBe(0)
    player.configure(phrases, defaults, index)
    expect(player.getState().status).toBe('error')
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('accepts exact size and setting boundaries without activation', () => {
    const texts = Array.from({ length: 80 }, () => '茶'.repeat(3000))
    player.configure(texts, { pacing: 'guided', rate: 0.25, pauseSeconds: 1, repetitions: 1 }, 79)
    expect(player.getState()).toEqual({ status: 'paused', index: 79, repetition: 1 })
    player.configure(texts, { pacing: 'self-paced', rate: 1.25, pauseSeconds: 30, repetitions: 5 })
    expect(player.getState()).toEqual({ status: 'paused', index: 79, repetition: 1 })
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(synthesis.cancel).not.toHaveBeenCalled()
  })
})
