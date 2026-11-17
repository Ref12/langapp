import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withAutoCompletedSpeechPreparation } from '../test/mock-speech-preparation'
import { getPlaybackState, playBrowserSpeech, setDefaultSpeechRate, stopBrowserSpeech } from '../core/assistant/speech'
import { getPack, spokenText } from '../core/language'
import { PlaybackStatus } from './assistant/SnippetActions'
import { PlayButton } from './PlayButton'
import { SentenceAudio } from '../pages/drills/SentenceAudio'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}

let synthesis: EventTarget & { getVoices: () => SpeechSynthesisVoice[]; speak: ReturnType<typeof vi.fn<(utterance: Utterance) => void>>; cancel: ReturnType<typeof vi.fn> }

beforeEach(() => {
  synthesis = Object.assign(new EventTarget(), { getVoices: () => [] as SpeechSynthesisVoice[], speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  stopBrowserSpeech()
  setDefaultSpeechRate()
})
afterEach(() => { cleanup(); stopBrowserSpeech(); setDefaultSpeechRate(); vi.unstubAllGlobals() })

const word = '\u8336'

describe('the button that plays becomes Stop', () => {
  it('renders no playback pill while speech plays, and only shows one with debug messages on', async () => {
    const view = render(<><PlayButton text={word} kind="word" /><PlaybackStatus /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Play the word' }))
    await waitFor(() => expect(getPlaybackState().activeId).toBeDefined())
    expect(document.querySelector('.playback-status')).toBeNull()
    view.rerender(<><PlayButton text={word} kind="word" /><PlaybackStatus debug /></>)
    await waitFor(() => expect(document.querySelector('.playback-status')).not.toBeNull())
  })

  it('PlayButton shows Stop while its own id plays, and tapping stops playback', async () => {
    render(<PlayButton text={word} kind="word" />)
    fireEvent.click(screen.getByRole('button', { name: 'Play the word' }))
    const stop = await screen.findByRole('button', { name: 'Stop playback' })
    fireEvent.click(stop)
    await waitFor(() => expect(getPlaybackState()).toEqual({}))
    expect(await screen.findByRole('button', { name: 'Play the word' })).toBeInTheDocument()
  })

  it('SentenceAudio shows Stop while its audio plays, and tapping stops playback', async () => {
    render(<SentenceAudio text={word} kind="word" autoPlay />)
    const stop = await screen.findByRole('button', { name: 'Stop playback' })
    fireEvent.click(stop)
    await waitFor(() => expect(getPlaybackState()).toEqual({}))
    expect(await screen.findByRole('button', { name: 'Play the word' })).toBeInTheDocument()
  })

  it('automatic speech of a prompt makes the play button for the same text show Stop', async () => {
    render(<><PlayButton text={word} kind="word" /><PlayButton text={'\u4f60\u597d'} kind="word" /></>)
    act(() => playBrowserSpeech('prompt-auto-play', spokenText(getPack().speechLocale, word, { kind: 'word' }), getPack().speechLocale))
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Stop playback' })).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: 'Play the word' })).toHaveLength(1)
    act(() => stopBrowserSpeech())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop playback' })).not.toBeInTheDocument())
  })

  it('shows a playback error next to the button that started it, and clears it on the next play', async () => {
    render(<><PlayButton text={word} kind="word" /><PlayButton text={'\u4f60\u597d'} kind="word" /></>)
    const [first, second] = screen.getAllByRole('button', { name: 'Play the word' })
    fireEvent.click(first)
    act(() => synthesis.speak.mock.calls[0][0].onerror?.())
    const alert = await screen.findByRole('alert')
    expect(first.nextElementSibling).toBe(alert)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    fireEvent.click(second)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
