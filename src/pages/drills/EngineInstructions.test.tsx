import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseQuestion, INSTRUCTION, type QuestionContext } from './EngineQuestion'
import { FORMS, type SessionExercise } from '../../core/session/types'

const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(['你', '好', '学习', '是', '我']), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const opt = ['一', '二']
const base = { id: 'x', refs: ['a'], stage: 'use', round: 0 }
const shapes: Record<string, object> = {
  choice: { direction: 'zh-to-en', question: '学习', options: opt, answer: 0, explanation: '' },
  match: { mode: 'zh-en', pairs: [{ ref: 'a', left: '学习', right: 'study' }], order: [0], explanation: '' },
  pinyin: { prompt: '学习', promptLang: 'zh', answerLang: 'py', accepted: ['xué xí'], model: 'xué xí', explanation: '' },
  recall: { prompt: '学习', promptLang: 'zh', answerLang: 'en', accepted: ['study'], model: 'study', explanation: '' },
  'translate-zh-en': { prompt: '学习', promptLang: 'zh', answerLang: 'en', accepted: ['study'], model: 'study', explanation: '' },
  'translate-en-zh': { prompt: 'study', promptLang: 'en', answerLang: 'zh', accepted: ['学习'], model: '学习', explanation: '' },
  dictation: { prompt: '', promptLang: 'zh', hearText: '学习', answerLang: 'zh', accepted: ['学习'], model: '学习', explanation: '' },
  tiles: { translation: 'study', tiles: ['学习'], distractors: [], shuffled: [0], accepted: ['学习'], model: '学习', explanation: '' },
  gap: { sentence: '我学习', gapped: '我__', options: opt, answer: 0, translation: 'I study', explanation: '' },
  'listen-pick': { hearText: '学习', options: opt, answer: 0, model: '学习', explanation: '' },
  'exchange-pick': { question: { zh: '你好吗', py: '', en: 'How are you?' }, options: [{ zh: '好', py: '', en: 'good' }], answer: 0, explanation: '' },
  'exchange-reply': { prompt: '你好吗', promptLang: 'zh', hearText: '你好吗', answerLang: 'zh', accepted: ['我很好'], model: '我很好', questionEn: 'How are you?', replyEn: "I'm fine.", explanation: '' },
  'which-correct': { en: 'study', options: [{ zh: '学习' }, { zh: '习学' }], answer: 0, whys: [], explanation: '' },
  conjugate: { lemma: '学习', cls: 'x', formId: 'f', label: 'form', gloss: 'study', tiles: ['学', '习'], tileReadings: [], distractors: [], shuffled: [0, 1], answer: '学习', rule: 'rule', irregular: false, explanation: '' },
  'form-pick': { surface: '学习', options: [{ lemma: '学', gloss: 'a', label: 'b' }, { lemma: '习', gloss: 'c', label: 'd' }], answer: 0, rule: 'rule', explanation: '' },
  'which-tones': { word: '学习', pinyin: 'xue2 xi2', tones: [2, 2], file: 'x/y.mp3', voice: 'x', explanation: '' },
  conversation: { title: 't', lines: [{ who: 'A', zh: '你好', py: '', en: '' }], questions: [{ after: 0, question: 'q', options: opt, answer: 0 }], explanation: '' },
}
const exercise = (form: string, extra: object = {}) => ({ ...base, form, ...shapes[form], ...extra }) as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
const show = (ex: ReturnType<typeof exercise>) => render(<ExerciseQuestion exercise={ex} ctx={ctx} onDone={vi.fn()} />)

describe('every exercise says what to do', () => {
  for (const form of FORMS.filter(value => value !== 'intro' && value !== 'repeat')) {
    it(`${form} shows its instruction line`, () => {
      const view = show(exercise(form))
      expect(view.container.querySelector(`[data-instruction="${form}"]`)).toHaveTextContent(INSTRUCTION[form])
    })
  }
  it('uses action wording for the named forms', () => {
    expect(INSTRUCTION['translate-en-zh']).toBe('Translate into Chinese'); expect(INSTRUCTION.dictation).toBe('Type what you hear'); expect(INSTRUCTION.tiles).toBe('Build the sentence')
    expect(INSTRUCTION['exchange-pick']).toBe('Pick the reply'); expect(INSTRUCTION.gap).toBe('Fill the gap'); expect(INSTRUCTION['which-correct']).toBe('Which sentence is correct?')
  })
})

describe('reply exercise', () => {
  it('shows the English reply as a cue, with the question meaning hidden until asked', () => {
    show(exercise('exchange-reply'))
    expect(screen.getByText(/Reply: “I'm fine\.”/)).toBeInTheDocument()
    expect(screen.queryByText(/How are you\?/)).toBeNull()
    expect(screen.getByPlaceholderText('Your reply in Chinese')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show meaning' }))
    expect(screen.getByText(/How are you\?/)).toBeInTheDocument()
  })
  it('grades like translate to Chinese: an unlisted wording is not a fail and can be counted', () => {
    const done = vi.fn()
    const view = render(<ExerciseQuestion exercise={exercise('exchange-reply')} ctx={ctx} onDone={done} />)
    fireEvent.change(view.container.querySelector('input[type=text]')!, { target: { value: '我好' } })
    fireEvent.click(view.container.querySelector('.check-answer-button')!)
    expect(screen.getByRole('button', { name: /I was right/ })).toBeInTheDocument()
  })
})
