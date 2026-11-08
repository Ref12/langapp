import type { Lesson, Preferences } from '../core/model'
import { curriculumLessons, curriculumLevels, type CurriculumLevel } from './curriculum'

/** One ordered course: a language, a display name, its levels and its lessons. */
export interface Track {
  id: string
  /** Short language code, the value of the "current language" setting. */
  language: string
  /** The language's name as shown to the learner, e.g. "Chinese". */
  name: string
  /** One-glyph label for the language switch. */
  glyph: string
  levels: CurriculumLevel[]
  lessons: Lesson[]
}

export const DEFAULT_LANGUAGE = 'zh'

/** The beginner Chinese course, built from the existing curriculum data (lesson ids unchanged). */
export const zhTrack: Track = { id: 'zh', language: 'zh', name: 'Chinese', glyph: '\u4E2D', levels: curriculumLevels, lessons: curriculumLessons }

/** Every track the app ships. Chinese is the only one for now. */
export const tracks: Track[] = [zhTrack]

/** Upcoming lessons can be opened to read but not practised until the learner reaches them. */
export const LOCK_UPCOMING_LESSONS = true

export function currentLanguageOf(preferences: Pick<Preferences, 'currentLanguage'>): string {
  return preferences.currentLanguage ?? DEFAULT_LANGUAGE
}

export function trackFor(language: string, available: Track[] = tracks): Track {
  return available.find(track => track.language === language) ?? available.find(track => track.language === DEFAULT_LANGUAGE) ?? available[0]
}

export type LessonStatus = 'done' | 'current' | 'upcoming'

export interface LessonRow { lesson: Lesson; number: number; status: LessonStatus; completedAt?: number; locked: boolean }

/** The track's lessons in order with their status. `currentId` is the next lesson. */
export function lessonRows(track: Track, progress: { lessonId: string; completedAt?: number }[], currentId: string | undefined, lock = LOCK_UPCOMING_LESSONS): LessonRow[] {
  const currentIndex = track.lessons.findIndex(lesson => lesson.id === currentId)
  return track.lessons.map((lesson, index) => {
    const completedAt = progress.find(item => item.lessonId === lesson.id)?.completedAt
    const status: LessonStatus = completedAt !== undefined ? 'done' : lesson.id === currentId ? 'current' : 'upcoming'
    const locked = lock && status === 'upcoming' && currentIndex >= 0 && index > currentIndex
    return { lesson, number: index + 1, status, completedAt, locked }
  })
}
