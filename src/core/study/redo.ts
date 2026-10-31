import type { Exercise, ExerciseSession, Redo } from './contracts'

// Missed exercises are played again after the last one (Duolingo style). The first attempt is graded and scheduled as usual;
// redos only have to be answered correctly. A redo that is missed goes to the end once more, up to MAX_REDOS_PER_EXERCISE.

export const MAX_REDOS_PER_EXERCISE = 2

/** What the learner plays at a queue position: an exercise, and how many redos deep it is (0 on the first try). */
export interface PlayItem { exercise: Exercise; /** Index into session.exercises. */ index: number; redo: number }

/** The number of positions in the session: the exercises, then the queued redos. */
export function queueLength(session: Pick<ExerciseSession, 'exercises' | 'redos' | 'generation'>): number {
  // While the AI is still adding exercises the redos wait: they sit after the last exercise, which is not known yet.
  return session.exercises.length + (session.generation === 'running' ? 0 : session.redos?.length ?? 0)
}

export function playItem(session: Pick<ExerciseSession, 'exercises' | 'redos' | 'generation'>, position: number): PlayItem | undefined {
  if (!Number.isInteger(position) || position < 0) return undefined
  if (position < session.exercises.length) return { exercise: session.exercises[position], index: position, redo: 0 }
  const redo = session.generation === 'running' ? undefined : session.redos?.[position - session.exercises.length]
  const exercise = redo && session.exercises[redo.exercise]
  if (!redo || !exercise) return undefined
  return { exercise: exercise.type === 'tiles' && redo.shuffled ? { ...exercise, shuffled: redo.shuffled } : exercise, index: redo.exercise, redo: redo.round }
}

/** Redos still to play, counting the one on screen when the cursor is on a redo. */
export function redosRemaining(session: Pick<ExerciseSession, 'exercises' | 'redos' | 'cursor'>): number {
  return (session.redos?.length ?? 0) - Math.max(0, session.cursor - session.exercises.length)
}

/** The queue entry for a missed exercise, or undefined when it has used its redos. */
export function redoFor(item: PlayItem, shuffle: (count: number) => number[]): Redo | undefined {
  if (item.redo >= MAX_REDOS_PER_EXERCISE) return undefined
  const entry: Redo = { exercise: item.index, round: item.redo + 1 }
  return item.exercise.type === 'tiles' ? { ...entry, shuffled: shuffle(item.exercise.tiles.length + item.exercise.distractors.length) } : entry
}
