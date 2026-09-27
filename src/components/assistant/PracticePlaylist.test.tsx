import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withAutoCompletedSpeechPreparation } from '../../test/mock-speech-preparation'
import { PracticePlaylist } from './PracticePlaylist'
import { clearVoiceCache, setSpeechVoicePreferences, stopBrowserSpeech } from '../../core/assistant/speech'
import { interruptAudio } from '../../core/assistant/audio-owner'
import type { PracticePlaylistItem } from '../../core/assistant/practice-chain-contracts'

const phrase = { type: 'speech', text: '\u6211\u60f3\u660e\u5929\u65e9\u4e0a\u53bb\u516c\u56ed\u8dd1\u6b65\u3002', locale: 'zh-Hans', meaning: 'I want to go jogging in the park tomorrow morning.' } as const
const originalEnds = [2, 6, 9, 12]
class Utterance {
  voice?: SpeechSynthesisVoice
  lang = ''; rate = 1
  volume = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
  constructor(public text: string) {}
}
const synthesis = Object.assign(new EventTarget(), {
  getVoices: () => [],
  speak: vi.fn<(utterance: Utterance) => void>(),
  cancel: vi.fn(),
})
const save = vi.fn<(ends: number[], items?: PracticePlaylistItem[]) => Promise<void>>()
const closed = vi.fn<() => Promise<void>>()

