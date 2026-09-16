import type { Activity, ReadingStage, WordState } from './model'

export const DAY = 24 * 60 * 60 * 1000

function localDay(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function readingStage(state?: WordState): ReadingStage | 'Not studied' {
  if (!state) return 'Not studied'
  if (state.successfulDays.length >= 3 && state.successfulActivities.length === 2) return 'Learned'
  return state.attempts ? 'Practicing' : 'Introduced'
}

export function applyAnswer(
  state: WordState, activity: Activity, correct: boolean, assisted: boolean, now: number,
): WordState {
  const next = { ...state, attempts: state.attempts + 1 }
  if (!correct || assisted) {
    return { ...next, successfulDays: [], successfulActivities: [], dueAt: now + 5 * 60 * 1000 }
  }
  const day = localDay(now)
  const alreadyPracticedToday = state.successfulDays.includes(day)
  const successfulDays = [...new Set([...state.successfulDays, day])].slice(-3)
  const successfulActivities = [...new Set([...state.successfulActivities, activity])]
  // Repeating the same session on one day must not manufacture spaced evidence.
  const dueAt = alreadyPracticedToday
    ? state.dueAt
    : now + [DAY, 3 * DAY, 7 * DAY][Math.min(successfulDays.length - 1, 2)]
  return {
    ...next, successfulDays, successfulActivities, dueAt,
    independentCorrect: state.independentCorrect + 1,
  }
}
