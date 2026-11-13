import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetCatalogCache } from '../core/study/catalog'
import * as play from '../core/tone-trainer/play'
import { answerWith, curveManifest, openStage, setUpTrainer } from './test/toneTrainerFixtures'

beforeEach(async () => { await setUpTrainer(curveManifest()) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the pitch chart', () => {
  it('appears after the answer is checked, not before, with a text alternative and the text feedback', async () => {
    const user = await openStage(2)
    expect(document.querySelector('.tt-chart')).toBeNull()
    await answerWith(user, [1])
    const chart = await screen.findByRole('img', { name: 'Pitch stays high.' })
    expect(chart).toHaveClass('tt-chart')
    expect(screen.getByText(/Tone 1: high and flat\./)).toBeInTheDocument()
    expect(chart.querySelectorAll('.tt-shape')).toHaveLength(4)
    expect(chart.querySelector('.tt-line')).toHaveAttribute('stroke', 'var(--tone-1)')
  })
  it('shows a pair as two segments, with a break where the voice is unvoiced', async () => {
    const user = await openStage(3)
    await answerWith(user, [1, 4])
    const chart = await screen.findByRole('img', { name: 'First syllable: Pitch stays high. Second syllable: Pitch falls from high to low.' })
    const lines = chart.querySelectorAll('.tt-line')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveAttribute('stroke', 'var(--tone-1)')
    expect(lines[1]).toHaveAttribute('stroke', 'var(--tone-4)')
    expect((lines[1].getAttribute('d')!.match(/M/g) ?? []).length).toBe(2)   // the gap is a second stroke, not a line across it
  })
  it('after a miss shows the right and the picked curve; the one that is playing is highlighted and the other dimmed, switching with the clips', async () => {
    const user = await openStage(2)
    const ends: (() => void)[] = []
    vi.mocked(play.playClip).mockImplementation(() => new Promise<void>(resolve => { ends.push(resolve) }))
    await answerWith(user, [2])
    await waitFor(() => expect(ends).toHaveLength(1))
    const state = (series: string) => document.querySelector('.tt-line[data-series="' + series + '"]')!.getAttribute('data-state')
    expect(screen.getByRole('img', { name: /You heard: Pitch stays high\. You picked: Pitch rises from low to high\./ })).toBeInTheDocument()
    expect([state('heard'), state('picked')]).toEqual(['playing', 'dimmed'])
    ends[0]()
    await waitFor(() => expect([state('heard'), state('picked')]).toEqual(['dimmed', 'playing']))
    expect(vi.mocked(play.playClip).mock.calls.map(call => call[0])).toEqual(['xiaoxiao/s-ba1.mp3', 'xiaoxiao/s-ba2.mp3'])
    ends[1]()
    await waitFor(() => expect([state('heard'), state('picked')]).toEqual(['idle', 'idle']))
    // Again on request.
    await user.click(await screen.findByRole('button', { name: /Hear both again/ }))
    await waitFor(() => expect(ends).toHaveLength(3))
    expect([state('heard'), state('picked')]).toEqual(['playing', 'dimmed'])
    ends[2](); await waitFor(() => expect(ends).toHaveLength(4)); ends[3]()
    await waitFor(() => expect(screen.getByRole('button', { name: /Hear both again/ })).toBeEnabled())
  })
})

describe('the X', () => {
  it('stops the round and goes back to Practice', async () => {
    const user = await openStage(2)
    expect(screen.queryByText('Back to Practice')).toBeNull()
    expect(screen.queryByText('Hear the tones')).toBeNull()
    expect(screen.getByText(/Question 1 of 20/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close the tone trainer' }))
    await waitFor(() => expect(window.location.hash).toBe('#practice'))
    await waitFor(() => expect(screen.queryByText(/Question 1 of 20/)).toBeNull())
  })
  it('is on the stage picker too, which keeps a short title', async () => {
    window.location.hash = '#practice/tones'
    const { render } = await import('@testing-library/react')
    const { default: App } = await import('../App')
    render(<App />)
    const picker = (await screen.findByRole('heading', { name: 'Pick a stage' })).closest('section')!
    fireEvent.click(within(picker).getByRole('button', { name: 'Close the tone trainer' }))
    await waitFor(() => expect(window.location.hash).toBe('#practice'))
  })
})

describe('the speed setting', () => {
  it('reaches the first playback and "Hear both again" as the playback rate', async () => {
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    await setUpTrainer(curveManifest(), { defaultSpeechRate: 0.75 })
    const user = await openStage(2)   // openStage clears the first call: look at the next ones
    await user.click(screen.getByRole('button', { name: 'Play the sound again' }))
    await waitFor(() => expect(play.playClip).toHaveBeenCalledWith('xiaoxiao/s-ba1.mp3', undefined, 0.75))
    vi.mocked(play.playClip).mockClear()
    await answerWith(user, [2])
    await waitFor(() => expect(play.playClip).toHaveBeenCalledTimes(2))
    expect(vi.mocked(play.playClip).mock.calls.map(call => call[2])).toEqual([0.75, 0.75])
    vi.mocked(play.playClip).mockClear()
    await user.click(await screen.findByRole('button', { name: /Hear both again/ }))
    await waitFor(() => expect(play.playClip).toHaveBeenCalledTimes(2))
    expect(vi.mocked(play.playClip).mock.calls.map(call => call[2])).toEqual([0.75, 0.75])
  })
  it('plays at 1x when the setting was never changed', async () => {
    const user = await openStage(2)
    await user.click(screen.getByRole('button', { name: 'Play the sound again' }))
    await waitFor(() => expect(play.playClip).toHaveBeenCalledWith('xiaoxiao/s-ba1.mp3', undefined, 1))
  })
})
