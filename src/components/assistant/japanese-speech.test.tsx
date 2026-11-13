// @vitest-environment jsdom
// Speech in a Japanese build: the pack's locale reaches the speech call, and the voice setting is named for Japanese and lists only Japanese voices.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPack } from '../../core/language'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { browserVoiceMatches } from '../../core/assistant/speech'
import { loadCatalog, resetCatalogCache } from '../../core/study/catalog'
import { spoken as spokenPiece } from '../../pages/Study'
import { HearButton, SnippetActions } from './SnippetActions'
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

beforeEach(async () => {
  setBuildLanguageForTests('ja')
  await loadCatalog()
  spoken = []
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: Object.assign(new EventTarget(), {
    getVoices: () => voices, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), speaking: false, pending: false, paused: false,
    speak: (utterance: Utterance) => { spoken.push(utterance) },
  }) })
})
afterEach(() => { resetCatalogCache(); cleanup(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined) })

describe('speech in a Japanese build', () => {
  it('takes its locale from the pack', () => {
    expect(getPack().speechLocale).toBe('ja-JP')
  })
  it('Hear speaks with a ja-JP language', async () => {
    render(<HearButton text="勉強する" locale={getPack().speechLocale} label="Hear 勉強する" iconOnly />)
    await userEvent.click(screen.getByRole('button', { name: 'Hear 勉強する' }))
    const hear = spoken.find(item => item.text === 'べんきょうする')
    expect(hear?.lang).toBe('ja-JP')
    expect(spoken.every(item => item.lang === 'ja-JP')).toBe(true)
  })
  it('Hear speaks a word from its kana reading, a given reading and a piece of a sentence the same way, and a sentence as written', async () => {
    const hear = async (props: Partial<Parameters<typeof HearButton>[0]> & { text: string }) => {
      spoken.length = 0
      render(<HearButton locale="ja-JP" label="Hear it" iconOnly {...props} />)
      await userEvent.click(screen.getByRole('button', { name: 'Hear it' }))
      cleanup()
      return spoken.find(item => item.lang === 'ja-JP' && item.text !== '準備ができました。')?.text
    }
    expect(await hear({ text: '今日' })).toBe('きょう')
    expect(await hear({ text: '上手', reading: 'じょうず', kind: 'word' })).toBe('じょうず')
    expect(await hear({ text: 'は', kind: 'fragment' })).toBe('わ')
    expect(await hear({ text: '今日は天気がいいです。' })).toBe('きょうは天気がいいです。')
    expect(await hear({ text: '難読', kind: 'word' })).toBe('難読')
  })
  it('the Hear of a phrase menu (SnippetActions) passes the word reading it was given', async () => {
    spoken.length = 0
    render(<SnippetActions source={{ text: '上手', title: 'Word: skilled', route: 'study', locale: 'ja-JP', reading: 'じょうず' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Hear 上手' }))
    expect(spoken.some(item => item.text === 'じょうず')).toBe(true)
    expect(spoken.some(item => item.text === '上手')).toBe(false)
  })
  it('the tile, option and match speech of Study goes through the pack', () => {
    const readings = new Map([['学生', new Set(['がくせい'])], ['人', new Set(['ひと', 'じん'])]])
    expect(spokenPiece('学生', readings, 'word')).toBe('がくせい')
    expect(spokenPiece('は', readings)).toBe('わ')
    expect(spokenPiece('人', readings, 'word')).toBe('人')
    expect(spokenPiece('勉強します', readings)).toBe('べんきょうします')
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
