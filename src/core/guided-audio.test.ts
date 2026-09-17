import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGuidedAudio, type GuidedAudioState } from './guided-audio'
import type { AudioStep } from './learning-content'
import { clearVoiceCache, getPlaybackState, playBrowserSpeech, setSpeechVoicePreferences, stopBrowserSpeech } from './assistant/speech'

class Utterance {
  constructor(public text: string) {}
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}
const english = { name: 'English', voiceURI: 'en', lang: 'en-US', localService: true, default: false }
const mandarin = { ...english, name: 'Mandarin', voiceURI: 'zh', lang: 'zh-CN' }
const synthesis = {
  getVoices: vi.fn(() => [english, mandarin]),
  speak: vi.fn<(utterance: Utterance) => void>(),
  cancel: vi.fn(),
}
const steps: AudioStep[] = [
  { kind: 'speech', modelId: 'greeting', locale: 'en-US', text: 'Answer aloud.' },
  { kind: 'response', modelId: 'greeting', seconds: 3 },
  { kind: 'speech', modelId: 'greeting', locale: 'zh-Hans', text: '\u4f60\u597d' },
]
let states: GuidedAudioState[]
let player: ReturnType<typeof createGuidedAudio>
const latest = () => states[states.length - 1]
const finish = () => {
  synthesis.speak.mock.calls[synthesis.speak.mock.calls.length - 1][0].onend?.()
  vi.advanceTimersByTime(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', synthesis)
  synthesis.getVoices.mockReset().mockReturnValue([english, mandarin])
  synthesis.speak.mockReset()
  synthesis.cancel.mockReset()
  setSpeechVoicePreferences()
  stopBrowserSpeech()
  clearVoiceCache()
  states = []
  player = createGuidedAudio('guided', steps, state => states.push(state))
})
afterEach(() => {
  player.dispose()
  stopBrowserSpeech()
  expect(vi.getTimerCount()).toBe(0)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('guided audio lifecycle using real browser speech engine', () => {
  it('advances only on successful completion, leaves the response gap, then finishes', () => {
    player.start()
    expect(latest()).toMatchObject({ status: 'playing', index: 0 })
    vi.advanceTimersByTime(100)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    finish()
    expect(latest()).toMatchObject({ status: 'responding', index: 1 })
    vi.advanceTimersByTime(2999)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(synthesis.speak.mock.calls[1][0].text).toBe('\u4f60\u597d')
    finish()
    expect(latest()).toMatchObject({ status: 'completed', index: 3 })
  })

  it.each(['speech', 'gap', 'between'] as const)('global Stop cancels %s without advancing', phase => {
    player.start()
    const staleEnd = synthesis.speak.mock.calls[0][0].onend
    if (phase === 'gap') finish()
    if (phase === 'between') staleEnd?.()
    stopBrowserSpeech()
    staleEnd?.()
    vi.advanceTimersByTime(60_000)
    expect(latest().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })

  it.each(['speech', 'gap', 'between'] as const)('another Hear owns playback after replacing %s', phase => {
    player.start()
    if (phase === 'gap') finish()
    if (phase === 'between') synthesis.speak.mock.calls[0][0].onend?.()
    playBrowserSpeech('hear', 'Tea.', 'en-US')
    expect(latest().status).toBe('paused')
    expect(getPlaybackState().activeId).toBe('hear')
    finish()
    vi.advanceTimersByTime(60_000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    player.dispose()
    expect(getPlaybackState().activeId).toBeUndefined()
  })

  it('changing voice preferences interrupts a response gap', () => {
    player.start()
    finish()
    setSpeechVoicePreferences({ 'en-US': { name: english.name, voiceURI: english.voiceURI, lang: english.lang, localService: english.localService } })
    vi.advanceTimersByTime(10_000)
    expect(latest().status).toBe('paused')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })

  it('pause/resume restarts the current response gap and repeat restarts the model', () => {
    player.start()
    finish()
    vi.advanceTimersByTime(2000)
    player.pause()
    vi.advanceTimersByTime(10_000)
    player.resume()
    vi.advanceTimersByTime(2000)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    player.repeat()
    expect(synthesis.speak.mock.calls[2][0].text).toBe('Answer aloud.')
    player.next()
    expect(latest()).toMatchObject({ status: 'responding', index: 1 })
    player.stop()
    expect(latest()).toMatchObject({ status: 'idle', index: 0 })
  })

  it('disposing a gap cancels its timer and does not stop someone else', () => {
    player.start()
    finish()
    player.dispose()
    playBrowserSpeech('other', 'Other.', 'en-US')
    player.dispose()
    expect(getPlaybackState().activeId).toBe('other')
    synthesis.speak.mock.calls[1][0].onend?.()
    vi.advanceTimersByTime(10_000)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it.each(['missing', 'error', 'timeout', 'blocked'] as const)('surfaces %s playback failures without advancing', failure => {
    if (failure === 'missing') synthesis.getVoices.mockReturnValue([])
    if (failure === 'blocked') synthesis.speak.mockImplementationOnce(() => { throw new Error('blocked') })
    player.start()
    if (failure === 'missing') vi.advanceTimersByTime(3000)
    if (failure === 'timeout') vi.advanceTimersByTime(10_000)
    if (failure === 'error') synthesis.speak.mock.calls[0][0].onerror?.()
    expect(latest().status).toBe('error')
    expect(latest().error).toBeTruthy()
    vi.advanceTimersByTime(60_000)
    expect(synthesis.speak.mock.calls.length).toBe(failure === 'missing' ? 0 : 1)
  })
})
