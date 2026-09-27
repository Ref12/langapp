import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearVoiceCache, getPlaybackState, playBrowserSpeech, playBrowserSpeechToEnd,
  setSpeechVoicePreferences, stopBrowserSpeech, subscribePlayback,
} from './speech'
import { acquireAudio, interruptAudio } from './audio-owner'
import { speakConversationReply } from './conversation-voice'
import type { SpeechLocale } from './contracts'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  volume = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event?: { error: string }) => void) | null = null
}

const mandarin = { name: 'Huihui', voiceURI: 'huihui', lang: 'zh-CN', localService: true, default: false }
const english = { name: 'English', voiceURI: 'english', lang: 'en-US', localService: true, default: false }
const preference = ({ name, voiceURI, lang, localService }: SpeechSynthesisVoice) => ({ name, voiceURI, lang, localService })
const native = {
  speaking: false,
  pending: false,
  paused: false,
  getVoices: vi.fn<() => SpeechSynthesisVoice[]>(),
  speak: vi.fn<(utterance: Utterance) => void>(),
  cancel: vi.fn<() => void>(),
  resume: vi.fn<() => void>(),
}
let now = 0
const queued = () => native.speak.mock.calls.map(([utterance]) => utterance)
const complete = (utterance: Utterance) => { utterance.onstart?.(); utterance.onend?.() }
const advance = async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms) }
function expectReleased(utterances: Utterance[]) {
  for (const utterance of utterances) {
    expect(utterance.onstart).toBeNull()
    expect(utterance.onend).toBeNull()
    expect(utterance.onerror).toBeNull()
  }
  expect(vi.getTimerCount()).toBe(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', native)
  native.speaking = false
  native.pending = false
  native.paused = false
  native.getVoices.mockReset().mockReturnValue([mandarin, english])
  native.speak.mockReset()
  native.cancel.mockReset()
  native.resume.mockReset()
  stopBrowserSpeech()
  setSpeechVoicePreferences()
  clearVoiceCache()
  native.cancel.mockClear()
})

