import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseQuestion, type Outcome, type QuestionContext } from './EngineQuestion'
import type { SessionExercise } from '../../core/session/types'

const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(['学习']), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const exercise = { id: 'p', refs: ['a'], stage: 'recall', round: 0, form: 'pinyin', prompt: '学习', promptLang: 'zh', answerLang: 'py', accepted: ['xué xí'], model: 'xué xí', explanation: '学习 is xué xí.' } as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>

function answer(typed: string) {
  const done = vi.fn<(outcome: Outcome) => void>()
  const view = render(<ExerciseQuestion exercise={exercise} ctx={ctx} onDone={done} />)
  fireEvent.change(view.container.querySelector('input[type=text]')!, { target: { value: typed } })
  return { done, view, check: () => { fireEvent.click(view.container.querySelector('.check-answer-button')!); return view }, next: () => fireEvent.click(view.container.querySelector('.check-answer-button')!) }
}

describe('typing pinyin', () => {
  it('shows the hint, turns the phone keyboard helpers off and previews the marked form', () => {
    const { view } = answer('xue2 xi2')
    expect(screen.getByText('Pinyin with tones: type numbers (xue2 xi2) or marks (xué xí). Use v for ü (lv4).')).toBeInTheDocument()
    const input = view.container.querySelector('input[type=text]')!
    expect(input).toHaveAttribute('autocapitalize', 'none'); expect(input).toHaveAttribute('autocorrect', 'off'); expect(input).toHaveAttribute('autocomplete', 'off'); expect(input).toHaveAttribute('spellcheck', 'false')
    expect(screen.getByLabelText('Preview')).toHaveTextContent('xué xí')
  })
  it('accepts numbers without spaces as right and reports a first-try right', () => {
    const { done, check, next } = answer('Xue2Xi2'); check(); expect(screen.getByRole('status')).toHaveTextContent('Correct'); next()
    expect(done).toHaveBeenCalledWith({ correct: true })
  })
  it('says "Right syllables, tones: xué xí" for xue xi, counts it as Needed a hint and does not offer self-marking', () => {
    const { done, check, next } = answer('xue xi'); check()
    expect(screen.getByRole('status')).toHaveTextContent('Right syllables, tones: xué xí')
    expect(screen.queryByRole('button', { name: /I was right/ })).toBeNull()
    next(); expect(done).toHaveBeenCalledWith({ correct: true, hint: true })
  })
  it('points at the one syllable that is off', () => {
    const { check } = answer('xue2 xi4'); check()
    const off = document.querySelectorAll('.engine-tone-off'); expect(off).toHaveLength(1); expect(off[0]).toHaveTextContent('xí')
  })
  it('sends different letters to self-marking', () => {
    const { done, check, next } = answer('xie xi'); check()
    expect(screen.getByRole('button', { name: /I was right/ })).toBeInTheDocument(); next(); expect(done).toHaveBeenCalledWith({ correct: false })
  })
})
