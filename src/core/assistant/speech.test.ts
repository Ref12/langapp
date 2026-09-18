import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserVoiceKey, clearVoiceCache, getPlaybackState, localVoiceMatches, playBrowserSpeech, playBrowserSpeechToEnd, setDefaultSpeechRate, setSpeechVoicePreferences, stopBrowserSpeech, subscribePlayback, watchBrowserVoices } from './speech'
import type { SpeechRate } from './contracts'
import { acquireAudio, interruptAudio } from './audio-owner'
import { speakConversationReply } from './conversation-voice'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}

const localMandarin = { name: 'Local Mandarin', lang: 'zh-CN', localService: true, voiceURI: 'local-zh', default: false }
const localEnglish = { name: 'Local English', lang: 'en-US', localService: true, voiceURI: 'local-en', default: false }
const onlineMandarin = { ...localMandarin, name: 'Online Mandarin', voiceURI: 'online-zh', localService: false }
const onlineEnglish = { ...localEnglish, name: 'Online English', voiceURI: 'online-en', localService: false }
const preference = ({ voiceURI, name, lang, localService }: SpeechSynthesisVoice) => ({ voiceURI, name, lang, localService })
const voiceListeners = new Set<() => void>()
const synthesis = {
  getVoices: vi.fn<() => SpeechSynthesisVoice[]>(),
  speak: vi.fn<(utterance: Utterance) => void>(),
  cancel: vi.fn<() => void>(),
  addEventListener: vi.fn<(type: string, listener: () => void) => void>(),
  removeEventListener: vi.fn<(type: string, listener: () => void) => void>(),
}

function voicesChanged(voices: SpeechSynthesisVoice[]) {
  synthesis.getVoices.mockReturnValue(voices)
  Array.from(voiceListeners).forEach(listener => listener())
}

function expectClean() {
  expect(voiceListeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', synthesis)
  synthesis.getVoices.mockReset().mockReturnValue([localMandarin, localEnglish])
  synthesis.speak.mockReset()
  synthesis.cancel.mockReset()
  synthesis.addEventListener.mockReset().mockImplementation((type, listener) => {
    expect(type).toBe('voiceschanged')
    voiceListeners.add(listener)
  })
  synthesis.removeEventListener.mockReset().mockImplementation((type, listener) => {
    expect(type).toBe('voiceschanged')
    voiceListeners.delete(listener)
  })
  stopBrowserSpeech()
  setSpeechVoicePreferences()
  setDefaultSpeechRate()
  clearVoiceCache()
  synthesis.cancel.mockClear()
})

