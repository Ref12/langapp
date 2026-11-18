import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as speech from '../../core/assistant/speech'
import * as store from '../../core/drills/store'
import { EngineRun } from './EngineSet'
import type { SessionExercise, SessionPlan } from '../../core/session/types'

const base = { stage: 'recognise', round: 0, refs: ['a'] } as const
const exercises = [
  { ...base, id: 'i1', form: 'intro' },
  { ...base, id: 'c1', form: 'choice', direction: 'en-to-zh', question: 'tea', options: ['茶', '水', '酒'], answer: 0, explanation: 'Tea is 茶.' },
  { ...base, id: 't1', form: 'translate-en-zh', prompt: 'to drink tea', promptLang: 'en', answerLang: 'zh', accepted: ['喝茶'], model: '喝茶', explanation: '' },
  { ...base, id: 'k1', form: 'tiles', translation: 'I drink tea', tiles: ['我', '喝', '茶'], distractors: [], shuffled: [0, 1, 2], accepted: ['我喝茶'], model: '我喝茶', explanation: '' },
  { ...base, id: 'm1', form: 'match', mode: 'zh-en', pairs: [{ ref: 'a', left: '茶', right: 'tea' }, { ref: 'b', left: '水', right: 'water' }], order: [0, 1], explanation: '' },
  { ...base, id: 'c2', form: 'choice', direction: 'en-to-zh', question: 'water', options: ['茶', '水', '酒'], answer: 1, explanation: 'Water is 水.' },
] as unknown as SessionExercise[]

vi.mock('../../core/session/set-plan', () => ({ planSetSession: vi.fn(async () => ({ stages: [{ stage: 'recognise', rounds: 1, exercises }], total: exercises.length, uncovered: [] } as unknown as SessionPlan)) }))
vi.mock('../../core/drills/store', async importActual => ({ ...(await importActual<typeof store>()), saveEngineAnswer: vi.fn(async () => undefined), recordEngineResult: vi.fn(async () => undefined), finishEngineRun: vi.fn(async () => undefined) }))
vi.mock('./IntroCards', () => ({ IntroCard: () => <p>intro card</p> }))

const props = {
  set: { id: 's', title: 'Tea', refs: [], source: 'new', status: 'active', engine: { preset: 'default', length: 'standard', seed: 1 } },
  items: [], catalog: { units: new Map() }, workspace: { knowledge: [], preferences: { pinyin: false, tileAutoSpeak: false } },
  run: async (job: () => Promise<void>) => { await job() }, busy: false, now: 0,
} as unknown as Parameters<typeof EngineRun>[0]

beforeEach(() => { vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined); vi.mocked(store.recordEngineResult).mockClear(); vi.mocked(store.saveEngineAnswer).mockClear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const answerChoice = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole('radio', { name })); await user.click(screen.getByRole('button', { name: /Check answer/ })); await user.click(screen.getByRole('button', { name: 'Next' }))
}
const toText = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Got it' }))
  await answerChoice(user, '茶')
}
const answerText = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Your answer'), '喝茶'); await user.click(screen.getByRole('button', { name: /Check answer/ })); await user.click(screen.getByRole('button', { name: 'Next' }))
}
const answerTiles = async (user: ReturnType<typeof userEvent.setup>) => {
  for (const tile of ['我', '喝', '茶']) await user.click(await screen.findByRole('button', { name: tile }))
  await user.click(screen.getByRole('button', { name: /Check answer/ })); await user.click(screen.getByRole('button', { name: 'Next' }))
}
const strip = (text: string) => waitFor(() => expect(document.querySelector('.engine-review-strip')).toHaveTextContent(text))
const back = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Previous exercise' }))

describe('reviewing the previous exercise', () => {
  it('has no Back target before anything is answered, and skips the intro item', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    expect(await screen.findByRole('button', { name: 'Got it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous exercise' })).toBeDisabled()
    await toText(user)
    await back(user)
    await strip('Reviewing 2 of 6')
    expect(screen.getByRole('radio', { name: /茶/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Previous exercise' })).toBeDisabled()
  })

  it('a choice shows the learner answer and the feedback; a second Back shows the one before', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user); await answerText(user)
    await back(user)
    await strip('Reviewing 3 of 6')
    expect(screen.getByDisplayValue('喝茶')).toBeDisabled()
    expect(screen.getByText(/Correct:/)).toBeInTheDocument()
    await back(user)
    await strip('Reviewing 2 of 6')
    expect(screen.getByRole('radio', { name: /茶/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /茶/ })).toBeDisabled()
    expect(screen.getByText('Tea is 茶.')).toBeInTheDocument()
  })

  it('records nothing in review, and cannot be answered again', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    const saved = vi.mocked(store.saveEngineAnswer).mock.calls.length
    const recorded = vi.mocked(store.recordEngineResult).mock.calls.length
    await back(user)
    await strip('Reviewing')
    for (const name of [/茶/, /水/, /酒/]) expect(screen.getByRole('radio', { name })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: /水/ }))
    expect(screen.getByRole('radio', { name: /茶/ })).toBeChecked()
    await strip('Reviewing 2 of 6')
    expect(vi.mocked(store.saveEngineAnswer).mock.calls.length).toBe(saved)
    expect(vi.mocked(store.recordEngineResult).mock.calls.length).toBe(recorded)
  })

  it('offers no self-mark or Check/Next in review', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    await user.type(await screen.findByLabelText('Your answer'), '水'); await user.click(screen.getByRole('button', { name: /Check answer/ }))
    expect(screen.getByRole('button', { name: /I was right/ })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await back(user)
    await strip('Reviewing 3 of 6')
    expect(screen.queryByRole('button', { name: /I was right/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Check answer|Next/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Answer another way|Speak|Handwrite/ })).toBeNull()
  })

  it('Forward and Back to current return to the waiting question with its partial input', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    await user.type(await screen.findByLabelText('Your answer'), '喝')
    await back(user)
    await strip('Reviewing 2 of 6')
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Forward/ }))
    expect(await screen.findByLabelText('Your answer')).toHaveValue('喝')
    expect(document.querySelector('.engine-review-strip')).toBeNull()
    await back(user)
    await user.click(await screen.findByRole('button', { name: 'Back to current' }))
    expect(await screen.findByLabelText('Your answer')).toHaveValue('喝')
    expect(document.querySelector('.engine-review-strip')).toBeNull()
  })

  it('reviews typed text, tiles and a match as they were answered', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user); await answerText(user); await answerTiles(user)
    await user.click(await screen.findByRole('button', { name: '茶' })); await user.click(screen.getByRole('button', { name: 'tea' }))
    await user.click(screen.getByRole('button', { name: '水' })); await user.click(screen.getByRole('button', { name: 'water' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await back(user)
    await strip('Reviewing 5 of 6')
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    await back(user)
    await strip('Reviewing 4 of 6')
    const placed = screen.getByRole('group', { name: 'Your sentence' })
    expect(placed).toHaveTextContent('我喝茶')
    expect(screen.getByText('我喝茶', { selector: 'span' })).toBeInTheDocument()
    await back(user)
    await strip('Reviewing 3 of 6')
    expect(screen.getByDisplayValue('喝茶')).toBeDisabled()
  })
})
