import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as speech from '../../core/assistant/speech'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { ExerciseQuestion, type QuestionContext } from './EngineQuestion'
import type { SessionExercise } from '../../core/session/types'

// Three questions of a Japanese build, as the learner reads them: no Chinese, no pinyin, the Japanese voice and the Japanese language tag.
const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(['\u79C1']), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const base = { id: 'x', refs: ['a'], stage: 'recall', round: 0 }
const make = (shape: object) => ({ ...base, ...shape }) as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
const show = (shape: object) => render(<ExerciseQuestion exercise={make(shape)} ctx={ctx} onDone={vi.fn()} />)

beforeEach(() => setBuildLanguageForTests('ja'))
afterEach(() => { cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined) })

const text = (view: { container: HTMLElement }) => view.container.textContent ?? ''

describe('Practice questions in a Japanese build', () => {
  it('Choose the meaning', () => {
    const view = show({ form: 'choice', direction: 'zh-to-en', question: '\u79C1', options: ['I', 'you'], answer: 0, explanation: '' })
    expect(view.container.querySelector('.engine-instruction')).toHaveTextContent('Choose the meaning')
    expect(text(view)).not.toMatch(/Chinese|pinyin/i)
    expect(view.container.querySelector('[lang="ja"]')).toHaveTextContent('\u79C1')
    expect(view.container.querySelector('[lang="zh-Hans"]')).toBeNull()
  })
  it('Type the reading: title, help, placeholder and the language tags', () => {
    const view = show({ form: 'pinyin', prompt: '\u79C1', promptLang: 'zh', answerLang: 'py', accepted: ['\u308F\u305F\u3057'], model: '\u308F\u305F\u3057', explanation: '' })
    expect(view.container.querySelector('.engine-instruction')).toHaveTextContent('Type the reading')
    expect(screen.getByText('Type the reading in kana or romaji.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type the reading')).toBeInTheDocument()
    expect(text(view)).not.toMatch(/Chinese|pinyin/i)
    expect(view.container.querySelector('[lang="zh-Hans"]')).toBeNull()
  })
  it('Type the Japanese: placeholder and the input tag', () => {
    const view = show({ form: 'translate-en-zh', prompt: 'I', promptLang: 'en', answerLang: 'zh', accepted: ['\u79C1'], model: '\u79C1', explanation: '' })
    expect(view.container.querySelector('.engine-instruction')).toHaveTextContent('Translate into Japanese')
    expect(screen.getByPlaceholderText('Type the Japanese')).toHaveAttribute('lang', 'ja')
  })
  it('Listen and pick: the Hear button speaks ja-JP', async () => {
    const play = vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
    const view = show({ form: 'listen-pick', hearText: '\u79C1\u306F\u5B66\u751F\u3067\u3059', options: ['I am a student', 'You are a teacher'], answer: 0, model: '', explanation: '' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hear it' }))
    expect(play).toHaveBeenCalledWith(expect.any(String), '\u79C1\u306F\u5B66\u751F\u3067\u3059', 'ja-JP', undefined)
    expect(text(view)).not.toMatch(/Chinese|pinyin/i)
  })
})
