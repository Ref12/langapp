import { db } from '../database'
import { omit } from '../omit'
import type { Exercise, ExerciseSession } from './contracts'
import { queueLength } from './redo'
import { EXERCISES_PER_SESSION, MAX_EXERCISES_PER_SESSION, MIN_EXERCISES_PER_SESSION } from './exercises'

// Background exercise generation for a saved session shell. The page shows the item cards at once; this fills the exercises in place.
// "Running" is only believable while this tab has the request in flight; after a reload it is stale and the page offers Try again.

/**
 * `appended`: the exercises were added to the saved session as they arrived (see Emit), so the result's own exercises (a fill-in, usually) are added after them
 * instead of replacing them. `notice` is a quiet note about the AI part (it failed or was cut short) for a lesson that carries on without it.
 */
export interface GenerationResult { exercises: Exercise[]; rejected: string[]; phases?: ExerciseSession['phases']; appended?: boolean; notice?: string }

/** Adds a batch to the saved session right away, so the lesson can play it and a resumed lesson still has it. */
export type Emit = (exercises: Exercise[], rejected: string[]) => Promise<void>

const inflight = new Map<string, Promise<void>>()
const controllers = new Map<string, AbortController>()

/** Aborts the session's in-flight request, if this tab has one. */
export function cancelGeneration(sessionId: string): void {
  controllers.get(sessionId)?.abort()
}

/** True while this tab has the session's request in flight. */
export function isGenerating(sessionId: string): boolean {
  return inflight.has(sessionId)
}

/** Resolves when the session's current generation attempt has been saved (filled or failed). */
export function whenGenerated(sessionId: string): Promise<void> {
  return inflight.get(sessionId) ?? Promise.resolve()
}

/** The exercises-per-lesson preference, clamped to 8-40. */
export async function exerciseCountPreference(): Promise<number> {
  const value = (await db.preferences.get('workspace'))?.exercisesPerLesson
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(MAX_EXERCISES_PER_SESSION, Math.max(MIN_EXERCISES_PER_SESSION, value)) : EXERCISES_PER_SESSION
}

export function runGeneration(sessionId: string, build: (signal: AbortSignal, emit: Emit) => Promise<GenerationResult>): Promise<void> {
  const controller = new AbortController()
  controllers.set(sessionId, controller)
  const emit: Emit = async (exercises, rejected) => {
    await db.transaction('rw', db.exerciseSessions, async () => {
      const session = await db.exerciseSessions.get(sessionId)
      if (!session || session.status !== 'active' || session.generation !== 'running') return
      const ids = new Set(session.exercises.map(exercise => exercise.id))
      await db.exerciseSessions.put({ ...session, exercises: [...session.exercises, ...exercises.filter(exercise => !ids.has(exercise.id))], rejected: [...session.rejected, ...rejected].slice(0, 60) })
    })
  }
  const job = (async () => {
    try {
      const result = await build(controller.signal, emit)
      await db.transaction('rw', db.exerciseSessions, async () => {
        const session = await db.exerciseSessions.get(sessionId)
        if (!session || session.status !== 'active' || session.generation !== 'running') return
        const settled: ExerciseSession = {
          ...omit(session, 'generation', 'generationError'),
          exercises: result.appended ? [...session.exercises, ...result.exercises] : result.exercises,
          rejected: (result.appended ? [...session.rejected, ...result.rejected] : result.rejected).slice(0, 60),
          ...(result.phases ? { phases: result.phases } : {}), ...(result.notice ? { aiNotice: result.notice } : {}),
        }
        // A learner who already played everything and was waiting for more is done when nothing more came.
        await db.exerciseSessions.put(settled.cursor >= queueLength(settled) && settled.exercises.length > 0 ? { ...settled, status: 'completed', completedAt: Date.now() } : settled)
      })
    } catch (reason) {
      if (controller.signal.aborted) return
      const message = (reason instanceof Error ? reason.message : 'The exercises could not be generated.').slice(0, 600)
      await db.exerciseSessions.update(sessionId, { generation: 'failed', generationError: message }).catch(() => undefined)
    } finally {
      inflight.delete(sessionId)
      controllers.delete(sessionId)
    }
  })()
  inflight.set(sessionId, job)
  return job
}

/** Marks the session running again (clearing the error) and starts a new attempt. No-op while one is in flight. */
export async function restartGeneration(sessionId: string, build: (session: ExerciseSession, emit: Emit) => Promise<GenerationResult>): Promise<void> {
  if (inflight.has(sessionId)) return
  const session = await db.exerciseSessions.get(sessionId)
  if (!session || session.status !== 'active' || session.exercises.length > 0) return
  const rest = omit(session, 'generationError')
  // The request is registered before the first write, so the page never sees "running" without a request behind it.
  void runGeneration(sessionId, async (_signal, emit) => {
    await db.exerciseSessions.put({ ...rest, generation: 'running' })
    return build({ ...rest, generation: 'running' }, emit)
  })
}
