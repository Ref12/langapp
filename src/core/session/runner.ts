import { FORM_SKILLS, type SessionExercise, type SessionPlan, type Stage } from './types'
import type { Skill } from '../study/skill-map'

/** Missed exercises return at the end of their stage, for at most this many extra rounds. Retries are never graded. */
export const MAX_RETRY_ROUNDS = 2

export interface Attempt { exerciseId: string; stage: Stage; form: SessionExercise['form']; refs: string[]; correct: boolean; /** 0 for the first pass; retries are 1 and 2. */ round: number }

export interface RunnerState {
  plan: SessionPlan
  stageIndex: number
  queue: SessionExercise[]
  cursor: number
  /** 0 while the stage's own exercises are being played; 1 and 2 for its retry rounds. */
  round: number
  missed: SessionExercise[]
  log: Attempt[]
  done: boolean
}

const settle = (state: RunnerState): RunnerState => {
  let next = state
  // The end of a queue: retry the misses (up to the cap), else open the next stage; stages with nothing in them are skipped.
  while (!next.done && next.cursor >= next.queue.length) {
    if (next.missed.length && next.round < MAX_RETRY_ROUNDS) {
      const round = next.round + 1
      next = { ...next, round, cursor: 0, queue: next.missed.map(exercise => ({ ...exercise, round })), missed: [] }
      continue
    }
    const stageIndex = next.stageIndex + 1
    if (stageIndex >= next.plan.stages.length) return { ...next, stageIndex, queue: [], cursor: 0, missed: [], done: true }
    next = { ...next, stageIndex, round: 0, cursor: 0, missed: [], queue: next.plan.stages[stageIndex].exercises }
  }
  return next
}

export function startRunner(plan: SessionPlan): RunnerState {
  if (!plan.stages.length) return { plan, stageIndex: 0, queue: [], cursor: 0, round: 0, missed: [], log: [], done: true }
  return settle({ plan, stageIndex: 0, queue: plan.stages[0].exercises, cursor: 0, round: 0, missed: [], log: [], done: false })
}

export const currentExercise = (state: RunnerState): SessionExercise | undefined => state.done ? undefined : state.queue[state.cursor]
export const currentStage = (state: RunnerState): Stage | undefined => state.plan.stages[state.stageIndex]?.stage

/** Records the answer to the current exercise and moves on. Only a first pass is graded; a miss goes to the end of its stage. */
export function answerCurrent(state: RunnerState, correct: boolean): { state: RunnerState; graded: boolean } {
  const exercise = currentExercise(state)
  if (!exercise) return { state, graded: false }
  const graded = exercise.round === 0 && exercise.form !== 'intro' && exercise.form !== 'repeat'
  const attempt: Attempt = { exerciseId: exercise.id, stage: exercise.stage, form: exercise.form, refs: exercise.refs, correct, round: exercise.round }
  const missed = !correct && exercise.form !== 'intro' && exercise.form !== 'repeat' ? [...state.missed, exercise] : state.missed
  return { state: settle({ ...state, cursor: state.cursor + 1, missed, log: [...state.log, attempt] }), graded }
}

/** Exercises still to come in the stage being played (this queue only), for the progress line. */
export const remainingInQueue = (state: RunnerState) => Math.max(0, state.queue.length - state.cursor)

export interface StageSummary { stage: Stage; correct: number; total: number }
export interface RunnerSummary { stages: StageSummary[]; correct: number; total: number; missedRefs: string[]; retried: number }

/** First attempts only: what the session scored, per stage, and the items that were missed at least once. */
export function summarise(log: readonly Attempt[]): RunnerSummary {
  const first = log.filter(attempt => attempt.round === 0 && attempt.form !== 'intro' && attempt.form !== 'repeat')
  const stages = new Map<Stage, StageSummary>()
  for (const attempt of first) {
    const entry = stages.get(attempt.stage) ?? { stage: attempt.stage, correct: 0, total: 0 }
    entry.total++; if (attempt.correct) entry.correct++
    stages.set(attempt.stage, entry)
  }
  return {
    stages: [...stages.values()], correct: first.filter(attempt => attempt.correct).length, total: first.length,
    missedRefs: [...new Set(first.filter(attempt => !attempt.correct).flatMap(attempt => attempt.refs))], retried: log.filter(attempt => attempt.round > 0).length,
  }
}

/** The (item, skill) pairs one graded attempt records. */
export const skillsOf = (form: SessionExercise['form']): readonly Skill[] => FORM_SKILLS[form]
