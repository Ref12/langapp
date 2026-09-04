import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  matchingSpeechVoice,
  readAloud,
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
