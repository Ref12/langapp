import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as speech from '../../core/assistant/speech'
import * as store from '../../core/drills/store'
import { EngineRun } from './EngineSet'
import type { SessionExercise, SessionPlan } from '../../core/session/types'

const base = { stage: 'recognise', round: 0, refs: ['a'] } as const
const exercises = Array.from({ length: 33 }, (_, index) => ({ ...base, id: 'c' + index, form: 'choice', direction: 'en-to-zh', question: 'tea', options: ['茶', '水', '酒'], answer: 0, explanation: 'Tea is 茶.' })) as unknown as SessionExercise[]
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

const strip = () => document.querySelector('.engine-review-strip')
describe('the review window', () => {
  it('keeps only the last 30 answered questions, and Back stops at the oldest kept', async () => {
    const user = userEvent.setup()
    render(<EngineRun {...props} />)
    for (let index = 0; index < 32; index++) {
      await user.click(await screen.findByRole('radio', { name: /茶/ })); await user.click(screen.getByRole('button', { name: /Check answer/ })); await user.click(screen.getByRole('button', { name: 'Next' }))
      await waitFor(() => expect(document.querySelectorAll('.practice-card [data-review]').length).toBe(Math.min(index + 1, 30)))
    }
    const back = screen.getByRole('button', { name: 'Previous exercise' })
    for (let step = 0; step < 40 && !(back as HTMLButtonElement).disabled; step++) await user.click(back)
    await waitFor(() => expect(strip()).toHaveTextContent('Reviewing 3 of 33'))
    expect(back).toBeDisabled()
    expect(document.querySelectorAll('.practice-card [data-review]').length).toBe(30)
  }, 60000)
})
