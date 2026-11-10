import type { ParallelLanguage } from '../language/ids'

// Reading only: nothing writes a ja:lesson:N row any more (the old lesson screens are gone), but the rows an older version wrote are still read (the Dictionary's lesson links).

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