afterEach(() => {
  native.cancel.mockReset()
  interruptAudio()
  stopBrowserSpeech()
  expect(vi.getTimerCount()).toBe(0)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('muted browser speech preparation', () => {
  it.each([
    ['zh-Hans', 0.25], ['zh-Hans', 0.5], ['zh-Hans', 0.75], ['zh-Hans', 1], ['zh-Hans', 1.25],
    ['en-US', 0.25], ['en-US', 0.5], ['en-US', 0.75], ['en-US', 1], ['en-US', 1.25],
  ] as const)('queues muted %s preparation and an unchanged target synchronously at requested rate %s', async (locale, rate) => {
    const text = locale === 'zh-Hans' ? ' 你好，今天我们一起练习中文。 ' : ' Hello, let us practise together. '
    const pending = playBrowserSpeechToEnd('cold', text, locale, rate)
    expect(native.speak).toHaveBeenCalledTimes(2)
    const [prep, target] = queued()
    const voice = locale === 'zh-Hans' ? mandarin : english
    expect(prep).toMatchObject({
      text: locale === 'zh-Hans' ? '准备好了。' : 'Ready to begin.',
      voice, lang: voice.lang, rate: 1, volume: 0,
    })
    expect(target).toMatchObject({ text, voice, lang: voice.lang, rate: locale === 'en-US' ? 1 : rate, volume: 1 })
    const finished = vi.fn()
    void pending.then(finished)
    prep.onstart?.()
    await advance(1900)
    prep.onend?.()
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    expect(getPlaybackState()).toMatchObject({ activeId: 'cold', phase: 'starting' })
    target.onstart?.()
    expect(getPlaybackState().phase).toBe('speaking')
    const lateEnd = target.onend
    target.onend?.()
    lateEnd?.()
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expect(finished).toHaveBeenCalledOnce()
    expect(native.speak).toHaveBeenCalledTimes(2)
    expectReleased([prep, target])
  })

  it.each(['empty', 'unreadable'])('preserves same-stack Android language-tag queuing for an %s voice list', async source => {
    if (source === 'empty') native.getVoices.mockReturnValue([])
    else native.getVoices.mockImplementation(() => { throw new Error('not enumerable') })
    const pending = playBrowserSpeechToEnd('system', '你好', 'zh-Hans', 0.25)
    expect(native.speak).toHaveBeenCalledTimes(2)
    const [prep, target] = queued()
    expect(prep).toMatchObject({ lang: 'zh-CN', rate: 1, volume: 0 })
    expect(target).toMatchObject({ lang: 'zh-CN', rate: 0.25, volume: 1 })
    expect(prep.voice).toBeUndefined()
    expect(target.voice).toBeUndefined()
    complete(prep)
    complete(target)
    await expect(pending).resolves.toEqual({ status: 'completed' })
  })

  it('uses an explicitly selected online voice for both utterances without falling back', async () => {
    const online = { ...mandarin, name: 'Online Mandarin', voiceURI: 'online', localService: false }
    native.getVoices.mockReturnValue([mandarin, online])
    setSpeechVoicePreferences({ 'zh-Hans': preference(online) })
    const pending = playBrowserSpeechToEnd('online', '你好', 'zh-Hans', 0.25)
    expect(queued()).toHaveLength(2)
    for (const utterance of queued()) {
      expect(utterance.voice).toBe(online)
      complete(utterance)
    }
    await expect(pending).resolves.toEqual({ status: 'completed' })
  })

  it('skips preparation for consecutive speech, preserves warmth across idle Stop, and warms again after 1000ms idle', async () => {
    const first = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    queued().forEach(complete)
    await expect(first).resolves.toEqual({ status: 'completed' })
    await advance(999)
    stopBrowserSpeech()
    const second = playBrowserSpeechToEnd('second', '再见', 'zh-Hans', 0.25)
    expect(queued()).toHaveLength(3)
    expect(queued()[2]).toMatchObject({ text: '再见', volume: 1, rate: 0.25 })
    complete(queued()[2])
    await expect(second).resolves.toEqual({ status: 'completed' })
    expect(native.cancel).not.toHaveBeenCalled()
    await advance(1000)
    const third = playBrowserSpeechToEnd('third', '你好', 'zh-Hans')
    expect(queued().slice(3).map(utterance => utterance.volume)).toEqual([0, 1])
    queued().slice(3).forEach(complete)
    await expect(third).resolves.toEqual({ status: 'completed' })
  })

  it.each(['language', 'voice', 'system-to-listed', 'engine', 'preferences', 'refresh', 'clock-reset'])(
    'warms again when %s changes', async change => {
      if (change === 'system-to-listed') native.getVoices.mockReturnValue([])
      const first = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
      queued().forEach(complete)
      await first
      let locale: SpeechLocale = 'zh-Hans'
      if (change === 'language') locale = 'en-US'
      if (change === 'voice') native.getVoices.mockReturnValue([{ ...mandarin, voiceURI: 'other' }])
      if (change === 'system-to-listed') native.getVoices.mockReturnValue([mandarin])
      if (change === 'engine') vi.stubGlobal('speechSynthesis', { ...native })
      if (change === 'preferences') setSpeechVoicePreferences({ 'zh-Hans': preference(mandarin) })
      if (change === 'refresh') clearVoiceCache()
      if (change === 'clock-reset') now = -1
      const second = playBrowserSpeechToEnd('second', 'Hello', locale)
      expect(queued().slice(2).map(utterance => utterance.volume)).toEqual([0, 1])
      queued().slice(2).forEach(complete)
      await expect(second).resolves.toEqual({ status: 'completed' })
    },
  )

  it('retains warmth for equivalent refreshed native voice objects and unchanged preferences', async () => {
    setSpeechVoicePreferences({ 'zh-Hans': preference(mandarin) })
    const first = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    queued().forEach(complete)
    await first
    native.getVoices.mockReturnValue([{ ...mandarin }])
    setSpeechVoicePreferences({ 'zh-Hans': preference({ ...mandarin }) })
    const second = playBrowserSpeechToEnd('second', '再见', 'zh-Hans')
    expect(queued()).toHaveLength(3)
    complete(queued()[2])
    await expect(second).resolves.toEqual({ status: 'completed' })
  })

  it('invalidates warmth when untracked native audio really is cancelled', async () => {
    const first = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    queued().forEach(complete)
    await first
    native.speaking = true
    stopBrowserSpeech()
    native.speaking = false
    expect(native.cancel).toHaveBeenCalledOnce()
    const second = playBrowserSpeechToEnd('second', '你好', 'zh-Hans')
    expect(queued().slice(2).map(utterance => utterance.volume)).toEqual([0, 1])
    queued().slice(2).forEach(complete)
    await expect(second).resolves.toEqual({ status: 'completed' })
  })

  it.each(['stop', 'replacement', 'ownership', 'voice-change'])('cancels both queued utterances on %s and discards stale events', async action => {
    const first = playBrowserSpeechToEnd('same', '你好', 'zh-Hans')
    const previous = queued()
    const late = previous.flatMap(utterance => [utterance.onstart, utterance.onend, utterance.onerror])
    previous[0].onstart?.()
    if (action === 'stop') stopBrowserSpeech()
    if (action === 'ownership') {
      acquireAudio(() => { stopBrowserSpeech() })
      interruptAudio()
    }
    if (action === 'voice-change') setSpeechVoicePreferences({ 'zh-Hans': preference(mandarin) })
    const next = playBrowserSpeechToEnd('same', '再见', 'zh-Hans')
    await expect(first).resolves.toEqual({ status: 'cancelled' })
    late.forEach(callback => callback?.())
    expect(getPlaybackState()).toMatchObject({ activeId: 'same', phase: 'starting' })
    expect(queued().slice(2).map(utterance => utterance.volume)).toEqual([0, 1])
    queued().slice(2).forEach(complete)
    await expect(next).resolves.toEqual({ status: 'completed' })
    expect(native.cancel).toHaveBeenCalledOnce()
    expectReleased(queued())
  })

  it.each(['warmup', 'target'])('invalidates warmth on %s failure and never replays automatically', async stage => {
    const first = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    const previous = queued()
    if (stage === 'target') complete(previous[0])
    previous[stage === 'warmup' ? 0 : 1].onerror?.({ error: 'audio-hardware' })
    await expect(first).resolves.toMatchObject({ status: 'error' })
    await advance(100_000)
    expect(queued()).toHaveLength(2)
    expectReleased(previous)
    const second = playBrowserSpeechToEnd('second', '你好', 'zh-Hans')
    expect(queued().slice(2).map(utterance => utterance.volume)).toEqual([0, 1])
    queued().slice(2).forEach(complete)
    await expect(second).resolves.toEqual({ status: 'completed' })
  })

  it.each(['not-allowed', 'language-unavailable', 'voice-unavailable'])('reports native preparation %s errors honestly', async error => {
    const pending = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    queued()[0].onerror?.({ error })
    await expect(pending).resolves.toMatchObject({
      status: 'error', error: expect.stringContaining(error === 'not-allowed' ? 'permissions' : 'text-to-speech'),
    })
    expectReleased(queued())
  })

  it('preserves cancellation failure as a barrier until native Stop succeeds', async () => {
    const first = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    native.cancel.mockImplementation(() => { throw new Error('stuck') })
    expect(stopBrowserSpeech()).toContain('could not stop')
    await expect(first).resolves.toMatchObject({ status: 'error' })
    await expect(playBrowserSpeechToEnd('blocked', '你好', 'zh-Hans')).resolves.toMatchObject({ status: 'error' })
    expect(queued()).toHaveLength(2)
    expectReleased(queued())
    native.cancel.mockReset()
    expect(stopBrowserSpeech()).toBeUndefined()
    const next = playBrowserSpeechToEnd('next', '你好', 'zh-Hans')
    expect(queued().slice(2).map(utterance => utterance.volume)).toEqual([0, 1])
    queued().slice(2).forEach(complete)
    await expect(next).resolves.toEqual({ status: 'completed' })
  })

  it.each(['warmup-start', 'warmup-end', 'target-start', 'target-end'])('bounds lost %s events and clears both utterances', async missing => {
    const pending = playBrowserSpeechToEnd('timeout', 'Tea', 'en-US')
    const [prep, target] = queued()
    if (missing !== 'warmup-start') prep.onstart?.()
    if (missing.startsWith('target')) prep.onend?.()
    if (missing === 'target-end') target.onstart?.()
    await advance(missing === 'target-end' ? 30_000 : 10_000)
    await expect(pending).resolves.toMatchObject({ status: 'error', error: expect.stringMatching(/time|timed/) })
    expect(native.cancel).toHaveBeenCalledOnce()
    expect(queued()).toHaveLength(2)
    expectReleased([prep, target])
  })

  it('gives preparation startup, preparation completion, and target startup independent deadlines', async () => {
    const pending = playBrowserSpeechToEnd('slow-start', '你好', 'zh-Hans')
    const [prep, target] = queued()
    await advance(9000)
    prep.onstart?.()
    await advance(9000)
    prep.onend?.()
    await advance(9000)
    expect(getPlaybackState().phase).toBe('starting')
    complete(target)
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expectReleased([prep, target])
  })

  it('accepts actual start/end when preparation end was lost, ignoring late preparation events', async () => {
    const pending = playBrowserSpeechToEnd('missing-prep-end', 'Tea', 'en-US')
    const [prep, target] = queued()
    prep.onstart?.()
    target.onstart?.()
    await advance(9000)
    prep.onend?.()
    prep.onstart?.()
    await advance(20_999)
    expect(getPlaybackState().phase).toBe('speaking')
    target.onend?.()
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expectReleased([prep, target])
  })

  it('accepts real end events even when their corresponding start callbacks were omitted', async () => {
    const pending = playBrowserSpeechToEnd('missing-starts', 'Tea', 'en-US')
    const [prep, target] = queued()
    prep.onend?.()
    const finished = vi.fn()
    void pending.then(finished)
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    target.onend?.()
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expectReleased([prep, target])
  })

  it.each(['preparation-end', 'target-start'])('ignores stale preparation errors after %s', async completedStage => {
    const pending = playBrowserSpeechToEnd('late-preparation-error', 'Tea', 'en-US')
    const [prep, target] = queued()
    const lateError = prep.onerror
    prep.onstart?.()
    if (completedStage === 'preparation-end') prep.onend?.()
    else target.onstart?.()
    lateError?.({ error: 'audio-hardware' })
    expect(getPlaybackState().activeId).toBe('late-preparation-error')
    expect(native.cancel).not.toHaveBeenCalled()
    complete(target)
    await expect(pending).resolves.toEqual({ status: 'completed' })
    expectReleased([prep, target])
  })

  it.each(['warmup-start', 'warmup-end', 'target-start'])('does not extend watchdogs on repeated %s callbacks', async callback => {
    const pending = playBrowserSpeechToEnd('duplicate-events', 'Tea', 'en-US')
    const [prep, target] = queued()
    prep.onstart?.()
    if (callback !== 'warmup-start') prep.onend?.()
    if (callback === 'target-start') target.onstart?.()
    await advance(9000)
    if (callback === 'warmup-start') prep.onstart?.()
    if (callback === 'warmup-end') prep.onend?.()
    if (callback === 'target-start') target.onstart?.()
    await advance(callback === 'target-start' ? 21_000 : 1000)
    await expect(pending).resolves.toMatchObject({ status: 'error' })
    expectReleased([prep, target])
  })

  it('handles synchronous preparation and target completion exactly once', async () => {
    native.speak.mockImplementation(complete)
    const finished = vi.fn()
    await playBrowserSpeechToEnd('synchronous', '你好', 'zh-Hans').then(finished)
    expect(finished.mock.calls).toEqual([[{ status: 'completed' }]])
    expect(queued()).toHaveLength(2)
    expectReleased(queued())
  })

  it.each(['warmup', 'target'])('does not claim completion if %s speak emits end and then throws', async stage => {
    native.speak.mockImplementation(utterance => {
      complete(utterance)
      if (utterance.volume === (stage === 'warmup' ? 0 : 1)) throw new Error('native failure')
    })
    await expect(playBrowserSpeechToEnd('throws', '你好', 'zh-Hans')).resolves.toMatchObject({ status: 'error' })
    expect(queued()).toHaveLength(stage === 'warmup' ? 1 : 2)
    expectReleased(queued())
  })

  it('stops before either enqueue when a starting subscriber cancels', async () => {
    const unsubscribe = subscribePlayback(() => {
      if (getPlaybackState().phase === 'starting') stopBrowserSpeech()
    })
    try {
      await expect(playBrowserSpeechToEnd('cancelled', '你好', 'zh-Hans')).resolves.toEqual({ status: 'cancelled' })
      expect(native.speak).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it.each(['cancel', 'replace', 'error'])('never enqueues a stale target after synchronous preparation %s', async action => {
    native.speak.mockImplementationOnce(prep => {
      prep.onstart?.()
      if (action === 'cancel') stopBrowserSpeech()
      if (action === 'replace') playBrowserSpeech('replacement', '再见', 'zh-Hans')
      if (action === 'error') prep.onerror?.({ error: 'not-allowed' })
    })
    const pending = playBrowserSpeechToEnd('first', '你好', 'zh-Hans')
    await expect(pending).resolves.toMatchObject({ status: action === 'error' ? 'error' : 'cancelled' })
    expect(queued().filter(utterance => utterance.text === '你好')).toHaveLength(0)
    if (action === 'replace') {
      expect(queued().slice(1).map(utterance => utterance.volume)).toEqual([0, 1])
      queued().slice(1).forEach(complete)
    }
    expectReleased(queued())
  })

  it('resumes a paused engine before synchronously queuing both utterances', async () => {
    native.paused = true
    native.resume.mockImplementation(() => expect(native.speak).not.toHaveBeenCalled())
    const pending = playBrowserSpeechToEnd('paused', '你好', 'zh-Hans')
    expect(native.resume).toHaveBeenCalledOnce()
    expect(queued()).toHaveLength(2)
    queued().forEach(complete)
    await expect(pending).resolves.toEqual({ status: 'completed' })
  })

  it('fails without queueing anything if resume fails', async () => {
    native.paused = true
    native.resume.mockImplementation(() => { throw new Error('blocked') })
    await expect(playBrowserSpeechToEnd('paused', '你好', 'zh-Hans')).resolves.toMatchObject({ status: 'error' })
    expect(native.speak).not.toHaveBeenCalled()
  })

  it('refuses playback if preparation cannot be made silent', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(public text: string) {}
      set volume(value: number) { if (value === 0) throw new Error('cannot mute') }
    })
    await expect(playBrowserSpeechToEnd('mute-failed', '你好', 'zh-Hans')).resolves.toMatchObject({ status: 'error' })
    expect(native.speak).not.toHaveBeenCalled()
  })

  it('refuses playback if the native preparation volume setter silently fails', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(public text: string) {}
      get volume() { return 1 }
      set volume(_value: number) { /* Simulate an unsupported native setter. */ }
    })
    await expect(playBrowserSpeechToEnd('mute-ignored', '你好', 'zh-Hans')).resolves.toMatchObject({ status: 'error' })
    expect(native.speak).not.toHaveBeenCalled()
  })

  it('keeps conversation ownership and sequencing until the actual target ends, then skips redundant preparation', async () => {
    const reply = speakConversationReply([
      { type: 'speech', text: '你好', locale: 'zh-Hans' },
      { type: 'speech', text: '再见', locale: 'zh-Hans' },
    ], 0.25)
    const finished = vi.fn()
    void reply.done.then(finished)
    expect(queued()).toHaveLength(2)
    complete(queued()[0])
    await Promise.resolve()
    expect(queued()).toHaveLength(2)
    expect(finished).not.toHaveBeenCalled()
    complete(queued()[1])
    await Promise.resolve()
    expect(queued()).toHaveLength(3)
    expect(queued()[2]).toMatchObject({ text: '再见', volume: 1, rate: 0.25 })
    complete(queued()[2])
    await expect(reply.done).resolves.toEqual({ status: 'completed' })
    expectReleased(queued())
  })

  it('cancels a conversation preparation and its queued target when the page hides', async () => {
    const reply = speakConversationReply([{ type: 'speech', text: '你好', locale: 'zh-Hans' }], 0.25)
    expect(queued()).toHaveLength(2)
    queued()[0].onstart?.()
    window.dispatchEvent(new Event('pagehide'))
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    expect(native.cancel).toHaveBeenCalledOnce()
    expectReleased(queued())
  })

  it('cancels both utterances before capture or another flow takes conversation ownership', async () => {
    const reply = speakConversationReply([{ type: 'speech', text: '你好', locale: 'zh-Hans' }], 0.25)
    expect(queued()).toHaveLength(2)
    queued()[0].onstart?.()
    const capture = acquireAudio(vi.fn())
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    expect(capture.isCurrent()).toBe(true)
    expect(native.cancel).toHaveBeenCalledOnce()
    expectReleased(queued())
    capture.release()
  })
})
