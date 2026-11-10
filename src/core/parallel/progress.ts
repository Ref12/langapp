import { db } from '../database'
import { savePreferences } from '../learning'
import { isParallelLanguage } from './data'
import { parallelLessonId } from '../language/refs'
import type { ParallelLanguage } from '../language/ids'

/** Makes a track the current language; opening a Japanese or Korean track also records it as started (once). */
export async function startTrack(language: string): Promise<void> {
  const current = await db.preferences.get('workspace')
  const started = current?.startedTracks ?? []
  if (!isParallelLanguage(language)) return savePreferences({ currentLanguage: language })
  await savePreferences({ currentLanguage: language, startedTracks: started.includes(language) ? started : [...started, language] })
}

/** Records a ja/ko lesson as studied: additive, in the lessons table under a language-prefixed id (e.g. ja:lesson:1). */
export async function markParallelStudied(language: ParallelLanguage, number: number, now = Date.now()): Promise<void> {
  const lessonId = parallelLessonId(language, number)
  await db.transaction('rw', db.lessons, async () => {
    const existing = await db.lessons.get(lessonId)
    if (existing?.completedAt !== undefined) return
    await db.lessons.put({ lessonId, startedAt: existing?.startedAt ?? now, completedAt: now })
  })
}

/** Lesson number to when it was studied, for one language. */
export function studiedLessons(lessons: { lessonId: string; completedAt?: number }[], language: ParallelLanguage): Map<number, number> {
  const out = new Map<number, number>()
  const prefix = `${language}:lesson:`
  for (const lesson of lessons) if (lesson.lessonId.startsWith(prefix) && lesson.completedAt !== undefined) out.set(Number(lesson.lessonId.slice(prefix.length)), lesson.completedAt)
  return out
}

/** The first lesson of the track that is not studied yet (Next), or undefined when all are. */
export function nextParallelLesson(studied: Map<number, number>, count: number): number | undefined {
  for (let number = 1; number <= count; number++) if (!studied.has(number)) return number
  return undefined
}
