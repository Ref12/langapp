import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlaybackState, setDefaultSpeechRate, stopBrowserSpeech } from '../../core/assistant/speech'
import { HearButton, PlaybackStatus, SnippetActions } from './SnippetActions'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}

const mandarin: SpeechSynthesisVoice = { name: 'Local Mandarin', lang: 'zh-CN', localService: true, default: false, voiceURI: 'local-zh' }
let voices: SpeechSynthesisVoice[]
let synthesis: EventTarget & { getVoices: () => SpeechSynthesisVoice[]; speak: ReturnType<typeof vi.fn<(utterance: Utterance) => void>>; cancel: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  voices = []
  synthesis = Object.assign(new EventTarget(), {
    getVoices: () => voices, speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
  })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', synthesis)
  stopBrowserSpeech()
  setDefaultSpeechRate()
})
afterEach(() => { cleanup(); stopBrowserSpeech(); setDefaultSpeechRate(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('browser speech controls', () => {
  it('uses the configured Mandarin default through both controls, preserving explicit rates and normal English', () => {
    setDefaultSpeechRate(0.5)
    voices = [mandarin, { ...mandarin, name: 'Local English', lang: 'en-US', voiceURI: 'local-en' }]
    render(<>
      <HearButton text={'\u8336'} locale="zh-Hans" />
      <SnippetActions source={{ text: '\u8336', locale: 'zh-Hans', title: 'Tea', route: 'dictionary' }} />
      <HearButton text={'\u8336'} locale="zh-Hans" rate={1.25} />
      <HearButton text="tea" locale="en-US" />
    </>)
    for (const [index, rate] of [0.5, 0.5, 1.25, 1].entries()) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Hear' })[index])
      expect(synthesis.speak.mock.calls[index][0].rate).toBe(rate)
      act(() => synthesis.speak.mock.calls[index][0].onend?.())
    }
  })

  it('labels discovery, startup, and speaking separately and stops on Escape', () => {
    voices = [{ ...mandarin, localService: false }]
    render(<><HearButton text={'\u8336'} locale="zh-Hans" /><PlaybackStatus /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
    expect(screen.getByRole('status')).toHaveTextContent('Looking for a voice')
    expect(screen.getByRole('button', { name: 'Cancel voice discovery' })).toBeEnabled()
    act(() => { voices = [mandarin]; synthesis.dispatchEvent(new Event('voiceschanged')) })
    expect(screen.getByRole('status')).toHaveTextContent('Starting local speech')
    act(() => synthesis.speak.mock.calls[0][0].onstart?.())
    expect(screen.getByRole('status')).toHaveTextContent('Playing with an installed local voice')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(getPlaybackState()).toEqual({})
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels discovery when its Hear control unmounts', () => {
    voices = [{ ...mandarin, localService: false }]
    const view = render(<HearButton text={'\u8336'} locale="zh-Hans" />)
    fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
    view.unmount()
    act(() => { voices = [mandarin]; synthesis.dispatchEvent(new Event('voiceschanged')); vi.advanceTimersByTime(5000) })
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(getPlaybackState()).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discloses online fallback when the browser has only a remote Mandarin voice', () => {
    voices = [{ ...mandarin, localService: false }]
    render(<><HearButton text={'\u8336'} locale="zh-Hans" /><PlaybackStatus /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByRole('status')).toHaveTextContent('Starting online speech')
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    act(() => synthesis.speak.mock.calls[0][0].onstart?.())
    expect(screen.getByRole('status')).toHaveTextContent('Playing with an online browser voice')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('plays synchronously with an unlisted system voice, discloses its unknown provider, and stops on Escape', () => {
    render(<><HearButton text={'\u8336'} locale="zh-Hans" /><PlaybackStatus /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(synthesis.speak.mock.calls[0][0].voice).toBeUndefined()
    expect(synthesis.speak.mock.calls[0][0].lang).toBe('zh-CN')
    expect(screen.getByRole('status')).toHaveTextContent('Starting system-selected speech (may be online)')
    act(() => synthesis.speak.mock.calls[0][0].onstart?.())
    expect(screen.getByRole('status')).toHaveTextContent('Playing with a system-selected voice (may be online)')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(getPlaybackState()).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports an actual system playback error and lets the learner dismiss it', () => {
    render(<><HearButton text={'\u8336'} locale="zh-Hans" /><PlaybackStatus /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
    act(() => synthesis.speak.mock.calls[0][0].onerror?.())
    expect(screen.getByRole('alert')).toHaveTextContent('System speech could not be played')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss playback error' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reuses a discovered online voice across Hear controls without another discovery wait', () => {
    voices = [{ ...mandarin, localService: false }]
    render(<><HearButton text={'\u8336'} locale="zh-Hans" /><HearButton text={'\u4f60\u597d'} locale="zh-Hans" /><PlaybackStatus /></>)
    fireEvent.click(screen.getAllByRole('button', { name: 'Hear' })[0])
    act(() => vi.advanceTimersByTime(3000))
    act(() => {
      synthesis.speak.mock.calls[0][0].onstart?.()
      synthesis.speak.mock.calls[0][0].onend?.()
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Hear' })[1])
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(synthesis.speak.mock.calls[1][0].text).toBe('\u4f60\u597d')
    expect(screen.getByRole('status')).toHaveTextContent('Starting online speech')
    expect(screen.queryByText('Looking for a voice...')).not.toBeInTheDocument()
  })
})