afterEach(() => {
  interruptAudio()
  stopBrowserSpeech()
  setDefaultSpeechRate()
  expectClean()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('shared audio ownership', () => {
  it('interrupts top-level capture or practice before a raw preview starts', () => {
    const interrupted = vi.fn(() => expect(synthesis.speak).not.toHaveBeenCalled())
    const lease = acquireAudio(interrupted)
    playBrowserSpeech('preview', '茶', 'zh-Hans')
    expect(interrupted).toHaveBeenCalledOnce()
    expect(lease.isCurrent()).toBe(false)
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('does not interrupt the lease when its flow awaits playback completion', async () => {
    const interrupted = vi.fn()
    const lease = acquireAudio(interrupted)
    const outcome = playBrowserSpeechToEnd('owned', '茶', 'zh-Hans')
    synthesis.speak.mock.calls[0][0].onend?.()
    await expect(outcome).resolves.toEqual({ status: 'completed' })
    expect(lease.isCurrent()).toBe(true)
    expect(interrupted).not.toHaveBeenCalled()
    lease.release()
  })

  it('does not begin raw playback if the previous flow could not be interrupted', () => {
    acquireAudio(() => { throw new Error('capture stuck') })
    expect(() => playBrowserSpeech('preview', '茶', 'zh-Hans')).not.toThrow()
    expect(getPlaybackState().error).toContain('capture stuck')
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('cancels an entire tutor reply queue before starting a raw preview', async () => {
    const reply = speakConversationReply([
      { type: 'speech', text: 'Tea', locale: 'en-US' },
      { type: 'speech', text: '茶', locale: 'zh-Hans' },
    ], 0.75)
    const lateEnd = synthesis.speak.mock.calls[0][0].onend
    playBrowserSpeech('preview', '水', 'zh-Hans')
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    lateEnd?.()
    await Promise.resolve()
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(synthesis.speak.mock.calls[1][0].text).toBe('水')
    expect(getPlaybackState().activeId).toBe('preview')
  })

  it('never starts native speech after a playback subscriber supersedes its owning reply', async () => {
    const unsubscribe = subscribePlayback(() => {
      if (getPlaybackState().phase === 'starting') acquireAudio(vi.fn())
    })
    try {
      const reply = speakConversationReply([{ type: 'speech', text: 'Tea', locale: 'en-US' }], 1)
      await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
      expect(synthesis.speak).not.toHaveBeenCalled()
      expectClean()
    } finally {
      unsubscribe()
    }
  })

  it('does not report a spoken reply as completed if native speak ends synchronously then throws', async () => {
    synthesis.speak.mockImplementation(utterance => {
      utterance.onend?.()
      throw new Error('native speech failed')
    })
    const reply = speakConversationReply([{ type: 'speech', text: 'Tea', locale: 'en-US' }], 1)
    await expect(reply.done).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('blocked speech playback') })
    expectClean()
  })

  it('settles synchronous native speech completion without leaking timers', async () => {
    synthesis.speak.mockImplementation(utterance => { utterance.onstart?.(); utterance.onend?.() })
    const reply = speakConversationReply([
      { type: 'speech', text: 'Tea', locale: 'en-US' },
      { type: 'speech', text: '茶', locale: 'zh-Hans' },
    ], 0.75)
    await expect(reply.done).resolves.toEqual({ status: 'completed' })
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expectClean()
  })
})

describe('default Mandarin playback speed', () => {
  it('waits for real playback completion, distinguishing it from cancellation and errors', async () => {
    const result = playBrowserSpeechToEnd('practice', '\u8336', 'zh-Hans', 0.75)
    const finished = vi.fn()
    void result.then(finished)
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    synthesis.speak.mock.calls[0][0].onstart?.()
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    synthesis.speak.mock.calls[0][0].onend?.()
    await expect(result).resolves.toEqual({ status: 'completed' })
    const cancelled = playBrowserSpeechToEnd('cancelled', '\u8336', 'zh-Hans')
    const lateEnd = synthesis.speak.mock.calls[1][0].onend
    stopBrowserSpeech()
    lateEnd?.()
    await expect(cancelled).resolves.toEqual({ status: 'cancelled' })
    const failed = playBrowserSpeechToEnd('failed', '\u8336', 'zh-Hans')
    synthesis.speak.mock.calls[2][0].onerror?.()
    await expect(failed).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('could not be played') })
  })

  it('settles playback promises for missing voices, unsupported browsers, replacement and timeouts', async () => {
    synthesis.getVoices.mockReturnValue([])
    const missing = playBrowserSpeechToEnd('missing', '\u8336', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    await expect(missing).resolves.toMatchObject({ status: 'error' })
    voicesChanged([localMandarin])
    const replaced = playBrowserSpeechToEnd('first', '\u8336', 'zh-Hans')
    const timeout = playBrowserSpeechToEnd('second', '\u8336', 'zh-Hans')
    await expect(replaced).resolves.toEqual({ status: 'cancelled' })
    vi.advanceTimersByTime(10_000)
    await expect(timeout).resolves.toMatchObject({ status: 'error' })
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    await expect(playBrowserSpeechToEnd('unsupported', '\u8336', 'zh-Hans')).resolves.toMatchObject({ status: 'error' })
  })

  it.each([0.5, 0.75, 1, 1.25] as const)('uses the configured default %s only for Mandarin, without playing on configuration', rate => {
    setDefaultSpeechRate(rate)
    expect(synthesis.getVoices).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(synthesis.cancel).not.toHaveBeenCalled()
    playBrowserSpeech('mandarin', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[0][0].rate).toBe(rate)
    playBrowserSpeech('english', 'Tea', 'en-US')
    expect(synthesis.speak.mock.calls[1][0].rate).toBe(1)
  })

  it('keeps the normal unconfigured fallback and restores it when the preference is removed', () => {
    playBrowserSpeech('unconfigured', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[0][0].rate).toBe(1)
    setDefaultSpeechRate(0.5)
    setDefaultSpeechRate()
    playBrowserSpeech('cleared', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[1][0].rate).toBe(1)
  })

  it('honors explicit conversation rates and leaves English normal even with an explicit slower rate', () => {
    setDefaultSpeechRate(0.75)
    playBrowserSpeech('conversation', '茶', 'zh-Hans', 1.25)
    expect(synthesis.speak.mock.calls[0][0].rate).toBe(1.25)
    playBrowserSpeech('normal-conversation', '茶', 'zh-Hans', 1)
    expect(synthesis.speak.mock.calls[1][0].rate).toBe(1)
    playBrowserSpeech('english-conversation', 'Tea', 'en-US', 0.5)
    expect(synthesis.speak.mock.calls[2][0].rate).toBe(1)
  })

  it('applies the same configured default to online browser voices', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin, onlineEnglish])
    setDefaultSpeechRate(0.75)
    playBrowserSpeech('mandarin', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ voice: onlineMandarin, rate: 0.75 })
    playBrowserSpeech('english', 'Tea', 'en-US')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ voice: onlineEnglish, rate: 1 })
  })

  it('does not restart, cancel, or change active playback when the default changes', () => {
    playBrowserSpeech('active', '茶', 'zh-Hans', 1.25)
    synthesis.cancel.mockClear()
    setDefaultSpeechRate(0.5)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].rate).toBe(1.25)
    expect(synthesis.cancel).not.toHaveBeenCalled()
  })

  it.each([0, 0.6, NaN, Infinity, -1, 2, '0.75', null])('rejects invalid default rates without clamping (case %#)', rate => {
    setDefaultSpeechRate(0.75)
    expect(() => setDefaultSpeechRate(rate as SpeechRate)).toThrow()
    expect(synthesis.speak).not.toHaveBeenCalled()
    playBrowserSpeech('unchanged', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[0][0].rate).toBe(0.75)
  })
})

