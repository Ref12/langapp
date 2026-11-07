import { describe, expect, it } from 'vitest'
import { answerCurrent, currentExercise, MAX_RETRY_ROUNDS, startRunner, summarise } from './runner'
import type { SessionExercise, SessionPlan } from './types'

const repeat = (id: string, stage: SessionExercise['stage'], ref: string): SessionExercise => ({ id, stage, form: 'recall', refs: [ref], round: 0, prompt: '', promptLang: 'zh', answerLang: 'en', accepted: [], model: '', explanation: '' } as SessionExercise)
const plan = (stages: Record<string, string[]>): SessionPlan => ({ intent: 'practice-set', preset: 'default', length: 'standard', uncovered: [], total: 0,
  stages: Object.entries(stages).map(([stage, refs]) => ({ stage: stage as SessionExercise['stage'], rounds: 1, exercises: refs.map(ref => repeat(stage + ref, stage as SessionExercise['stage'], ref)) })) })

describe('runner', () => {
  it('plays a stage completely before the next one', () => {
    let state = startRunner(plan({ recognise: ['a', 'b'], recall: ['a', 'b'] }))
    const order: string[] = []
    while (currentExercise(state)) { order.push(currentExercise(state)!.id); state = answerCurrent(state, true).state }
    expect(order).toEqual(['recognisea', 'recogniseb', 'recalla', 'recallb'])
    expect(state.done).toBe(true)
  })
  it('returns missed items at the end of their own stage, ungraded, at most twice', () => {
    let state = startRunner(plan({ recognise: ['a', 'b', 'c'], recall: ['a'] }))
    const seen: { id: string; graded: boolean }[] = []
    while (currentExercise(state)) {
      const id = currentExercise(state)!.id
      const step = answerCurrent(state, id !== 'recogniseb')
      seen.push({ id, graded: step.graded }); state = step.state
    }
    expect(seen.map(item => item.id)).toEqual(['recognisea', 'recogniseb', 'recognisec', 'recogniseb', 'recogniseb', 'recalla'])
    expect(seen.map(item => item.graded)).toEqual([true, true, true, false, false, true])
    expect(MAX_RETRY_ROUNDS).toBe(2)
    const summary = summarise(state.log)
    expect(summary.total).toBe(4)
    expect(summary.correct).toBe(3)
    expect(summary.missedRefs).toEqual(['b'])
    expect(summary.retried).toBe(2)
  })
  it('stops retrying an item that is right the second time', () => {
    let state = startRunner(plan({ recognise: ['a', 'b'] }))
    let misses = 0
    while (currentExercise(state)) { const miss = currentExercise(state)!.id === 'recognisea' && misses++ < 1; state = answerCurrent(state, !miss).state }
    expect(state.log.map(attempt => attempt.round)).toEqual([0, 0, 1])
  })
  it('handles a plan without stages', () => { expect(startRunner(plan({})).done).toBe(true) })
})
