import { cleanup, render, screen, within } from '@testing-library/react'
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
  it('Word order: the feedback after a wrong particle ends in one full stop, and a reversed order says the order is different', async () => {
    const tiles = ['\u79C1', '\u306F', '\u5B66\u751F', '\u3067\u3059']
    const place = async (order: string[]) => {
      const view = show({ form: 'tiles', translation: 'I am a student.', tiles, distractors: ['\u304C'], shuffled: [0, 1, 2, 3, 4], accepted: [tiles.join('')], spelled: [tiles.map(text => ({ text, reading: text }))], model: tiles.join(''), explanation: '' })
      const user = userEvent.setup()
      for (const tile of order) await user.click(within(view.container.querySelector('.tile-bank, .tiles, [class*=bank]') as HTMLElement ?? view.container).getAllByRole('button', { name: tile })[0])
      await user.click(screen.getByRole('button', { name: /Check answer/ }))
      return view.container.querySelector('.answer-feedback p')?.textContent ?? ''
    }
    const wrongParticle = await place(['\u79C1', '\u304C', '\u5B66\u751F', '\u3067\u3059'])
    expect(wrongParticle).toBe('Not the model answer. が marks the subject, often new information, but here the sentence needs は, which marks the topic.')
    expect(wrongParticle).not.toMatch(/\.\./)
    cleanup()
    const reversed = await place([...tiles].reverse())
    expect(reversed).toContain('All the words are there, but the order is different.')
    expect(reversed).not.toMatch(/\.\.|particle/)
  })
  it('Conjugate: the answer in kana and in romaji is right, the pack\'s voice, no Chinese', async () => {
    const play = vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
    const exercise = { form: 'conjugate', lemma: '\u52C9\u5F37\u3059\u308B', lemmaReading: '\u3079\u3093\u304D\u3087\u3046\u3059\u308B', cls: 'suru-compound', formId: 'masen', label: 'polite negative', gloss: 'to study', tiles: ['\u52C9\u5F37', '\u3057', '\u307E\u305B\u3093'], tileReadings: ['\u3079\u3093\u304D\u3087\u3046', undefined, undefined], distractors: [], shuffled: [2, 0, 1], answer: '\u52C9\u5F37\u3057\u307E\u305B\u3093', answerReading: '\u3079\u3093\u304D\u3087\u3046\u3057\u307E\u305B\u3093', rule: 'noun + suru', irregular: false, explanation: '' }
    const user = userEvent.setup()
    const view = show(exercise)
    expect(view.container.querySelector('.engine-instruction')).toHaveTextContent('Conjugate')
    for (const name of [/^\u52C9\u5F37/, /^\u3057$/, /^\u307E\u305B\u3093/]) await user.click(within(screen.getByRole('group', { name: 'Available tiles' })).getByRole('button', { name }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByTestId('conjugate-result')).toHaveTextContent('Correct.')
    expect(screen.getByTestId('conjugate-rule')).toHaveTextContent('noun + suru')
    await user.click(screen.getAllByRole('button', { name: 'Hear the answer' })[0])
    // a word is spoken from its kana reading, not its kanji
    expect(play).toHaveBeenCalledWith(expect.any(String), '\u3079\u3093\u304D\u3087\u3046\u3057\u307E\u305B\u3093', 'ja-JP', undefined)
    expect(text(view)).not.toMatch(/Chinese|pinyin/i)
    expect(view.container.querySelector('[lang="zh-Hans"]')).toBeNull()
  })
  it('Which form is this?: a pick is marked and the form explained', async () => {
    const user = userEvent.setup()
    const view = show({ form: 'form-pick', surface: '\u4F11\u3093\u3067\u304F\u3060\u3055\u3044', reading: '\u3084\u3059\u3093\u3067\u304F\u3060\u3055\u3044', answer: 1, rule: 'godan', explanation: 'x is te form of y.', options: [{ name: 'polite present', label: 'polite present \u307E\u3059', formId: 'masu' }, { name: 'please do', label: 'please \u301C\u3066\u304F\u3060\u3055\u3044', formId: 'te-kudasai' }, { name: 'te form', label: 'te form', formId: 'te' }] })
    await user.click(screen.getAllByRole('radio')[1])
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByRole('status')).toHaveTextContent('x is te form of y.')
    expect(view.container.querySelector('.correct-option')).not.toBeNull()
  })
})
