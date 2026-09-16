import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlaybackState, localVoiceMatches, playLocalSpeech, stopLocalSpeech } from './speech'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onend?: () => void
  onerror?: () => void
}

const localMandarin = { name: 'Local Mandarin', lang: 'zh-CN', localService: true, voiceURI: 'local-zh', default: false }
const localEnglish = { name: 'Local English', lang: 'en-US', localService: true, voiceURI: 'local-en', default: false }
const synthesis = { getVoices: vi.fn(() => [localMandarin, localEnglish]), speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn() }

beforeEach(() => {
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', synthesis)
  synthesis.getVoices.mockReturnValue([localMandarin, localEnglish])
  synthesis.speak.mockReset()
  stopLocalSpeech()
})
afterEach(() => { stopLocalSpeech(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('installed-local-voice playback', () => {
  it('matches language and refuses remote or wrong-language voices', () => {
    expect(localVoiceMatches(localMandarin, 'zh-Hans')).toBe(true)
    expect(localVoiceMatches({ ...localMandarin, localService: false }, 'zh-Hans')).toBe(false)
    expect(localVoiceMatches({ ...localMandarin, lang: 'ja-JP' }, 'zh-Hans')).toBe(false)
    expect(localVoiceMatches({ ...localMandarin, lang: 'zh-TW' }, 'zh-Hans')).toBe(false)
    synthesis.getVoices.mockReturnValue([{ ...localMandarin, localService: false }])
    playLocalSpeech('one', '\u8336', 'zh-Hans')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState().error).toContain('No installed local Mandarin voice')
  })

  it('applies target speech speed but keeps English at normal speed', () => {
    playLocalSpeech('one', '\u8336', 'zh-Hans', 0.5)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ lang: 'zh-CN', rate: 0.5, voice: localMandarin })
    playLocalSpeech('two', 'Tea', 'en-US', 0.5)
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ lang: 'en-US', rate: 1 })
    expect(getPlaybackState()).toEqual({ activeId: 'two' })
  })

  it('ignores stale playback callbacks and reports failures visibly', () => {
    playLocalSpeech('one', 'Tea', 'en-US')
    const first = synthesis.speak.mock.calls[0][0]
    playLocalSpeech('two', 'Rain', 'en-US')
    first.onend?.()
    first.onerror?.()
    expect(getPlaybackState().activeId).toBe('two')
    synthesis.speak.mock.calls[1][0].onerror?.()
    expect(getPlaybackState().error).toContain('could not be played')
    stopLocalSpeech()
    expect(getPlaybackState()).toEqual({})
  })
})
