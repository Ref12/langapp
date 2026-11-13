import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetCatalogCache } from '../core/study/catalog'
import { calibrate } from '../core/tone-trainer/calibration'
import * as recorder from '../core/tone-trainer/recorder'
import { MicError } from '../core/tone-trainer/recorder'
import { fourTones, join, RATE, silence, syllable } from '../core/tone-trainer/synth'
import { curveManifest, setUpTrainer } from './test/toneTrainerFixtures'

const RANGE = calibrate(fourTones(120, 240), RATE)!
const said = (...hz: number[]) => join(syllable(...hz), silence(0.3))
const TONE1 = said(225, 225), TONE2 = said(150, 230), TONE3 = said(135, 120, 125)
/** A mocked microphone: each call of record gives the next recording at once. */
function mockMic(...recordings: Float32Array[]) {
  const queue = [...recordings]
  return vi.spyOn(recorder, 'recordSpeech').mockImplementation(async () => ({ done: Promise.resolve({ pcm: queue.shift() ?? silence(1), sampleRate: RATE }), stop: () => {} }))
}

beforeEach(async () => { await setUpTrainer(curveManifest()) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined); resetCatalogCache() })

/** Opens Say the tone stage 1 (the first item is ba1, tone 1, with Math.random at 0), with the learner's range kept, or not. */
async function openSpeak(options: { range?: boolean; stage?: 1 | 2 } = {}) {
  const { range = true, stage = 1 } = options
  const answers = Array.from({ length: 40 }, (_, i) => ({ stage: 1 as const, item: 's-ba1', voice: 'xiaoxiao', expected: [1], heard: [1], correct: true, at: i }))
  await db.toneTrainer.put({ id: 'progress', stage: 1, confusion: {}, voices: {}, answers: [], speaking: { answers: stage === 2 ? answers : [], ...(range ? { range: RANGE, rangeAt: 1 } : {}) } })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const user = userEvent.setup()
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Say the tone ' + stage })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Start Say the tone ' + stage }))
  return user
}
const card = () => document.querySelector('.tt-card') as HTMLElement
const recordButton = () => card().querySelector('.tt-record') as HTMLButtonElement
const saved = async () => (await db.toneTrainer.get('progress'))?.speaking

