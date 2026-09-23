// FSRS-5 scheduling for one proficiency domain of one knowledge item.
// Formulas follow the published FSRS-5 algorithm with its default parameters.
// The state machine is deliberately small: Again returns the item within the
// session window; any successful rating schedules a review from stability.

export type Rating = 1 | 2 | 3 | 4 // Again, Hard, Good, Easy
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export interface SchedulingState {
  due: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: CardState
  lastReview?: number
}

export const FSRS_PARAMETERS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]
export const DESIRED_RETENTION = 0.9
export const MAXIMUM_INTERVAL_DAYS = 365
export const RELEARN_DELAY_MS = 10 * 60 * 1000
const DECAY = -0.5
const FACTOR = 19 / 81
const DAY_MS = 24 * 60 * 60 * 1000

const w = FSRS_PARAMETERS
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function emptySchedulingState(now: number): SchedulingState {
  return { due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new' }
}

export function retrievability(state: SchedulingState, now: number): number {
  if (state.state === 'new' || state.stability <= 0 || state.lastReview === undefined) return 0
  const elapsedDays = Math.max(0, (now - state.lastReview) / DAY_MS)
  return Math.pow(1 + FACTOR * elapsedDays / state.stability, DECAY)
}

function initialDifficulty(rating: Rating): number {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10)
}

function nextDifficulty(difficulty: number, rating: Rating): number {
  const delta = -w[6] * (rating - 3)
  const updated = difficulty + delta * (10 - difficulty) / 9
  return clamp(w[7] * initialDifficulty(4) + (1 - w[7]) * updated, 1, 10)
}

function recallStability(difficulty: number, stability: number, r: number, rating: Rating): number {
  const hard = rating === 2 ? w[15] : 1
  const easy = rating === 4 ? w[16] : 1
  return stability * (Math.exp(w[8]) * (11 - difficulty) * Math.pow(stability, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy + 1)
}

function forgetStability(difficulty: number, stability: number, r: number): number {
  const next = w[11] * Math.pow(difficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r))
  return Math.min(next, stability)
}

function shortTermStability(stability: number, rating: Rating): number {
  return stability * Math.exp(w[17] * (rating - 3 + w[18]))
}

export function intervalDays(stability: number): number {
  const days = stability / FACTOR * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1)
  return clamp(Math.round(days), 1, MAXIMUM_INTERVAL_DAYS)
}

export function schedule(state: SchedulingState, rating: Rating, now: number): SchedulingState {
  const sameDay = state.lastReview !== undefined && now - state.lastReview < DAY_MS
  let stability: number
  let difficulty: number
  if (state.state === 'new') {
    stability = w[rating - 1]
    difficulty = initialDifficulty(rating)
  } else if (sameDay && state.state !== 'review') {
    stability = shortTermStability(state.stability, rating)
    difficulty = nextDifficulty(state.difficulty, rating)
  } else {
    const r = retrievability(state, now)
    stability = rating === 1 ? forgetStability(state.difficulty, state.stability, r) : recallStability(state.difficulty, state.stability, r, rating)
    difficulty = nextDifficulty(state.difficulty, rating)
  }
  stability = clamp(stability, 0.01, 36500)
  if (rating === 1) {
    return {
      due: now + RELEARN_DELAY_MS, stability, difficulty,
      reps: state.reps + 1, lapses: state.state === 'new' ? state.lapses : state.lapses + 1,
      state: state.state === 'new' || state.state === 'learning' ? 'learning' : 'relearning', lastReview: now,
    }
  }
  return {
    due: now + intervalDays(stability) * DAY_MS, stability, difficulty,
    reps: state.reps + 1, lapses: state.lapses, state: 'review', lastReview: now,
  }
}