describe('installed-local-voice language matching', () => {
  it('reports completion, cancellation, and errors distinctly and ignores stale callbacks', async () => {
    const completed = vi.fn()
    const completion = playBrowserSpeechToEnd('finished', 'Tea.', 'en-US', 1).then(completed)
    const ended = synthesis.speak.mock.calls[0][0].onend
    ended?.()
    ended?.()
    stopBrowserSpeech()
    await completion
    expect(completed.mock.calls).toEqual([[{ status: 'completed' }]])
    const cancelled = vi.fn()
    const cancellation = playBrowserSpeechToEnd('cancelled', 'Tea.', 'en-US', 1).then(cancelled)
    const lateEnd = synthesis.speak.mock.calls[1][0].onend
    playBrowserSpeech('replacement', 'Coffee.', 'en-US')
    lateEnd?.()
    await cancellation
    expect(cancelled.mock.calls).toEqual([[{ status: 'cancelled' }]])
    const failed = vi.fn()
    await playBrowserSpeechToEnd('invalid', '', 'en-US', 1).then(failed)
    expect(failed).toHaveBeenCalledOnce()
    expect(failed.mock.calls[0][0]).toMatchObject({ status: 'error', error: expect.any(String) })
  })

  it.each([
    'zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', ' ZH_hans_sg ',
    'cmn', 'cmn-CN', 'cmn-Hans-CN', 'zh-cmn-Hans-CN',
    'zh-TW', 'zh-Hant-TW', 'zh-Hant', 'cmn-TW', 'cmn-HK',
  ])('accepts local Mandarin tagged %s regardless of writing script', lang => {
    expect(localVoiceMatches({ ...localMandarin, lang }, 'zh-Hans')).toBe(true)
    expect(localVoiceMatches({ ...localMandarin, lang, localService: false }, 'zh-Hans')).toBe(false)
  })

  it.each([
    'ja-JP', 'en-US', 'zh-HK', 'zh-Hant-HK', 'zh-Hans-HK', 'zh-MO', 'zh-Hant-MO',
    'yue', 'yue-Hant-HK', 'zh-yue', 'nan-TW', 'zh-JP', '', 'zh-', 'zh--CN', 'not a locale',
  ])('does not use %s as an unqualified Mandarin fallback', lang => {
    expect(localVoiceMatches({ ...localMandarin, lang }, 'zh-Hans')).toBe(false)
  })

  it.each(['en', 'en-US', 'eng-US', 'en-GB', ' EN_au ', 'en-US-u-va-posix'])('accepts local English tagged %s', lang => {
    expect(localVoiceMatches({ ...localEnglish, lang }, 'en-US')).toBe(true)
    expect(localVoiceMatches({ ...localEnglish, lang, localService: false }, 'en-US')).toBe(false)
  })

  it('rejects unrelated or malformed English tags and non-boolean local metadata', () => {
    for (const lang of ['de-DE', 'zh-CN', 'english', 'en--US', '']) {
      expect(localVoiceMatches({ ...localEnglish, lang }, 'en-US')).toBe(false)
    }
    expect(localVoiceMatches({ ...localMandarin, localService: undefined as unknown as boolean }, 'zh-Hans')).toBe(false)
    expect(localVoiceMatches({ ...localMandarin, localService: 'true' as unknown as boolean }, 'zh-Hans')).toBe(false)
  })

  it('prefers the requested locale over the first matching voice', () => {
    const traditional = { ...localMandarin, lang: 'zh-TW' }
    const exact = { ...localMandarin, lang: 'zh-Hans' }
    const british = { ...localEnglish, lang: 'en-GB' }
    synthesis.getVoices.mockReturnValue([traditional, localMandarin, exact, british, localEnglish])
    playBrowserSpeech('mandarin', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(exact)
    playBrowserSpeech('english', 'Tea', 'en-US')
    expect(synthesis.speak.mock.calls[1][0].voice).toBe(localEnglish)
  })

  it('prefers mainland Mandarin over Traditional fallback without excluding Taiwanese Mandarin', () => {
    const taiwanese = { ...localMandarin, lang: 'zh-Hant-TW' }
    synthesis.getVoices.mockReturnValue([taiwanese, localMandarin])
    playBrowserSpeech('mainland', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(localMandarin)
    synthesis.getVoices.mockReturnValue([taiwanese])
    playBrowserSpeech('taiwan', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ voice: taiwanese, lang: 'zh-Hant-TW' })
  })
})

describe('cached and selected browser voices', () => {
  it('reuses discovered online voices immediately after playback and navigation, with current native objects', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('first', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    synthesis.speak.mock.calls[0][0].onend?.()
    stopBrowserSpeech()
    const refreshed = { ...onlineMandarin }
    synthesis.getVoices.mockReturnValue([refreshed])
    playBrowserSpeech('second', '你好', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(synthesis.speak.mock.calls[1][0].voice).toBe(refreshed)
    expect(getPlaybackState().phase).toBe('starting')
    expect(voiceListeners.size).toBe(0)
  })

  it('caches each language independently and does not skip discovery for another language', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin, onlineEnglish])
    playBrowserSpeech('first', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    playBrowserSpeech('english', 'Tea', 'en-US')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    playBrowserSpeech('mandarin', '茶', 'zh-Hans')
    playBrowserSpeech('english-again', 'Tea', 'en-US')
    expect(synthesis.speak).toHaveBeenCalledTimes(4)
    expect(synthesis.speak.mock.calls[3][0].voice).toBe(onlineEnglish)
  })

  it('prefers newly available local Mandarin over the cached online fallback', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('first', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    voicesChanged([onlineMandarin, localMandarin])
    playBrowserSpeech('second', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[1][0].voice).toBe(localMandarin)
  })

  it('rediscovers when the cached voice disappears rather than reusing a stale native voice', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('first', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    const replacement = { ...onlineMandarin, voiceURI: 'replacement' }
    voicesChanged([replacement])
    playBrowserSpeech('second', '茶', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak.mock.calls[1][0].voice).toBe(replacement)
  })

  it.each(['refresh', 'error', 'startup timeout', 'new browser API'])('invalidates a cached voice after %s', reason => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('first', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    if (reason === 'refresh') clearVoiceCache()
    if (reason === 'error') synthesis.speak.mock.calls[0][0].onerror?.()
    if (reason === 'startup timeout') vi.advanceTimersByTime(10_000)
    if (reason === 'new browser API') vi.stubGlobal('speechSynthesis', { ...synthesis })
    playBrowserSpeech('second', '茶', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(getPlaybackState().phase).toBe('loading-voices')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('does not cache a missing voice or a failed initial speak call', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('missing', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    synthesis.speak.mockImplementationOnce(() => { throw new Error('Speech unavailable') })
    playBrowserSpeech('blocked', '茶', 'zh-Hans')
    expect(synthesis.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(getPlaybackState().error).toContain('blocked speech')
    playBrowserSpeech('retry', '茶', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('honors explicit online and English selections immediately, even with preferred local alternatives', () => {
    const british = { ...onlineEnglish, lang: 'en-GB', voiceURI: 'chosen-english' }
    synthesis.getVoices.mockReturnValue([localMandarin, localEnglish, onlineMandarin, british])
    setSpeechVoicePreferences({ 'zh-Hans': preference(onlineMandarin), 'en-US': preference(british) })
    playBrowserSpeech('mandarin', '茶', 'zh-Hans')
    playBrowserSpeech('english', 'Tea', 'en-US', 0.5)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(onlineMandarin)
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ voice: british, rate: 1 })
  })

  it('waits for the selected voice instead of immediately choosing another matching voice', () => {
    setSpeechVoicePreferences({ 'zh-Hans': preference(onlineMandarin) })
    playBrowserSpeech('selected', '茶', 'zh-Hans')
    expect(synthesis.speak).not.toHaveBeenCalled()
    voicesChanged([localMandarin, onlineMandarin])
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(onlineMandarin)
  })

  it('does not replace an unavailable explicit local voice with an online voice', () => {
    setSpeechVoicePreferences({ 'zh-Hans': preference(localMandarin) })
    synthesis.getVoices.mockReturnValue([{ ...localMandarin, localService: false }])
    playBrowserSpeech('selected', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState().error).toContain('Choose another voice or Automatic in Settings')
    expectClean()
  })

  it('rejects a selected wrong-language voice despite matching identifiers', () => {
    setSpeechVoicePreferences({ 'zh-Hans': preference(localEnglish) })
    playBrowserSpeech('selected', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState().error).toContain('selected Mandarin voice is not available')
  })

  it('applies preference changes to the next request and cancels stale discovery callbacks', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('first', '茶', 'zh-Hans')
    const lateDiscovery = Array.from(voiceListeners)[0]
    setSpeechVoicePreferences({ 'zh-Hans': preference(onlineMandarin) })
    lateDiscovery()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
    playBrowserSpeech('selected', '茶', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    setSpeechVoicePreferences()
    playBrowserSpeech('automatic', '茶', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('does not interrupt speech or clear cache for unchanged preference metadata', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    setSpeechVoicePreferences({ 'zh-Hans': preference(onlineMandarin) })
    playBrowserSpeech('selected', '茶', 'zh-Hans')
    const before = synthesis.cancel.mock.calls.length
    setSpeechVoicePreferences({ 'zh-Hans': { ...preference(onlineMandarin) } })
    expect(synthesis.cancel).toHaveBeenCalledTimes(before)
    expect(getPlaybackState().phase).toBe('starting')
    expect(browserVoiceKey(preference(onlineMandarin))).toBe(browserVoiceKey(onlineMandarin))
  })
})

describe('voice list observation for settings', () => {
  it('observes delayed lists without speaking, suppresses redundant updates, and bounds polling', () => {
    synthesis.getVoices.mockReturnValue([])
    const listener = vi.fn()
    const stop = watchBrowserVoices(listener)
    expect(listener).toHaveBeenLastCalledWith({ voices: [], loading: true })
    vi.advanceTimersByTime(500)
    expect(listener).toHaveBeenCalledTimes(1)
    voicesChanged([localEnglish, onlineMandarin])
    expect(listener).toHaveBeenLastCalledWith({ voices: [localEnglish, onlineMandarin], loading: true })
    vi.advanceTimersByTime(2500)
    expect(listener).toHaveBeenLastCalledWith({ voices: [localEnglish, onlineMandarin], loading: false })
    expect(vi.getTimerCount()).toBe(0)
    voicesChanged([localMandarin])
    expect(listener).toHaveBeenLastCalledWith({ voices: [localMandarin], loading: false })
    const count = listener.mock.calls.length
    stop()
    voicesChanged([])
    expect(listener).toHaveBeenCalledTimes(count)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(synthesis.cancel).not.toHaveBeenCalled()
    expectClean()
  })

  it('handles missed voiceschanged events and supports cleanup during discovery', () => {
    synthesis.getVoices.mockReturnValue([])
    const listener = vi.fn()
    const stop = watchBrowserVoices(listener)
    synthesis.getVoices.mockReturnValue([localMandarin])
    vi.advanceTimersByTime(100)
    expect(listener).toHaveBeenLastCalledWith({ voices: [localMandarin], loading: true })
    stop()
    expectClean()
  })

  it('supports browsers without voice-list event methods', () => {
    vi.stubGlobal('speechSynthesis', { getVoices: synthesis.getVoices })
    const listener = vi.fn()
    const stop = watchBrowserVoices(listener)
    vi.advanceTimersByTime(3000)
    expect(listener).toHaveBeenLastCalledWith({ voices: [localMandarin, localEnglish], loading: false })
    expect(synthesis.addEventListener).not.toHaveBeenCalled()
    stop()
    expectClean()
  })

  it.each(['unavailable', 'list error', 'listener error'])('reports %s without leaking resources', reason => {
    if (reason === 'unavailable') vi.stubGlobal('speechSynthesis', undefined)
    if (reason === 'list error') synthesis.getVoices.mockImplementation(() => { throw new Error('Cannot enumerate') })
    if (reason === 'listener error') synthesis.addEventListener.mockImplementation(() => { throw new Error('Cannot listen') })
    const listener = vi.fn()
    const stop = watchBrowserVoices(listener)
    expect(listener).toHaveBeenLastCalledWith({ voices: [], loading: false, error: expect.any(String) })
    stop()
    expectClean()
  })
})

describe('bounded browser voice discovery', () => {
  it('waits for an initially empty voice list, then speaks only once on voiceschanged', () => {
    synthesis.getVoices.mockReturnValue([])
    expect(playBrowserSpeech('one', '茶', 'zh-Hans')).toBeUndefined()
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'loading-voices' })
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(voiceListeners.size).toBe(1)
    vi.advanceTimersByTime(500)
    voicesChanged([localMandarin])
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'local' })
    expect(voiceListeners.size).toBe(0)
    voicesChanged([localMandarin])
    vi.advanceTimersByTime(500)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })

  it('waits through a nonempty English-only list and remote Mandarin until local Mandarin arrives', () => {
    synthesis.getVoices.mockReturnValue([localEnglish])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(1000)
    voicesChanged([localEnglish, { ...localMandarin, localService: false }])
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'loading-voices' })
    expect(synthesis.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1900)
    voicesChanged([localEnglish, localMandarin])
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(localMandarin)
    vi.advanceTimersByTime(1000)
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'local' })
  })

  it('uses bounded polling when voiceschanged is not delivered', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', 'Tea', 'en-US')
    synthesis.getVoices.mockReturnValue([localEnglish])
    vi.advanceTimersByTime(99)
    expect(synthesis.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(voiceListeners.size).toBe(0)
  })

  it('supports speech APIs without event listener methods without replacing onvoiceschanged', () => {
    const onvoiceschanged = vi.fn()
    vi.stubGlobal('speechSynthesis', {
      getVoices: synthesis.getVoices, speak: synthesis.speak, cancel: synthesis.cancel, onvoiceschanged,
    })
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    synthesis.getVoices.mockReturnValue([localMandarin])
    vi.advanceTimersByTime(100)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(window.speechSynthesis.onvoiceschanged).toBe(onvoiceschanged)
    expect(synthesis.addEventListener).not.toHaveBeenCalled()
  })

  it.each([
    { voices: [], diagnostic: 'not exposed any speech voices yet' },
    { voices: [onlineEnglish], diagnostic: 'not exposed a matching Mandarin voice, either local or online' },
    { voices: [localEnglish], diagnostic: 'not exposed a matching Mandarin voice, either local or online' },
    { voices: [{ ...localMandarin, lang: 'ja-JP' }], diagnostic: 'not exposed a matching Mandarin voice, either local or online' },
  ])('times out with accurate browser-list diagnostics: $diagnostic', ({ voices, diagnostic }) => {
    synthesis.getVoices.mockReturnValue(voices)
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(2999)
    expect(getPlaybackState().error).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(getPlaybackState().error).toContain(diagnostic)
    expect(getPlaybackState().error).not.toContain('No installed')
    expect(getPlaybackState().activeId).toBeUndefined()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(synthesis.cancel).toHaveBeenCalledTimes(2)
    expectClean()
    const reads = synthesis.getVoices.mock.calls.length
    voicesChanged([localMandarin])
    vi.advanceTimersByTime(60_000)
    expect(synthesis.getVoices).toHaveBeenCalledTimes(reads)
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('diagnoses missing English without attempting to speak Mandarin', () => {
    synthesis.getVoices.mockReturnValue([localMandarin])
    playBrowserSpeech('one', 'Tea', 'en-US')
    vi.advanceTimersByTime(3000)
    expect(getPlaybackState().error).toContain('not exposed a matching English voice, either local or online')
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('falls back to online Mandarin for the observed local-English and remote-Mandarin browser list', () => {
    synthesis.getVoices.mockReturnValue([
      ...['Microsoft David', 'Microsoft Mark', 'Microsoft Zira'].map(name => ({ ...localEnglish, name })),
      ...['zh-CN', 'zh-TW', 'zh-HK'].map(lang => ({ ...localMandarin, name: `Google ${lang}`, lang, localService: false })),
    ])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toMatchObject({ name: 'Google zh-CN', localService: false })
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'online' })
    synthesis.speak.mock.calls[0][0].onend?.()
    expectClean()
  })

  it('finalizes discovery using the current list if a throttled event arrives at the deadline', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.spyOn(performance, 'now').mockReturnValue(3001)
    voicesChanged([onlineMandarin])
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'online' })
    synthesis.speak.mock.calls[0][0].onend?.()
    expectClean()
  })

  it('remains bounded when the wall clock moves backwards', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.setSystemTime(-60_000)
    vi.advanceTimersByTime(3000)
    expect(getPlaybackState().error).toContain('not exposed any speech voices')
    expectClean()
  })
})

