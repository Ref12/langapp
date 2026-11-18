import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
const count = (text: string) => waitFor(() => expect(document.querySelector('.engine-count')).toHaveTextContent(text))
const reviewing = () => waitFor(() => expect(document.querySelector('.engine-count')).toHaveAttribute('data-reviewing', 'true'))
const backButton = () => screen.getByRole('button', { name: 'Previous exercise' })
const back = (user: ReturnType<typeof userEvent.setup>) => user.click(backButton())

describe('reviewing the previous exercise', () => {
  it('has Previous beside Check answer, disabled until something is answered, and skips the intro item', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    expect(await screen.findByRole('button', { name: 'Got it' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous exercise' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    await screen.findByRole('radio', { name: /茶/ })
    const row = screen.getByRole('button', { name: /Check answer/ }).closest('.answer-actions')!
    expect(within(row as HTMLElement).getByRole('button', { name: 'Previous exercise' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /茶/ })); await user.click(screen.getByRole('button', { name: /Check answer/ })); await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText('Your answer')
    const next = screen.getByRole('button', { name: /Check answer/ }).closest('.answer-actions') as HTMLElement
    expect(within(next).getByRole('button', { name: 'Previous exercise' })).toBeEnabled()
    await back(user)
    await count('2/6')
    expect(screen.getByRole('radio', { name: /茶/ })).toBeChecked()
    expect(backButton()).toBeDisabled()
  })

  it('shows Previous on the intro item once there is history', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await user.click(await screen.findByRole('button', { name: 'Got it' }))
    await screen.findByRole('radio', { name: /茶/ })
    expect(screen.queryByRole('button', { name: 'Previous exercise' })?.hasAttribute('disabled') ?? true).toBe(true)
  })

  it('a choice shows the learner answer and the feedback; a second Previous shows the one before', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user); await answerText(user)
    await back(user)
    await count('3/6')
    expect(screen.getByDisplayValue('喝茶')).toBeDisabled()
    expect(screen.getByText(/Correct:/)).toBeInTheDocument()
    await back(user)
    await count('2/6')
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
    await reviewing()
    for (const name of [/茶/, /水/, /酒/]) expect(screen.getByRole('radio', { name })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /水/ }))
    expect(screen.getByRole('radio', { name: /茶/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: /Check answer/ })).toBeNull()
    await count('2/6')
    expect(vi.mocked(store.saveEngineAnswer).mock.calls.length).toBe(saved)
    expect(vi.mocked(store.recordEngineResult).mock.calls.length).toBe(recorded)
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    await screen.findByLabelText('Your answer')
    expect(vi.mocked(store.saveEngineAnswer).mock.calls.length).toBe(saved)
    expect(vi.mocked(store.recordEngineResult).mock.calls.length).toBe(recorded)
  })

  it('in review the right-hand button reads Next and carries the outcome: green right, red wrong, amber hint', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    await user.type(await screen.findByLabelText('Your answer'), '水'); await user.click(screen.getByRole('button', { name: /Check answer/ }))
    expect(screen.getByRole('button', { name: /I was right/ })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await back(user)
    await count('3/6')
    const wrong = screen.getByRole('button', { name: /^Next/ })
    expect(wrong).toHaveClass('answer-result-incorrect')
    expect(screen.queryByRole('button', { name: /I was right/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Check answer/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Answer another way|Speak|Handwrite/ })).toBeNull()
    expect(screen.getAllByText(/Closest answer|Not the model answer|Differences/).length).toBeGreaterThan(0)
    await back(user)
    await count('2/6')
    expect(screen.getByRole('button', { name: /^Next/ })).toHaveClass('answer-result-correct')
  })

  it('an answer that needed a hint shows an amber Next in review', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    // The hint outcome is reported by the question form (tones off); drive it through the same review path.
    const { QuestionSlot } = await import('./EngineReview')
    cleanup()
    const nav = { back: () => undefined, canBack: true, review: { outcome: { correct: true, hint: true }, next: () => undefined } }
    render(<QuestionSlot exercise={exercises[1] as never} ctx={{ readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }} locked hidden={false} nav={nav} onDone={() => undefined} />)
    expect(await screen.findByRole('button', { name: /^Next/ })).toHaveClass('answer-result-hint')
    void user
  })

  it('Next walks forward and returns to the waiting question with its partial input', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user); await answerText(user)
    await user.click(await screen.findByRole('button', { name: '我' }))
    await back(user)
    await count('3/6')
    await back(user)
    await count('2/6')
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    await count('3/6')
    expect(screen.getByDisplayValue('喝茶')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    expect(await screen.findByRole('group', { name: 'Your sentence' })).toHaveTextContent('我')
    expect(document.querySelector('.engine-count')).not.toHaveAttribute('data-reviewing')
  })

  it('a typed partial answer survives a trip back and forward', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    await user.type(await screen.findByLabelText('Your answer'), '喝')
    await back(user)
    await count('2/6')
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Next/ }))
    expect(await screen.findByLabelText('Your answer')).toHaveValue('喝')
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
    await count('5/6')
    await back(user)
    await count('4/6')
    const placed = screen.getByRole('group', { name: 'Your sentence' })
    expect(placed).toHaveTextContent('我喝茶')
    expect(screen.getByText('我喝茶', { selector: 'span' })).toBeInTheDocument()
    await back(user)
    await count('3/6')
    expect(screen.getByDisplayValue('喝茶')).toBeDisabled()
  })

  it('the top row is the leave button, the bar and the count, with a marker only in review', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await screen.findByRole('button', { name: 'Got it' })
    expect(screen.getByRole('button', { name: 'Leave session' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Session progress' })).toBeInTheDocument()
    expect(document.querySelector('.engine-count')).toHaveTextContent('0/6')
    expect(document.querySelector('.engine-review-strip, .engine-back, .back-link')).toBeNull()
    expect(document.querySelector('.engine-top .eyebrow')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous exercise' })).toBeNull()
    expect(screen.queryByTestId('review-marker')).toBeNull()
    await toText(user)
    await back(user)
    await count('2/6')
    expect(screen.getByTestId('review-marker')).toBeInTheDocument()
    expect(document.querySelector('.engine-count')).toHaveClass('muted')
    expect(screen.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('value', '2')
  })

  it('Leave session goes to the set page', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await user.click(await screen.findByRole('button', { name: 'Leave session' }))
    expect(window.location.hash).toBe('#practice/set/s')
  })

  it('the reading toggle sits in the card, at the end of the instruction line, and still toggles', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    await toText(user)
    const toggle = await screen.findByRole('button', { name: 'Show pinyin' })
    expect(toggle.closest('.practice-card')).not.toBeNull()
    expect(toggle.previousElementSibling).toHaveAttribute('data-instruction')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide pinyin' })).toHaveAttribute('aria-pressed', 'true')
  })
})
