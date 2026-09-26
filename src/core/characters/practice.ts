import { matchesStroke, type Point, type StrokeGuide } from './geometry'

export const PHASES = ['Full guide', 'One stroke at a time', 'From memory'] as const
export const REPETITIONS = 3
export interface WritingRound {
  phase: number
  repetition: number
  completed: number
  misses: number[]
  finished: boolean
  feedback: string
}
export const newWritingRound = (): WritingRound => ({ phase: 0, repetition: 0, completed: 0, misses: [], finished: false, feedback: '' })
export const memoryHint = (round: WritingRound): boolean => round.phase === 2 && (round.misses[round.completed] ?? 0) >= 2

export function commitStroke(round: WritingRound, stroke: Point[], guides: StrokeGuide[]): WritingRound {
  if (round.finished || round.completed >= guides.length) return round
  if (matchesStroke(stroke, guides[round.completed])) return { ...round, completed: round.completed + 1, feedback: '' }
  const misses = [...round.misses]
  if (round.phase === 2) misses[round.completed] = (misses[round.completed] ?? 0) + 1
  return {
    ...round, misses,
    feedback: round.phase !== 2 ? 'Try again: start at the blue dot and follow the arrow. It does not need to be exact.'
      : misses[round.completed] >= 2 ? 'Guide added after two misses. Later strokes stay hidden.'
        : 'Try this stroke again from memory. Two misses will reveal its guide.',
  }
}

export function advanceRound(round: WritingRound, strokeCount: number): WritingRound {
  if (round.finished || round.completed !== strokeCount) return round
  if (round.repetition < REPETITIONS - 1) return { ...round, repetition: round.repetition + 1, completed: 0, misses: [], feedback: '' }
  if (round.phase < PHASES.length - 1) return { ...round, phase: round.phase + 1, repetition: 0, completed: 0, misses: [], feedback: '' }
  return { ...round, finished: true, feedback: '' }
}
