import { db } from '../database'
import { collectionResult } from '../collections/store'
import { restartGeneration } from './generation'
import { lessonResult } from './knowledge'

/** Try again for a session whose exercises failed to generate, or whose "running" state is stale after a reload. */
export async function retryGeneration(sessionId: string): Promise<void> {
  if (!await db.exerciseSessions.get(sessionId)) throw new Error('That lesson session could not be found.')
  await restartGeneration(sessionId, (session, emit) => session.collectionId || session.lines ? collectionResult(session) : lessonResult(session, undefined, emit))
}