describe('matching online browser voice fallback', () => {
  it('waits the full discovery window before online fallback and exposes actual voice kind through completion', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    expect(playBrowserSpeech('one', '茶', 'zh-Hans')).toBeUndefined()
    vi.advanceTimersByTime(2999)
    voicesChanged([onlineMandarin])
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'loading-voices' })
    vi.advanceTimersByTime(1)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(voiceListeners.size).toBe(0)
    const utterance = synthesis.speak.mock.calls[0][0]
    expect(utterance.voice).toBe(onlineMandarin)
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'online' })
    utterance.onstart?.()
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'speaking', voiceKind: 'online' })
    voicesChanged([onlineMandarin, localMandarin])
    vi.advanceTimersByTime(1000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(getPlaybackState().voiceKind).toBe('online')
    utterance.onend?.()
    expect(getPlaybackState()).toEqual({})
    expectClean()
  })

  it('handles empty and partial lists followed by an online candidate without restarting the wait', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(1000)
    voicesChanged([localEnglish])
    vi.advanceTimersByTime(1000)
    voicesChanged([localEnglish, onlineMandarin])
    expect(synthesis.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(onlineMandarin)
  })

  it('does not allow a wall-clock jump to shorten the local preference window', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.setSystemTime(60_000)
    voicesChanged([onlineMandarin])
    vi.advanceTimersByTime(2999)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'loading-voices' })
    vi.advanceTimersByTime(1)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(getPlaybackState().voiceKind).toBe('online')
  })

  it('prefers a local Taiwanese Mandarin voice immediately over an online mainland voice', () => {
    const taiwanese = { ...localMandarin, lang: 'zh-TW' }
    synthesis.getVoices.mockReturnValue([onlineMandarin, taiwanese])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(taiwanese)
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'local' })
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })

  it.each(['voiceschanged', 'deadline recheck'])('lets delayed local Mandarin defeat an online candidate via %s', discovery => {
    const taiwanese = { ...localMandarin, lang: 'zh-Hant-TW' }
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(2999)
    synthesis.getVoices.mockReturnValue([onlineMandarin, taiwanese])
    if (discovery === 'voiceschanged') voicesChanged([onlineMandarin, taiwanese])
    else vi.advanceTimersByTime(1)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(taiwanese)
    expect(getPlaybackState().voiceKind).toBe('local')
  })

  it('prefers the target locale among online Mandarin candidates', () => {
    const taiwanese = { ...onlineMandarin, lang: 'zh-TW' }
    const exact = { ...onlineMandarin, lang: 'zh-Hans' }
    synthesis.getVoices.mockReturnValue([taiwanese, onlineMandarin, exact])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(exact)
  })

  it.each(['en-US', 'ja-JP', 'yue', 'yue-Hant-HK', 'zh-HK', 'zh-Hant-HK', 'zh-MO', 'zh--CN'])(
    'rejects an online %s voice instead of speaking the wrong language', lang => {
      synthesis.getVoices.mockReturnValue([{ ...onlineMandarin, lang }])
      playBrowserSpeech('one', '茶', 'zh-Hans')
      vi.advanceTimersByTime(3000)
      expect(synthesis.speak).not.toHaveBeenCalled()
      expect(getPlaybackState().error).toContain('not exposed a matching Mandarin voice, either local or online')
      expectClean()
    },
  )

  it('does not choose online Mandarin when English was requested', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', 'Tea', 'en-US')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState().error).toContain('not exposed a matching English voice, either local or online')
    expectClean()
  })

  it('does not select a voice whose local/online classification is unknown', () => {
    synthesis.getVoices.mockReturnValue([{ ...onlineMandarin, localService: undefined as unknown as boolean }])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState().error).toContain('not exposed a matching Mandarin voice')
    expectClean()
  })

  it('does not use an online candidate that disappeared from the final browser list', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(2999)
    synthesis.getVoices.mockReturnValue([localEnglish])
    vi.advanceTimersByTime(1)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState().error).toContain('not exposed a matching Mandarin voice')
    expectClean()
  })

  it('applies Mandarin speed to online speech and keeps online English at normal speed', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin, onlineEnglish])
    playBrowserSpeech('one', '茶', 'zh-Hans', 0.5)
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ voice: onlineMandarin, lang: 'zh-CN', rate: 0.5 })
    playBrowserSpeech('two', 'Tea', 'en-US', 0.5)
    expect(getPlaybackState()).toEqual({ activeId: 'two', phase: 'loading-voices' })
    vi.advanceTimersByTime(3000)
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ voice: onlineEnglish, lang: 'en-US', rate: 1 })
    expect(getPlaybackState()).toEqual({ activeId: 'two', phase: 'starting', voiceKind: 'online' })
  })

  it('cancels before fallback without allowing late voice events or the timeout to start playback', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    const lateDiscovery = Array.from(voiceListeners)[0]
    vi.advanceTimersByTime(2999)
    stopBrowserSpeech()
    expectClean()
    vi.advanceTimersByTime(60_000)
    lateDiscovery()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState()).toEqual({})
  })

  it('supersedes pending fallback and prevents the old timeout from changing new playback', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin, localEnglish])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    const lateDiscovery = Array.from(voiceListeners)[0]
    vi.advanceTimersByTime(2999)
    playBrowserSpeech('two', 'Tea', 'en-US')
    lateDiscovery()
    vi.advanceTimersByTime(1000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(localEnglish)
    expect(getPlaybackState()).toEqual({ activeId: 'two', phase: 'starting', voiceKind: 'local' })
  })

  it('ignores stale online utterance callbacks after replacement with local playback', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin, localEnglish])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    const utterance = synthesis.speak.mock.calls[0][0]
    const callbacks = [utterance.onstart, utterance.onend, utterance.onerror]
    playBrowserSpeech('two', 'Tea', 'en-US')
    callbacks.forEach(callback => callback?.())
    expect(getPlaybackState()).toEqual({ activeId: 'two', phase: 'starting', voiceKind: 'local' })
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('reports online synthesis errors without claiming local-only playback or retrying automatically', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    synthesis.speak.mock.calls[0][0].onerror?.()
    expect(getPlaybackState().error).toContain('Online browser speech could not be played')
    expect(getPlaybackState().error).toContain('network connection')
    expect(getPlaybackState().voiceKind).toBeUndefined()
    vi.advanceTimersByTime(60_000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expectClean()
  })

  it('handles an online speak exception from the timeout callback without an unhandled rejection', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    synthesis.speak.mockImplementation(() => { throw new Error('network unavailable') })
    playBrowserSpeech('one', '茶', 'zh-Hans')
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow()
    expect(getPlaybackState().error).toContain('browser blocked speech playback')
    expectClean()
  })

  it('preserves the playback start timeout after online fallback and cancels late starts', () => {
    synthesis.getVoices.mockReturnValue([onlineMandarin])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    vi.advanceTimersByTime(3000)
    const utterance = synthesis.speak.mock.calls[0][0]
    const lateStart = utterance.onstart
    vi.advanceTimersByTime(10_000)
    expect(getPlaybackState().error).toContain('did not start speech in time')
    lateStart?.()
    expect(getPlaybackState().phase).toBeUndefined()
    expectClean()
  })
})

