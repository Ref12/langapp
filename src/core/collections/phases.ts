import type { Exercise } from '../study/contracts'
import { isPhraseRef } from '../study/contracts'

export type PhaseKind = 'words' | 'grammar' | 'line'
export const PHASE_LABEL: Record<PhaseKind, string> = { words: 'Words', grammar: 'Grammar', line: 'The line' }
const ORDER: PhaseKind[] = ['words', 'grammar', 'line']

/** An exercise belongs to the line when it targets a phrase, to grammar when it targets a grammar point, else to the words. */
export function phaseOf(exercise: Exercise): PhaseKind {
  if (exercise.targets.some(isPhraseRef)) return 'line'
  if (exercise.targets.some(ref => ref.startsWith('grammar:'))) return 'grammar'
  return 'words'
}

/** Puts exercises in lesson order (words, grammar, the line; stable inside a phase) and says where each phase starts. */
export function orderByPhase(exercises: Exercise[]): { exercises: Exercise[]; phases: { kind: PhaseKind; start: number }[] } {
  const sorted = ORDER.flatMap(kind => exercises.filter(exercise => phaseOf(exercise) === kind))
  const phases: { kind: PhaseKind; start: number }[] = []
  sorted.forEach((exercise, index) => { const kind = phaseOf(exercise); if (!phases.some(phase => phase.kind === kind)) phases.push({ kind, start: index }) })
  return { exercises: sorted, phases }
}

/** The phase an exercise index is in. */
export function phaseAt(phases: { kind: PhaseKind; start: number }[] | undefined, index: number): { kind: PhaseKind; start: number; number: number } | undefined {
  if (!phases?.length) return undefined
  let found = 0
  phases.forEach((phase, position) => { if (phase.start <= index) found = position })
  return { ...phases[found], number: found }
}