describe('Say the tone on the stage picker', () => {
  it('lists two stages beside the listening ones, the second locked, and a Recalibrate button', async () => {
    await db.toneTrainer.put({ id: 'progress', stage: 1, confusion: {}, voices: {}, answers: [] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Say the tone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Say the tone 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start Say the tone 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start stage 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Recalibrate' })).toBeInTheDocument()
  })
})

describe('a Say the tone item', () => {
  it('plays the model once, shows the word and pinyin, then record, judge, feedback, Try again keeps the item and the first attempt counts, Next moves on', async () => {
    const play = await import('../core/tone-trainer/play')
    const mic = mockMic(TONE3, TONE1)
    const user = await openSpeak()
    await screen.findByText(/Say the tone 1 of 10/)
    await waitFor(() => expect(play.playClip).toHaveBeenCalledTimes(1))
    expect(card().querySelector('.tt-speak-word')).toHaveTextContent('巴'); expect(card()).toHaveTextContent('bā')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(recordButton())
    await screen.findByText('Heard tone 3, expected tone 1')
    expect(mic).toHaveBeenCalledWith(expect.objectContaining({ mode: 'speech' }))
    expect(screen.getByText('Keep it high and steady.')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelectorAll('.tt-chart .tt-line')).toHaveLength(2))
    expect(card().querySelector('.tt-legend')).toHaveTextContent('Model'); expect(card().querySelector('.tt-legend')).toHaveTextContent('You')
    expect(recordButton()).toHaveTextContent('Try again')
    await waitFor(async () => expect((await saved())?.answers).toHaveLength(1))
    expect((await saved())!.answers[0]).toMatchObject({ item: 's-ba1', expected: [1], heard: [3], correct: false })
    await user.click(recordButton())
    await screen.findByText('Heard tone 1 ✓')
    expect(card().querySelector('.tt-speak-word')).toHaveTextContent('巴')   // the same item
    expect((await saved())!.answers).toHaveLength(1)                           // the retry is not counted
    expect(play.playClip).toHaveBeenCalledTimes(1)                            // the model does not replay by itself
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/Say the tone 2 of 10/)
    expect(card().querySelector('.tt-chart')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('the Record button and the Stop / Next row stay where they were when the attempt is judged, and the feedback opens below them', async () => {
    mockMic(TONE1)
    const user = await openSpeak()
    await screen.findByText(/Say the tone 1 of 10/)
    const actions = card().querySelector('.answer-actions')!, button = recordButton()
    const above = () => { const out: string[] = []; for (let n = actions.previousElementSibling; n; n = n.previousElementSibling) out.push(n.tagName + '.' + n.className); return out }
    const before = above()
    expect(card().querySelector('.tt-chart, .answer-feedback')).toBeNull()
    await user.click(button)
    await screen.findByText('Heard tone 1 ✓')
    expect(card().querySelector('.answer-actions')).toBe(actions); expect(recordButton()).toBe(button)
    expect(above()).toEqual(before)
    for (const part of Array.from(card().querySelectorAll('.answer-feedback, .tt-chart'))) expect(actions.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(actions as HTMLElement).getAllByRole('button').map(b => b.textContent)).toEqual([' Stop', 'Next'])
  })

  it('a pair: each syllable is judged', async () => {
    mockMic(join(syllable(225, 225), syllable(235, 125), silence(0.3)))
    const user = await openSpeak({ stage: 2 })
    await screen.findByText(/Say the tone 1 of 10/)
    await user.click(recordButton())
    await screen.findByText('First syllable: Heard tone 1 ✓')
    expect(screen.getByText('Second syllable: Heard tone 4 ✓')).toBeInTheDocument()
    expect(document.querySelectorAll('.tt-chart .tt-line')).toHaveLength(4)
  })

  it('a refused microphone shows a note and offers the listening stages', async () => {
    vi.spyOn(recorder, 'recordSpeech').mockRejectedValue(new MicError('denied'))
    const user = await openSpeak()
    await screen.findByText(/Say the tone 1 of 10/)
    await user.click(recordButton())
    expect(await screen.findByText(/microphone is blocked/)).toBeInTheDocument()
    expect((await saved())!.answers).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Use the listening stages instead' }))
    expect(await screen.findByRole('button', { name: 'Start stage 1' })).toBeInTheDocument()
  })

  it('no microphone at all is said too', async () => {
    vi.spyOn(recorder, 'recordSpeech').mockRejectedValue(new MicError('missing'))
    const user = await openSpeak()
    await screen.findByText(/Say the tone 1 of 10/)
    await user.click(recordButton())
    expect(await screen.findByText(/No microphone was found/)).toBeInTheDocument()
  })

  it('too little voice: asks again and does not count', async () => {
    mockMic(silence(2), TONE1)
    const user = await openSpeak()
    await screen.findByText(/Say the tone 1 of 10/)
    await user.click(recordButton())
    expect(await screen.findByText("Didn't catch that, try again a bit louder.")).toBeInTheDocument()
    expect(card().querySelector('.tt-chart, .answer-feedback')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(recordButton()).toHaveTextContent('Record')
    expect((await saved())!.answers).toHaveLength(0)
    await user.click(recordButton())
    await screen.findByText('Heard tone 1 ✓')
    await waitFor(async () => expect((await saved())!.answers).toHaveLength(1))
    expect(screen.queryByText(/Didn't catch that/)).toBeNull()
  })

  it('without a calibration the first start asks for mā má mǎ mà, keeps the range and goes on; the learner may skip it', async () => {
    mockMic(fourTones(110, 220))
    const user = await openSpeak({ range: false })
    await screen.findByRole('heading', { name: 'Find your range' })
    expect(card()).toHaveTextContent('mā, má, mǎ, mà')
    await user.click(recordButton())
    await screen.findByText(/Say the tone 1 of 10/)
    const range = (await saved())!.range!
    expect(range[0]).toBeGreaterThan(100); expect(range[1]).toBeLessThan(235); expect(range[1] / range[0]).toBeGreaterThan(1.5)
  })
  it('a calibration with too little voice is not kept', async () => {
    mockMic(silence(8))
    const user = await openSpeak({ range: false })
    await screen.findByRole('heading', { name: 'Find your range' })
    await user.click(recordButton())
    expect(await screen.findByText(/Didn't catch enough of your voice/)).toBeInTheDocument()
    expect((await saved())?.range).toBeUndefined()
  })
  it('skipping the calibration judges on a provisional range and says so; Recalibrate on the picker opens the calibration', async () => {
    mockMic(TONE2)
    const user = await openSpeak({ range: false })
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    await screen.findByText(/Say the tone 1 of 10/)
    await user.click(recordButton())
    expect(await screen.findByText(/Your range is a guess from this one recording/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(await screen.findByRole('button', { name: 'Recalibrate' }))
    expect(await screen.findByRole('heading', { name: 'Find your range' })).toBeInTheDocument()
  })
})