function Harness() {
  const [open, setOpen] = useState(false)
  const [ends, setEnds] = useState(originalEnds)
  const [items, setItems] = useState<PracticePlaylistItem[]>()
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open practice</button>
    {open && <PracticePlaylist phrase={phrase} rate={0.25} savedEnds={ends} savedItems={items} busy={false} recordingActive={false}
      onSave={async (next, nextItems) => {
        if (nextItems) await save(next, nextItems)
        else await save(next)
        setEnds(next); setItems(nextItems)
      }}
      onClose={async () => { await closed(); setOpen(false) }} />}
  </>
}
async function open() {
  const button = screen.getByRole('button', { name: 'Open practice' })
  button.focus()
  fireEvent.click(button)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit playlist' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Edit playlist' }))
  await screen.findByRole('list', { name: 'Phrase playlist' })
  return screen.getByRole('dialog', { name: 'Phrase practice' })
}
async function end() {
  await act(async () => synthesis.speak.mock.calls[synthesis.speak.mock.calls.length - 1][0].onend?.())
}

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('fetch', vi.fn())
  synthesis.speak.mockReset()
  synthesis.cancel.mockReset()
  save.mockReset().mockResolvedValue()
  closed.mockReset().mockResolvedValue()
  setSpeechVoicePreferences()
  clearVoiceCache()
  stopBrowserSpeech()
})
afterEach(async () => {
  try {
    cleanup()
    interruptAudio()
    stopBrowserSpeech()
    if (vi.isFakeTimers()) {
      // Focus restoration queues jsdom's selectionchange notification.
      await vi.runOnlyPendingTimersAsync()
      expect(vi.getTimerCount()).toBe(0)
    }
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

describe('compact practice modes', () => {
  async function fresh() {
    render(<PracticePlaylist phrase={{ type: 'speech', locale: 'zh-Hans', text: '我很累。', meaning: "I'm very tired." }}
      rate={0.75} busy={false} recordingActive={false} onSave={save} onClose={closed} />)
    return screen.findByRole('region', { name: 'Current practice step' })
  }

  it('defaults new phrases to word-by-word and keeps prose, editing and options out of the active view', async () => {
    const step = await fresh()
    expect(screen.getByRole('button', { name: 'Word by word' })).toHaveAttribute('aria-pressed', 'true')
    expect(step.querySelector('.practice-current [lang="zh-Hans"]')).toHaveTextContent('我')
    expect(screen.getByRole('button', { name: 'Loop On' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Auto-ramp Off' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('list', { name: 'Phrase playlist' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Practice options' })).not.toBeInTheDocument()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.lastCall![0]).toMatchObject({ text: '我', rate: 0.75 })
  })

  it('annotates the top word selectors only when the practice pinyin setting is enabled', async () => {
    const step = await fresh()
    const strip = within(step).getByRole('group', { name: 'Words in the phrase' })
    expect(Array.from(strip.querySelectorAll('.practice-word-pinyin'), node => node.textContent)).toEqual(['wǒ', 'hěn', 'lèi。'])
    expect(strip.querySelector('.practice-word-pinyin')?.previousElementSibling).toHaveTextContent('我')
    fireEvent.click(within(strip).getAllByRole('button')[1])
    expect(strip.querySelectorAll('button')[1]).toHaveAttribute('aria-pressed', 'true')
    expect(synthesis.speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Practice options' }))
    fireEvent.click(screen.getByLabelText('Pinyin'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(document.querySelector('.practice-phrase-strip .practice-word-pinyin')).not.toBeInTheDocument()
    expect(document.querySelector('.practice-current [lang="zh-Latn"]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Practice options' }))
    fireEvent.click(screen.getByLabelText('Pinyin'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(document.querySelectorAll('.practice-phrase-strip .practice-word-pinyin')).toHaveLength(3)
    expect(document.querySelector('.practice-current [lang="zh-Latn"]')).toHaveTextContent('hěn')
  })

  it('allows zero manual pauses and a zero Auto-ramp floor without changing the current pause', async () => {
    await fresh()
    fireEvent.click(screen.getByRole('button', { name: 'Practice options' }))
    fireEvent.change(screen.getByLabelText('Shortest pause'), { target: { value: '0' } })
    expect(screen.getByLabelText('Shortest pause')).toHaveValue('0')
    expect(screen.getByLabelText('Repetition pause')).toHaveValue('1.5')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Shorter repeat pause' }))
    expect(screen.getByLabelText('Repetition pause')).toHaveValue('0')
    expect(screen.getByRole('button', { name: 'Shorter repeat pause' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Longer repeat pause' }))
    expect(screen.getByLabelText('Repetition pause')).toHaveValue('0.25')
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('switches all four modes silently and remembers independent response pauses', async () => {
    await fresh()
    fireEvent.click(screen.getByRole('button', { name: 'Shorter repeat pause' }))
    expect(screen.getByLabelText('Repetition pause')).toHaveValue('1.25')
    for (const [label, expected, gap] of [['Whole phrase', '我很累。', '4'], ['Build from end', '累。', '3'], ['Build from start', '我', '3'], ['Word by word', '我', '1.25']]) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(document.querySelector('.practice-current [lang="zh-Hans"]')).toHaveTextContent(expected)
      expect(screen.getByLabelText('Repetition pause')).toHaveValue(gap)
    }
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('updates speed without interrupting speech and shows automatic changes after a complete loop', async () => {
    await fresh()
    fireEvent.change(screen.getByLabelText('Repetition pause'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Auto-ramp Off' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    synthesis.cancel.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Faster speech' }))
    expect(synthesis.cancel).not.toHaveBeenCalled()
    expect(synthesis.speak.mock.lastCall![0].rate).toBe(0.75)
    for (let i = 0; i < 3; i++) {
      await end()
      expect(screen.getByRole('status')).toHaveTextContent('Your turn')
      await act(async () => vi.advanceTimersByTimeAsync(500))
    }
    expect(synthesis.speak.mock.calls.map(([call]) => [call.text, call.rate])).toEqual([
      ['我', 0.75], ['很', 0.8], ['累。', 0.8], ['我', 0.85],
    ])
    expect(screen.getByLabelText('Practice speed')).toHaveValue('0.85')
    expect(screen.getByText('Round 2')).toBeVisible()
  })

  it('opens the chunk editor without dropping stored build tracks and restores focus when done', async () => {
    await fresh()
    fireEvent.click(screen.getByRole('button', { name: 'Edit playlist' }))
    expect(screen.getByRole('list', { name: 'Phrase playlist' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Build from end' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }))
    expect(screen.getByRole('button', { name: 'Edit playlist' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Practice options' }))
    fireEvent.click(screen.getByLabelText('Pinyin'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(document.querySelector('.practice-current [lang="zh-Latn"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Practice options' })).toHaveFocus()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('phrase playlist popup', () => {
  it('waits for the actual phrase, not muted preparation, before the guided response gap', async () => {
    vi.stubGlobal('speechSynthesis', synthesis)
    render(<Harness />)
    await open()
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'guided' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    const [preparation, target] = synthesis.speak.mock.calls.map(([utterance]) => utterance)
    expect(preparation).toMatchObject({ volume: 0, rate: 1, lang: 'zh-CN' })
    expect(target).toMatchObject({ volume: 1, rate: 0.25, text: '\u8dd1\u6b65\u3002' })
    await act(async () => { preparation.onstart?.(); preparation.onend?.() })
    expect(screen.getByRole('status')).toHaveTextContent('Listen')
    expect(screen.getByRole('button', { name: /^Play step 1:/ })).toHaveAttribute('aria-current', 'step')
    await act(async () => { target.onstart?.(); target.onend?.() })
    expect(screen.getByRole('status')).toHaveTextContent('Your turn')
    fireEvent.click(screen.getByRole('button', { name: 'Pause practice' }))
  })

  it('cancels both queued utterances when paused during muted preparation', async () => {
    vi.stubGlobal('speechSynthesis', synthesis)
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    const [preparation, target] = synthesis.speak.mock.calls.map(([utterance]) => utterance)
    const latePreparationEnd = preparation.onend
    const lateTargetEnd = target.onend
    synthesis.cancel.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Pause practice' }))
    await act(async () => { latePreparationEnd?.(); lateTargetEnd?.() })
    expect(synthesis.cancel).toHaveBeenCalledOnce()
    expect(preparation.onend).toBeNull()
    expect(target.onend).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Paused')
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('stays open in Strict Mode when native close events arrive after the dialog reopens', async () => {
    const openWhenNotified: boolean[] = []
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
      if (!this.open) return
      this.removeAttribute('open')
      // Native dialogs queue this event instead of dispatching it inside close().
      queueMicrotask(() => {
        openWhenNotified.push(this.open)
        this.dispatchEvent(new Event('close'))
      })
    })
    render(<StrictMode><Harness /></StrictMode>)
    const popup = await open()
    await act(async () => {})
    expect(openWhenNotified).toContain(true)
    expect(popup).toHaveAttribute('open')
    expect(closed).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.calls[1][0].text).toBe('\u53bb\u516c\u56ed\u8dd1\u6b65\u3002')
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await open()
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
    expect(closed).toHaveBeenCalledOnce()
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it('opens silently with Hanzi and aligned pinyin on every backward track, regardless of an outer romanization toggle', async () => {
    render(<Harness />)
    const popup = await open()
    const rows = within(screen.getByRole('list', { name: 'Phrase playlist' })).getAllByRole('button', { name: /^Play step/ })
    expect(rows).toHaveLength(4)
    expect(rows.map(row => row.querySelector('[lang="zh-Hans"]')?.textContent)).toEqual([
      '\u8dd1\u6b65\u3002', '\u53bb\u516c\u56ed\u8dd1\u6b65\u3002',
      '\u660e\u5929\u65e9\u4e0a\u53bb\u516c\u56ed\u8dd1\u6b65\u3002', phrase.text,
    ])
    for (const row of rows) expect(row.querySelector('[lang="zh-Latn"]')?.textContent).toContain('pǎo')
    expect(rows[0]).toHaveAttribute('aria-current', 'step')
    expect(within(popup).getByLabelText('Pacing')).toHaveValue('self-paced')
    expect(within(popup).getByLabelText('Practice speed')).toHaveValue('0.25')
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('plays synchronously at quarter speed and navigates silently without advancing after a self-paced model', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ text: '\u8dd1\u6b65\u3002', lang: 'zh-CN', rate: 0.25 })
    await end()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.calls[1][0].text).toBe('\u53bb\u516c\u56ed\u8dd1\u6b65\u3002')
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.calls[2][0].text).toBe('\u8dd1\u6b65\u3002')
    fireEvent.click(screen.getByRole('button', { name: /^Play step 4:/ }))
    expect(synthesis.speak.mock.calls[3][0].text).toBe(phrase.text)
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()
  })

  it('rebuilds forward tracks and changes speed without automatically speaking', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Build from start' }))
    fireEvent.change(screen.getByLabelText('Practice speed'), { target: { value: '0.5' } })
    expect(synthesis.speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ text: '\u6211\u60f3', rate: 0.5 })
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.calls[1][0].text).toBe('\u6211\u60f3\u660e\u5929\u65e9\u4e0a')
  })

  it('starts Guided response pauses after real playback ends and cancels the gap on pause', async () => {
    render(<Harness />)
    await open()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'guided' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    act(() => synthesis.speak.mock.calls[0][0].onstart?.())
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    await end()
    await act(async () => vi.advanceTimersByTimeAsync(2999))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    await end()
    fireEvent.click(screen.getByRole('button', { name: 'Pause practice' }))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it.each(['close', 'escape', 'backdrop', 'navigation', 'hidden'])('stops playback on %s and does not restart from late events', async reason => {
    render(<Harness />)
    const popup = await open()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'guided' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    const late = synthesis.speak.mock.calls[0][0].onend
    if (reason === 'close') fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    if (reason === 'escape') fireEvent.keyDown(popup, { key: 'Escape' })
    if (reason === 'backdrop') fireEvent.click(popup, { clientX: -1, clientY: -1 })
    if (reason === 'navigation') fireEvent(window, new HashChangeEvent('hashchange'))
    if (reason === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    }
    await act(async () => { late?.(); await vi.advanceTimersByTimeAsync(60_000) })
    expect(closed).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('button', { name: 'Open practice' })).toHaveFocus()
  })

  it('splits and merges aligned chunks, saves only on request and reuses the result after reopening', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Edit chunks' }))
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 2:/ }))
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 2:/ }))
    expect(screen.getByRole('button', { name: 'Save chunks' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 2:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save chunks' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith([6, 9, 12]))
    await screen.findByRole('list', { name: 'Phrase playlist' })
    expect(within(screen.getByRole('list', { name: 'Phrase playlist' })).getAllByRole('button', { name: /^Play step/ })).toHaveLength(3)
    expect(synthesis.speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await open()
    expect(within(screen.getByRole('list', { name: 'Phrase playlist' })).getAllByRole('button', { name: /^Play step/ })).toHaveLength(3)
  })

  it('retains edits and the original saved playlist when saving fails', async () => {
    save.mockRejectedValueOnce(new Error('Storage full'))
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Edit chunks' }))
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 2:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save chunks' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chunks not saved. Storage full')
    expect(screen.getByRole('region', { name: 'Edit phrase chunks' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }))
    expect(within(screen.getByRole('list', { name: 'Phrase playlist' })).getAllByRole('button', { name: /^Play step/ })).toHaveLength(4)
  })

  it('keeps the popup open when pending-feedback protection rejects closing', async () => {
    closed.mockRejectedValueOnce(new Error('Save your pending feedback before closing practice.'))
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save your pending feedback before closing practice.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps a native cancellation failure visible and allows another stop attempt', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    synthesis.cancel.mockImplementationOnce(() => { throw new Error('Device busy') })
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(closed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('can close before local preparation finishes without starting late audio', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open practice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('does not display a new direction when changing configuration cannot stop native speech', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    synthesis.cancel.mockImplementationOnce(() => { throw new Error('Device busy') })
    fireEvent.click(screen.getByRole('button', { name: 'Build from start' }))
    expect(screen.getByRole('button', { name: 'Build from end' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    expect(synthesis.speak.mock.calls[1][0].text).toBe('\u8dd1\u6b65\u3002')
  })

  it('stops guided playback when unmounted during a response gap', async () => {
    const view = render(<Harness />)
    await open()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Pacing'), { target: { value: 'guided' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play practice' }))
    await end()
    view.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('inserts a partial phrase at the current playing index, moves rows, and restores the saved order', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Play step 3:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 3:/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 6:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' }))
    const selection = { kind: 'selection', start: 2, end: 6 }
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(originalEnds, [
      { kind: 'chain', step: 0 }, { kind: 'chain', step: 1 }, selection, { kind: 'chain', step: 2 }, { kind: 'chain', step: 3 },
    ]))
    expect(screen.getByRole('button', { name: /^Play step 3:/ })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: /^Play step 3:/ })).toHaveTextContent('\u660e\u5929\u65e9\u4e0a')
    expect(synthesis.speak).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Play step 2:/ })).toHaveAttribute('aria-current', 'step'))
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Play step 1:/ })).toHaveAttribute('aria-current', 'step'))
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await open()
    expect(screen.getByRole('button', { name: /^Play step 1:/ })).toHaveTextContent('Selected part')
    fireEvent.click(screen.getByRole('button', { name: 'Build from start' }))
    expect(screen.getByRole('button', { name: /^Play step 1:/ })).toHaveTextContent('\u660e\u5929\u65e9\u4e0a')
    expect(screen.getByRole('button', { name: /^Play step 2:/ })).toHaveTextContent('\u6211\u60f3')
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove step 1' })).not.toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /^Play step/ })).toHaveLength(4)
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('retains a selected range after a failed addition and does not apply failed moves', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 3:/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 4:/ }))
    save.mockRejectedValueOnce(new Error('Storage full'))
    fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Playlist not saved. Storage full')
    expect(screen.getAllByRole('button', { name: /^Play step/ })).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Add selection to playlist' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Play step/ })).toHaveLength(5))
    save.mockRejectedValueOnce(new Error('Storage full'))
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Playlist not saved. Storage full')
    expect(screen.getByRole('button', { name: /^Play step 1:/ })).toHaveTextContent('Selected part')
  })
})