describe('cancellation and stale callbacks', () => {
  it.each(['Stop', 'navigation', 'page hiding', 'unmount'])('cancels waiting via stopBrowserSpeech for %s', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    const lateDiscovery = Array.from(voiceListeners)[0]
    stopBrowserSpeech()
    expect(getPlaybackState()).toEqual({})
    expectClean()
    synthesis.getVoices.mockReturnValue([localMandarin])
    lateDiscovery()
    vi.advanceTimersByTime(20_000)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState()).toEqual({})
  })

  it('supersedes waiting requests and ignores their queued discovery callbacks', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    const lateDiscovery = Array.from(voiceListeners)[0]
    vi.advanceTimersByTime(2500)
    playBrowserSpeech('two', 'Tea', 'en-US')
    synthesis.getVoices.mockReturnValue([localMandarin, localEnglish])
    lateDiscovery()
    expect(synthesis.speak).not.toHaveBeenCalled()
    voicesChanged([localMandarin, localEnglish])
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ text: 'Tea', voice: localEnglish })
    vi.advanceTimersByTime(500)
    expect(getPlaybackState()).toEqual({ activeId: 'two', phase: 'starting', voiceKind: 'local' })
  })

  it('replaces active playback with discovery and ignores captured start, end, and error callbacks', () => {
    playBrowserSpeech('one', 'Tea', 'en-US')
    const first = synthesis.speak.mock.calls[0][0]
    first.onstart?.()
    const callbacks = [first.onstart, first.onend, first.onerror]
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('two', '茶', 'zh-Hans')
    callbacks.forEach(callback => callback?.())
    expect(getPlaybackState()).toEqual({ activeId: 'two', phase: 'loading-voices' })
    expect(first.onstart).toBeNull()
    expect(first.onend).toBeNull()
    expect(first.onerror).toBeNull()
    voicesChanged([localMandarin])
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(getPlaybackState().activeId).toBe('two')
  })

  it('ignores stale utterance callbacks even when a new playback reuses the same id', () => {
    playBrowserSpeech('same', 'Tea', 'en-US')
    const first = synthesis.speak.mock.calls[0][0]
    const callbacks = [first.onstart, first.onend, first.onerror]
    playBrowserSpeech('same', 'Rain', 'en-US')
    callbacks.forEach(callback => callback?.())
    expect(getPlaybackState()).toEqual({ activeId: 'same', phase: 'starting', voiceKind: 'local' })
  })

  it('cancels active playback before browser cancellation can dispatch callbacks', () => {
    playBrowserSpeech('one', 'Tea', 'en-US')
    const utterance = synthesis.speak.mock.calls[0][0]
    const callbacks = [utterance.onstart, utterance.onend, utterance.onerror]
    synthesis.cancel.mockImplementation(() => callbacks.forEach(callback => callback?.()))
    stopBrowserSpeech()
    expect(getPlaybackState()).toEqual({})
    expectClean()
    callbacks.forEach(callback => callback?.())
    vi.advanceTimersByTime(60_000)
    expect(getPlaybackState()).toEqual({})
  })

  it('honors subscribers stopping before queued playback starts', () => {
    const unsubscribe = subscribePlayback(() => {
      if (getPlaybackState().phase === 'starting') stopBrowserSpeech()
    })
    try {
      playBrowserSpeech('one', '茶', 'zh-Hans')
      expect(getPlaybackState()).toEqual({})
      expect(synthesis.speak).not.toHaveBeenCalled()
      expectClean()
    } finally {
      unsubscribe()
    }
  })

  it('honors subscribers stopping during loading and supports unsubscription', () => {
    const listener = vi.fn(() => {
      if (getPlaybackState().phase === 'loading-voices') stopBrowserSpeech()
    })
    const unsubscribe = subscribePlayback(listener)
    try {
      playBrowserSpeech('one', '茶', 'zh-Hans')
      expect(synthesis.getVoices).not.toHaveBeenCalled()
      expect(synthesis.speak).not.toHaveBeenCalled()
      expectClean()
    } finally {
      unsubscribe()
    }
    const notifications = listener.mock.calls.length
    playBrowserSpeech('two', 'Tea', 'en-US')
    expect(listener).toHaveBeenCalledTimes(notifications)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })
})

