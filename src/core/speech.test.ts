import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  matchingSpeechVoice,
  readAloud,
  playSpeechSegments,
  stopSpeech,
  type SpeechPlaybackHandlers,
} from './speech'

class FakeUtterance {
  lang = ''
  rate = 1
  volume = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null

  constructor(public text: string) {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('speech playback', () => {
  it('plays locale-tagged segments in order and rejects stale events after Stop', async () => {
    const spoken: FakeUtterance[] = []
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ lang: 'en-US', name: 'English' }, { lang: 'ja-JP', name: 'Japanese' }],
      speak: (utterance: FakeUtterance) => spoken.push(utterance), cancel: vi.fn(), resume: vi.fn(),
    })
    const controller = new AbortController()
    const playback = playSpeechSegments([{ text: 'Hello', locale: 'en-US' }, { text: 'こんにちは', locale: 'ja-JP' }], controller.signal)
    expect(spoken[0].lang).toBe('en-US')
    const staleEnd = spoken[0].onend
    stopSpeech()
    staleEnd?.()
    expect(spoken).toHaveLength(1)
    await expect(playback).rejects.toThrow('stopped')
  })
  it('does not substitute a known wrong-language voice', async () => {
    const speak = vi.fn()
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'en-US' }], speak, cancel: vi.fn() })
    await expect(playSpeechSegments([{ text: 'こんにちは', locale: 'ja-JP' }], new AbortController().signal)).rejects.toThrow('No ja-JP voice')
    expect(speak).not.toHaveBeenCalled()
  })
  it('matches a voice by language prefix', () => {
    const voice = { lang: 'zh-TW', name: 'Chinese voice' } as SpeechSynthesisVoice

    expect(matchingSpeechVoice([voice], 'zh-CN')).toBe(voice)
  })

  it('speaks synchronously with the language tag when Android reports no voices', () => {
    let spoken: FakeUtterance | undefined
    const speechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      speak: (utterance: FakeUtterance) => {
        spoken = utterance
      },
      cancel: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', speechSynthesis)

    const voiceName = readAloud(
      '你好',
      'zh-CN',
      0.75,
      {} as SpeechPlaybackHandlers,
    )

    expect(spoken?.text).toBe('你好')
    expect(spoken?.lang).toBe('zh-CN')
    expect(spoken?.rate).toBe(0.75)
    expect(voiceName).toContain('system zh-CN')
  })
})
