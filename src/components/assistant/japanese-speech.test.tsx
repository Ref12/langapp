// @vitest-environment jsdom
// Speech in a Japanese build: the pack's locale reaches the speech call, and the voice setting is named for Japanese and lists only Japanese voices.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPack } from '../../core/language'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { browserVoiceMatches } from '../../core/assistant/speech'
import { HearButton } from './SnippetActions'
import { VoiceSelect } from './VoiceSettings'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
}
const voice = (name: string, lang: string): SpeechSynthesisVoice => ({ name, lang, localService: true, default: false, voiceURI: name })
const voices = [voice('Tingting', 'zh-CN'), voice('Kyoko', 'ja-JP'), voice('Samantha', 'en-US'), voice('Yuna', 'ko-KR')]
let spoken: Utterance[]

beforeEach(() => {
  setBuildLanguageForTests('ja')
  spoken = []
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: Object.assign(new EventTarget(), {
    getVoices: () => voices, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), speaking: false, pending: false, paused: false,
    speak: (utterance: Utterance) => { spoken.push(utterance) },
  }) })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined) })

describe('speech in a Japanese build', () => {
  it('takes its locale from the pack', () => {
    expect(getPack().speechLocale).toBe('ja-JP')
  })
  it('Hear speaks with a ja-JP language', async () => {
    render(<HearButton text="勉強する" locale={getPack().speechLocale} label="Hear 勉強する" iconOnly />)
    await userEvent.click(screen.getByRole('button', { name: 'Hear 勉強する' }))
    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('勉強する')
    expect(spoken[0].lang).toBe('ja-JP')
  })
  it('the voice filter keeps Japanese voices only', () => {
    expect(voices.filter(item => browserVoiceMatches(item, 'ja-JP')).map(item => item.name)).toEqual(['Kyoko'])
  })
  it('the voice picker for the build offers only Japanese voices', async () => {
    render(<VoiceSelect locale={getPack().speechLocale} label="Japanese voice" onPick={() => undefined} catalog={{ state: { voices, loading: false }, edge: { voices: [], loading: false }, edgeAvailable: false } as never} />)
    const options = (await screen.findAllByRole('option')).map(option => option.textContent ?? '').join('|')
    expect(options).toContain('Kyoko')
    expect(options).not.toMatch(/Tingting|Samantha|Yuna/)
  })
})