describe('playback lifecycle, errors, and input', () => {
  it('reports speaking only on browser start and clears state/timers on completion', () => {
    playBrowserSpeech('one', '茶', 'zh-Hans')
    const utterance = synthesis.speak.mock.calls[0][0]
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'starting', voiceKind: 'local' })
    utterance.onstart?.()
    expect(getPlaybackState()).toEqual({ activeId: 'one', phase: 'speaking', voiceKind: 'local' })
    vi.advanceTimersByTime(10_000)
    expect(getPlaybackState().phase).toBe('speaking')
    utterance.onend?.()
    expect(getPlaybackState()).toEqual({})
    expectClean()
  })

  it('applies Mandarin speech speed but keeps English at normal speed', () => {
    playBrowserSpeech('one', '茶', 'zh-Hans', 0.5)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ lang: 'zh-CN', rate: 0.5, voice: localMandarin })
    playBrowserSpeech('two', 'Tea', 'en-US', 0.5)
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ lang: 'en-US', rate: 1, voice: localEnglish })
  })

  it('uses a normalized locale for the utterance while retaining the selected local voice', () => {
    const voice = { ...localMandarin, lang: ' ZH_hans_cn ' }
    synthesis.getVoices.mockReturnValue([voice])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ voice, lang: 'zh-Hans-CN' })
  })

  it.each([[NaN, 1], [Infinity, 1], [-Infinity, 1], [0, 0.1], [-1, 0.1], [100, 10]])(
    'normalizes invalid or out-of-range Mandarin rate %s to %s', (rate, expected) => {
      playBrowserSpeech('one', '茶', 'zh-Hans', rate)
      expect(synthesis.speak.mock.calls[0][0].rate).toBe(expected)
    },
  )

  it('fails visibly on browser synthesis errors and ignores callbacks after failure', () => {
    playBrowserSpeech('one', 'Tea', 'en-US')
    const utterance = synthesis.speak.mock.calls[0][0]
    const callbacks = [utterance.onstart, utterance.onend, utterance.onerror]
    utterance.onerror?.()
    expect(getPlaybackState().error).toContain('could not be played')
    const failed = getPlaybackState()
    callbacks.forEach(callback => callback?.())
    expect(getPlaybackState()).toBe(failed)
    expectClean()
  })

  it('fails and cancels when speak throws without leaking callbacks or timers', () => {
    synthesis.speak.mockImplementation(() => { throw new Error('blocked') })
    expect(() => playBrowserSpeech('one', 'Tea', 'en-US')).not.toThrow()
    expect(getPlaybackState().error).toContain('browser blocked speech')
    expect(synthesis.cancel).toHaveBeenCalledTimes(2)
    expectClean()
  })

  it.each(['initial', 'delayed'])('fails visibly when getVoices throws during %s discovery', timing => {
    synthesis.getVoices.mockReturnValue([])
    if (timing === 'initial') synthesis.getVoices.mockImplementation(() => { throw new Error('unavailable') })
    expect(() => playBrowserSpeech('one', 'Tea', 'en-US')).not.toThrow()
    if (timing === 'delayed') {
      synthesis.getVoices.mockImplementation(() => { throw new Error('unavailable') })
      expect(() => vi.advanceTimersByTime(100)).not.toThrow()
    }
    expect(getPlaybackState().error).toContain('could not list speech voices')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
  })

  it('fails visibly if the utterance constructor throws', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor() { throw new Error('blocked') } })
    expect(() => playBrowserSpeech('one', 'Tea', 'en-US')).not.toThrow()
    expect(getPlaybackState().error).toContain('could not prepare speech')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
  })

  it('fails visibly and cleans up if voice event registration throws', () => {
    synthesis.addEventListener.mockImplementation(() => { throw new Error('blocked') })
    expect(() => playBrowserSpeech('one', 'Tea', 'en-US')).not.toThrow()
    expect(getPlaybackState().error).toContain('could not watch for speech voices')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
  })

  it('invalidates waiting callbacks even if browser cancellation throws, and refuses replacement playback', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    const lateDiscovery = Array.from(voiceListeners)[0]
    synthesis.cancel.mockImplementation(() => { throw new Error('blocked') })
    expect(() => playBrowserSpeech('two', 'Tea', 'en-US')).not.toThrow()
    expect(getPlaybackState().error).toContain('could not stop speech')
    synthesis.getVoices.mockReturnValue([localMandarin, localEnglish])
    lateDiscovery()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
    synthesis.cancel.mockReset()
    stopBrowserSpeech()
    expect(getPlaybackState()).toEqual({})
  })

  it('times out an utterance that never starts and ignores its late callbacks', () => {
    playBrowserSpeech('one', 'Tea', 'en-US')
    const utterance = synthesis.speak.mock.calls[0][0]
    const callbacks = [utterance.onstart, utterance.onend, utterance.onerror]
    vi.advanceTimersByTime(10_000)
    expect(getPlaybackState().error).toContain('did not start speech in time')
    expect(synthesis.cancel).toHaveBeenCalledTimes(2)
    const failed = getPlaybackState()
    callbacks.forEach(callback => callback?.())
    expect(getPlaybackState()).toBe(failed)
    expectClean()
  })

  it('times out a started utterance that never finishes rather than reporting success', () => {
    playBrowserSpeech('one', 'Tea', 'en-US')
    const utterance = synthesis.speak.mock.calls[0][0]
    utterance.onstart?.()
    const lateEnd = utterance.onend
    vi.advanceTimersByTime(30_000)
    expect(getPlaybackState().error).toContain('playback timed out')
    expect(synthesis.cancel).toHaveBeenCalledTimes(2)
    lateEnd?.()
    expect(getPlaybackState().error).toContain('playback timed out')
    expectClean()
  })

  it('allows a proportionally longer completion window for long, slow Mandarin', () => {
    playBrowserSpeech('one', '茶'.repeat(20), 'zh-Hans', 0.5)
    const utterance = synthesis.speak.mock.calls[0][0]
    utterance.onstart?.()
    vi.advanceTimersByTime(94_999)
    expect(getPlaybackState().phase).toBe('speaking')
    vi.advanceTimersByTime(1)
    expect(getPlaybackState().error).toContain('playback timed out')
    expectClean()
  })

  it.each(['', '   ', 'a'.repeat(8001)])('rejects empty or oversized text', text => {
    expect(() => playBrowserSpeech('one', text, 'en-US')).not.toThrow()
    expect(getPlaybackState().error).toContain('at most 8,000 characters')
    expect(synthesis.getVoices).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
  })

  it('accepts the maximum passage length', () => {
    playBrowserSpeech('one', 'a'.repeat(8000), 'en-US')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })

  it('cancels an existing request even when its replacement has invalid text', () => {
    synthesis.getVoices.mockReturnValue([])
    playBrowserSpeech('one', '茶', 'zh-Hans')
    playBrowserSpeech('two', '', 'en-US')
    voicesChanged([localMandarin])
    expect(getPlaybackState().error).toContain('at most 8,000 characters')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
  })

  it.each(['synthesis', 'utterance', 'window'])('handles a missing browser %s API synchronously', missing => {
    vi.stubGlobal(missing === 'synthesis' ? 'speechSynthesis' : missing === 'utterance' ? 'SpeechSynthesisUtterance' : 'window', undefined)
    expect(() => playBrowserSpeech('one', 'Tea', 'en-US')).not.toThrow()
    expect(getPlaybackState().error).toContain('not available in this browser')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expectClean()
  })
})
