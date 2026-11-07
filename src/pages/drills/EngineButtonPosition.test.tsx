import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExerciseQuestion, type QuestionContext } from './EngineQuestion'
import type { SessionExercise } from '../../core/session/types'

const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(['你', '好']), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const base = { id: 'x', refs: ['a'], stage: 'recognise', round: 0 }
const line = { zh: '你好', py: 'ni3 hao3', en: 'Hello', speaker: 'female' as const, name: 'Li' }
const forms: Record<string, { exercise: unknown; act: (root: HTMLElement) => void }> = {
  choice: { exercise: { ...base, form: 'choice', direction: 'zh-to-en', question: '你好', options: ['hello', 'bye'], answer: 0, explanation: 'why' }, act: root => fireEvent.click(root.querySelectorAll('input[type=radio]')[0]) },
  gap: { exercise: { ...base, form: 'gap', sentence: '你好', gapped: '你_', options: ['好', '们'], answer: 0, translation: 'Hello', explanation: 'why' }, act: root => fireEvent.click(root.querySelectorAll('input[type=radio]')[1]) },
  'listen-pick': { exercise: { ...base, form: 'listen-pick', hearText: '你好', options: ['hello', 'bye'], answer: 0, model: '你好', explanation: 'why' }, act: root => fireEvent.click(root.querySelectorAll('input[type=radio]')[0]) },
  'exchange-pick': { exercise: { ...base, form: 'exchange-pick', question: line, options: [line, line], answer: 0, explanation: 'why' }, act: root => fireEvent.click(root.querySelectorAll('input[type=radio]')[0]) },
  'which-correct': { exercise: { ...base, form: 'which-correct', en: 'Hello', options: [{ zh: '你好' }, { zh: '好你' }], answer: 0, whys: [undefined, 'order'], explanation: 'why' }, act: root => fireEvent.click(root.querySelectorAll('input[type=radio]')[1]) },
  conversation: { exercise: { ...base, form: 'conversation', title: 't', lines: [line], questions: [{ q: 'q1', options: ['a', 'b'], answer: 0 }, { q: 'q2', options: ['a', 'b'], answer: 1 }] }, act: root => { fireEvent.click(root.querySelectorAll('input[type=radio]')[0]); fireEvent.click(root.querySelectorAll('input[type=radio]')[3]) } },
  tiles: { exercise: { ...base, form: 'tiles', translation: 'Hello', tiles: ['你', '好'], distractors: [], shuffled: [0, 1], accepted: ['你好'], model: '你好', explanation: 'why' }, act: root => { const tiles = root.querySelectorAll('.tile-bank .tile'); fireEvent.click(tiles[0]); fireEvent.click(tiles[1]) } },
  'translate-zh-en': { exercise: { ...base, form: 'translate-zh-en', prompt: '你好', promptLang: 'zh', answerLang: 'en', accepted: ['hello'], model: 'hello', explanation: 'why' }, act: root => fireEvent.change(root.querySelector('input[type=text]')!, { target: { value: 'hello' } }) },
  'translate-en-zh': { exercise: { ...base, form: 'translate-en-zh', prompt: 'Hello', promptLang: 'en', answerLang: 'zh', accepted: ['你好'], model: '你好', explanation: 'why' }, act: root => fireEvent.change(root.querySelector('input[type=text]')!, { target: { value: '好你' } }) },
  pinyin: { exercise: { ...base, form: 'pinyin', prompt: '你好', promptLang: 'zh', answerLang: 'py', accepted: ['nǐ hǎo'], model: 'nǐ hǎo', explanation: 'why' }, act: root => fireEvent.change(root.querySelector('input[type=text]')!, { target: { value: 'ni hao' } }) },
  dictation: { exercise: { ...base, form: 'dictation', prompt: '', promptLang: 'zh', hearText: '你好', answerLang: 'zh', accepted: ['你好'], model: '你好', explanation: 'why' }, act: root => fireEvent.change(root.querySelector('input[type=text]')!, { target: { value: '你好' } }) },
}

/** The structure above the Check/Next button: the same before and after checking, so the button cannot move. */
const above = (root: HTMLElement) => { const actions = root.querySelector('.answer-actions')!; const out: string[] = []; for (let node = actions.previousElementSibling; node; node = node.previousElementSibling) out.push(node.tagName + '.' + node.className); return out }

describe('Check answer and Next share one position', () => {
  for (const [form, { exercise, act }] of Object.entries(forms)) {
    it(form + ': nothing above the button changes, feedback sits below it', () => {
      const { container } = render(<ExerciseQuestion exercise={exercise as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>} ctx={ctx} onDone={() => undefined} />)
      act(container)
      const before = above(container)
      const check = container.querySelector('.check-answer-button') as HTMLButtonElement
      expect(check.textContent).toMatch(/Check answer/)
      expect(check.disabled).toBe(false)
      const actions = container.querySelector('.answer-actions')!
      fireEvent.click(check)
      const after = container.querySelector('.answer-actions')!
      expect(container.querySelector('.check-answer-button')!.textContent).toMatch(/Next/)
      expect(above(container)).toEqual(before)
      expect(after).toBe(actions)
      for (const feedback of container.querySelectorAll('.answer-feedback')) expect(after.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(container.querySelector('.answer-feedback')).not.toBeNull()
    })
  }
})
