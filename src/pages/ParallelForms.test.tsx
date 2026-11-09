import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConjugateQuestion, FormPickQuestion, type ParallelContext } from './ParallelQuestions'
import type { ConjugateItem, FormPickItem } from '../core/session/types'

const base = { id: 'x', stage: 'use' as const, round: 0, refs: ['ja:w:a'] }
const jaCtx: ParallelContext = { language: 'ja', readings: new Map(), busy: false }
const koCtx: ParallelContext = { language: 'ko', readings: new Map(), busy: false }
const kaku: ConjugateItem = { ...base, form: 'conjugate', language: 'ja', lemma: '書く', lemmaReading: 'かく', cls: 'godan-ku', formId: 'masu', label: 'polite present ます', gloss: 'to write',
  tiles: ['書', 'き', 'ます'], tileReadings: ['か', undefined, undefined], distractors: ['ません'], shuffled: [2, 0, 3, 1], answer: '書きます', answerReading: 'かきます', rule: 'godan く: く → き + ます', irregular: false, explanation: '' }
const tap = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(within(screen.getByRole('group', { name: 'Available tiles' })).getByRole('button', { name }))

describe('Conjugate question', () => {
  it('grades a right answer and shows the reading and the rule', async () => {
    const user = userEvent.setup()
    render(<ConjugateQuestion exercise={kaku} ctx={jaCtx} onDone={() => undefined} />)
    expect(screen.getByTestId('conjugate-prompt')).toHaveTextContent('polite present ます')
    await tap(user, /^書/); await tap(user, /^き/); await tap(user, /^ます/)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByTestId('conjugate-result')).toHaveTextContent('Correct.')
    expect(screen.getByTestId('conjugate-rule')).toHaveTextContent('godan く: く → き + ます')
    expect(screen.queryByTestId('conjugate-irregular')).toBeNull()
  })
  it('shows the rule on a wrong answer and, for an irregular form, irregular plus the item', async () => {
    const user = userEvent.setup()
    const done: boolean[] = []
    render(<ConjugateQuestion exercise={{ ...kaku, irregular: true, itemRef: 'ja:f:書く:masu' }} ctx={jaCtx} onDone={result => done.push(result.correct)} />)
    await tap(user, /^書/); await tap(user, /^ません/)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByTestId('conjugate-result')).toHaveTextContent('Not quite.')
    expect(screen.getByTestId('conjugate-rule')).toHaveTextContent('→')
    expect(screen.getByTestId('conjugate-irregular')).toHaveTextContent('irregular')
    expect(screen.getByTestId('conjugate-irregular')).toHaveTextContent('ja:f:書く:masu')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(done).toEqual([false])
  })
  it('Korean: the right letters count, a spacing difference is almost', async () => {
    const user = userEvent.setup()
    const future: ConjugateItem = { ...kaku, language: 'ko', lemma: '일하다', lemmaReading: undefined, cls: 'hada', formId: 'future', label: 'future -(으)ㄹ 거예요', tiles: ['일', '할', '거예요'], tileReadings: [], distractors: [], shuffled: [1, 0, 2], answer: '일할 거예요', answerReading: undefined, rule: '하다: stem + (으)ㄹ + 거예요' }
    render(<ConjugateQuestion exercise={future} ctx={koCtx} onDone={() => undefined} />)
    await tap(user, /^일/); await tap(user, /^할/); await tap(user, /^거예요/)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByTestId('conjugate-result')).toHaveTextContent('Almost')
    expect(screen.getByTestId('conjugate-rule')).toHaveTextContent('stem + (으)ㄹ + 거예요')
  })
})

describe('Form to meaning question', () => {
  it('shows the form, takes a pick and explains the form', async () => {
    const user = userEvent.setup()
    const item: FormPickItem = { ...base, stage: 'recognise' as const, form: 'form-pick' as const, language: 'ja', surface: '来ました', reading: 'きました', answer: 1, rule: '来る: polite past', phrase: { text: '昨日来ました。', en: 'I came yesterday.' }, explanation: '来ました is polite past ました of 来る ("to come").',
      options: [{ lemma: '来る', reading: 'くる', gloss: 'to come', label: 'polite present ます' }, { lemma: '来る', reading: 'くる', gloss: 'to come', label: 'polite past ました' }, { lemma: '行く', reading: 'いく', gloss: 'to go', label: 'polite past ました' }, { lemma: '見る', reading: 'みる', gloss: 'to see', label: 'te form' }] }
    render(<FormPickQuestion exercise={item} ctx={jaCtx} onDone={() => undefined} />)
    expect(screen.getByTestId('form-pick-prompt')).toHaveTextContent('来ました')
    await user.click(screen.getAllByRole('radio')[1])
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByRole('status')).toHaveTextContent('polite past ました of 来る')
  })
})
