import { describe, expect, it } from 'vitest'
import { emptySchedulingState, intervalDays, retrievability, schedule } from './fsrs'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 8, 22, 12)

describe('FSRS scheduling', () => {
  it('schedules a first successful review about a day out and a miss ten minutes out', () => {
    const good = schedule(emptySchedulingState(now), 3, now)
    expect(good.state).toBe('review')
    expect(good.reps).toBe(1)
    expect(good.due - now).toBe(intervalDays(good.stability) * DAY)
    expect(intervalDays(good.stability)).toBeGreaterThanOrEqual(1)
    const again = schedule(emptySchedulingState(now), 1, now)
    expect(again.state).toBe('learning')
    expect(again.due - now).toBe(10 * 60 * 1000)
    expect(again.lapses).toBe(0)
  })

  it('grows the interval with repeated success and shrinks stability after a lapse', () => {
    let state = schedule(emptySchedulingState(now), 3, now)
    const first = state.due - now
    state = schedule(state, 3, state.due)
    const second = state.due - state.lastReview!
    expect(second).toBeGreaterThan(first)
    expect(state.difficulty).toBeGreaterThanOrEqual(1)
    expect(state.difficulty).toBeLessThanOrEqual(10)
    const before = state.stability
    const lapsed = schedule(state, 1, state.due)
    expect(lapsed.state).toBe('relearning')
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.stability).toBeLessThan(before)
    const recovered = schedule(lapsed, 3, lapsed.due)
    expect(recovered.state).toBe('review')
    expect(recovered.due).toBeGreaterThan(lapsed.due)
  })

  it('predicts recall near the retention target at the due date', () => {
    const state = schedule(emptySchedulingState(now), 4, now)
    expect(retrievability(state, now)).toBeCloseTo(1, 5)
    const atDue = retrievability(state, state.due)
    expect(atDue).toBeGreaterThan(0.8)
    expect(atDue).toBeLessThan(0.97)
    expect(retrievability(emptySchedulingState(now), now)).toBe(0)
  })

  it('keeps the interval bounded', () => {
    expect(intervalDays(0.0001)).toBe(1)
    expect(intervalDays(1e9)).toBe(365)
  })
})
