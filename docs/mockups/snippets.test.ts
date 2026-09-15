import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const script = readFileSync(resolve('docs', 'mockups', 'snippets.js'), 'utf8')
class PreviewUtterance {
  constructor(public text: string) {}
  rate = 1
  onstart: (() => void) | null = null
}
let page: Document
let utterances: PreviewUtterance[]
let voices: { localService: boolean; lang: string }[]
let api: {
  snippetButton: (icon: string, label: string) => HTMLButtonElement
  playSnippet: (snippet: { text: string; lang: string; rate?: number; concealText?: boolean }, button: HTMLButtonElement) => Promise<void>
  stopSnippetSpeech: (announce?: boolean) => void
}

beforeEach(() => {
  page = document.implementation.createHTMLDocument('Speech fixture')
  page.body.innerHTML = '<select id="target-speech-speed"><option value="0.85" selected>0.85</option></select>'
  utterances = []
  voices = [{ localService: true, lang: 'zh-CN' }]
  const speech = Object.assign(new EventTarget(), {
    getVoices: () => voices,
    cancel: vi.fn(),
    speak: (utterance: PreviewUtterance) => {
      utterances.push(utterance)
      utterance.onstart?.()
    },
  })
  const windowFixture = Object.assign(new EventTarget(), {
    speechSynthesis: speech, SpeechSynthesisUtterance: PreviewUtterance,
  })
  class ObserverFixture { observe() {} }
  api = new Function('document', 'window', 'SpeechSynthesisUtterance', 'MutationObserver',
    `${script}\nreturn { snippetButton, playSnippet, stopSnippetSpeech };`)(
    page, windowFixture, PreviewUtterance, ObserverFixture,
  )
})

describe('exercise playback through the shared speech helper', () => {
  it('uses slow playback without exposing an audio-only answer in status or labels', async () => {
    const button = api.snippetButton('speaker', 'Play slowly')
    page.body.append(button)
    await api.playSnippet({ text: '我也喝茶。', lang: 'zh-CN', rate: 0.65, concealText: true }, button)
    expect(utterances[0].rate).toBe(0.65)
    expect(utterances[0].text).toBe('我也喝茶。')
    expect(page.querySelector('.snippet-player-status')?.textContent).toContain('transcript hidden')
    expect(page.body.textContent).not.toContain('我也喝茶')
    expect(button.getAttribute('aria-label')).not.toContain('我也喝茶')
    api.stopSnippetSpeech(false)
    expect(button.getAttribute('aria-label')).toBe('Play slowly')
  })

  it('preserves the configured rate and visible description for existing callers', async () => {
    const button = api.snippetButton('speaker', 'Hear 茶')
    page.body.append(button)
    await api.playSnippet({ text: '茶', lang: 'zh-CN' }, button)
    expect(utterances[0].rate).toBe(0.85)
    expect(page.querySelector('.snippet-player-status')?.textContent).toContain('茶')
    api.stopSnippetSpeech(false)
  })

  it('does not use a remote voice when local speech is unavailable', async () => {
    voices = [{ localService: false, lang: 'zh-CN' }]
    const button = api.snippetButton('speaker', 'Play audio')
    await api.playSnippet({ text: '茶', lang: 'zh-CN', concealText: true }, button)
    expect(utterances).toHaveLength(0)
    expect(page.querySelector('.snippet-player-status')?.textContent).toContain('Remote voices are not used')
  })
})
