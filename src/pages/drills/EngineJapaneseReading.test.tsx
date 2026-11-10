import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DisplaySettingsProvider } from '../../components/display-context'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { ExerciseQuestion, type Outcome, type QuestionContext } from './EngineQuestion'
import type { SessionExercise } from '../../core/session/types'

// The typed-reading question of a Japanese build: kana or romaji is marked, the reading is shown in the learner's setting, nothing speaks of pinyin or tones.
const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const exercise = { id: 'p', refs: ['a'], stage: 'recall', round: 0, form: 'pinyin', prompt: '東京', promptLang: 'zh', hearText: '東京', answerLang: 'py', accepted: ['とうきょう'], model: 'とうきょう', explanation: '' } as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>

beforeEach(() => setBuildLanguageForTests('ja'))
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined) })

function answer(typed: string, style?: 'kana' | 'romaji') {
  const done = vi.fn<(outcome: Outcome) => void>()
  const view = render(<DisplaySettingsProvider settings={{ form: undefined, readingStyle: style }}><ExerciseQuestion exercise={exercise} ctx={ctx} onDone={done} /></DisplaySettingsProvider>)
  const input = view.container.querySelector('input[type=text]')!
  fireEvent.change(input, { target: { value: typed } })
  const press = () => fireEvent.click(view.container.querySelector('.check-answer-button')!)
  return { done, view, input, press }
}

describe('Type the reading in a Japanese build', () => {
  it('has no tone preview, no Hear button before the check and a Japanese input', () => {
    const { view, input } = answer('toukyou')
    expect(screen.queryByLabelText('Preview')).toBeNull()
    expect(view.container.querySelector('.engine-pinyin-preview')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hear it' })).toBeNull()
    expect(input).toHaveAttribute('lang', 'ja')
    expect(view.container.textContent).not.toMatch(/pinyin|tone|syllable/i)
  })
  it('marks a right kana answer Correct and then offers Hear', () => {
    const { done, press } = answer('トウキョウ'); press()
    expect(screen.getByRole('status')).toHaveTextContent('Correct: とうきょう')
    expect(screen.queryByRole('button', { name: /I was right/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeInTheDocument()
    press(); expect(done).toHaveBeenCalledWith({ correct: true })
  })
  it('marks a right romaji answer Correct, and shows the reading in romaji when the learner chose it', () => {
    const { press } = answer('tōkyō', 'romaji'); press()
    expect(screen.getByRole('status')).toHaveTextContent('Correct: toukyou')
  })
  it('marks a wrong answer wrong and shows the reading', () => {
    const { done, press } = answer('osaka'); press()
    expect(screen.getByRole('status')).toHaveTextContent('Not the reading.')
    expect(screen.getByRole('status')).toHaveTextContent('The reading is とうきょう.')
    expect(screen.getByRole('status')).not.toHaveTextContent('Compare with the answer')
    press(); expect(done).toHaveBeenCalledWith({ correct: false })
  })
  it('counts a long vowel written short as Needed a hint, with the reading', () => {
    const { done, press } = answer('tokyo'); press()
    expect(screen.getByRole('status')).toHaveTextContent('Right sounds, long vowels: とうきょう')
    expect(screen.queryByRole('button', { name: /I was right/ })).toBeNull()
    press(); expect(done).toHaveBeenCalledWith({ correct: true, hint: true })
  })
  it('leaves an answer that cannot be read (kanji) to the learner', () => {
    const { press } = answer('東京'); press()
    expect(screen.getByRole('status')).toHaveTextContent('Compare with the answer and mark it yourself.')
    expect(screen.getByRole('button', { name: /I was right/ })).toBeInTheDocument()
  })
})
