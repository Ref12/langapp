import { db } from '../database'
import { omit } from '../omit'
import type { Exercise, ExerciseSession } from './contracts'
import { EXERCISES_PER_SESSION, MAX_EXERCISES_PER_SESSION, MIN_EXERCISES_PER_SESSION } from './exercises'

// Background exercise generation for a saved session shell. The page shows the item cards at once; this fills the exercises in place.
// "Running" is only believable while this tab has the request in flight; after a reload it is stale and the page offers Try again.

export interface GenerationResult { exercises: Exercise[]; rejected: string[]; phases?: ExerciseSession['phases'] }

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

export function runGeneration(sessionId: string, build: (signal: AbortSignal) => Promise<GenerationResult>): Promise<void> {
  const controller = new AbortController()
  controllers.set(sessionId, controller)
  const job = (async () => {
    try {
      const result = await build(controller.signal)
      await db.transaction('rw', db.exerciseSessions, async () => {
        const session = await db.exerciseSessions.get(sessionId)
        if (!session || session.status !== 'active' || session.generation !== 'running') return
        await db.exerciseSessions.put({ ...omit(session, 'generation', 'generationError'), exercises: result.exercises, rejected: result.rejected.slice(0, 60), ...(result.phases ? { phases: result.phases } : {}) })
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
export async function restartGeneration(sessionId: string, build: (session: ExerciseSession) => Promise<GenerationResult>): Promise<void> {
  if (inflight.has(sessionId)) return
  const session = await db.exerciseSessions.get(sessionId)
  if (!session || session.status !== 'active' || session.exercises.length > 0) return
  const rest = omit(session, 'generationError')
  // The request is registered before the first write, so the page never sees "running" without a request behind it.
  void runGeneration(sessionId, async () => {
    await db.exerciseSessions.put({ ...rest, generation: 'running' })
    return build({ ...rest, generation: 'running' })
  })
}
