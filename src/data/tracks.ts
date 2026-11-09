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

export function currentLanguageOf(preferences: Pick<Preferences, 'currentLanguage'>): string {
  return preferences.currentLanguage ?? DEFAULT_LANGUAGE
}

export function trackFor(language: string, available: Track[] = tracks): Track {
  return available.find(track => track.language === language) ?? available.find(track => track.language === DEFAULT_LANGUAGE) ?? available[0]
}

export type LessonStatus = 'done' | 'partial' | 'current' | 'upcoming' | 'none'

export interface LessonRow { lesson: Lesson; number: number; status: LessonStatus; completedAt?: number; label: string; part?: string; introduced: number; total: number }

/** What decides a lesson's status: the same knowledge set the New items sets read and write. */
export interface LessonProgress {
  /** Refs (e.g. "vocabulary:wo3--me") the learner already knows. */
  known: Map<string, number>
  /** The refs the next New items set will introduce, if any. */
  nextNew: Set<string>
  /** Maps a curriculum word id to the ref the study catalog uses for it. */
  refOf: (wordId: string) => string | undefined
  /** Refs some New items set can introduce (every study-group unit). Items outside it are left out of n and m. */
  reachable?: Set<string>
  /** Older per-lesson records (opening a lesson page and practising it). */
  records: { lessonId: string; completedAt?: number }[]
}

function baseTitle(lesson: Lesson): string { return lesson.title.replace(/\s*\/\s*Part \d+$/, '') }

/** Distinguishes repeated titles: "Colors and describing objects · 2/5". */
export function lessonLabel(track: Track, lesson: Lesson): { title: string; part?: string } {
  const title = baseTitle(lesson)
  const siblings = track.lessons.filter(other => other.curriculum.moduleId === lesson.curriculum.moduleId)
  const repeated = track.lessons.filter(other => baseTitle(other) === title).length > 1
  return repeated ? { title, part: `${siblings.indexOf(lesson) + 1}/${siblings.length}` } : { title }
}

/**
 * The track's lessons in order with their status. Done: every item the lesson teaches is known (or the lesson was
 * practised). Current: the lesson that holds the next New items set's first new item, else the first lesson not done.
 */
export function lessonRows(track: Track, progress: LessonProgress): LessonRow[] {
  const refsOf = (lesson: Lesson) => lesson.wordIds.map(progress.refOf).filter((ref): ref is string => ref !== undefined && (!progress.reachable || progress.reachable.has(ref)))
  const learnedAt = (lesson: Lesson) => {
    const times = refsOf(lesson).map(ref => progress.known.get(ref))
    return times.length && times.every(time => time !== undefined) ? Math.max(...(times as number[])) : undefined
  }
  const completed = (lesson: Lesson) => progress.records.find(item => item.lessonId === lesson.id)?.completedAt
  const isDone = (lesson: Lesson) => {
    return learnedAt(lesson) !== undefined || completed(lesson) !== undefined
  }
  const fromNext = track.lessons.find(lesson => !isDone(lesson) && refsOf(lesson).length > 0 && refsOf(lesson).some(ref => progress.nextNew.has(ref)))
  const current = fromNext ?? track.lessons.find(lesson => !isDone(lesson) && refsOf(lesson).length > 0)
  const introduced = (lesson: Lesson) => refsOf(lesson).filter(ref => progress.known.has(ref)).length
  return track.lessons.map((lesson, index) => {
    const count = introduced(lesson)
    return {
      lesson, number: index + 1, completedAt: isDone(lesson) ? completed(lesson) ?? learnedAt(lesson) : undefined,
      label: lessonLabel(track, lesson).title, part: lessonLabel(track, lesson).part, introduced: count, total: refsOf(lesson).length,
      status: lesson === current ? 'current' : isDone(lesson) ? 'done' : refsOf(lesson).length === 0 ? 'none' : count > 0 ? 'partial' : 'upcoming',
    } satisfies LessonRow
  })
}

/**
 * Lesson items no New items set can introduce (a sense missing from every study group), per lesson.
 * Pinned by a test so the study groups can be fixed later; `refOf` and `reachable` come from the study catalog.
 */
export function unreachableItems(track: Track, refOf: (wordId: string) => string | undefined, reachable: Set<string>): { lessonId: string; number: number; wordIds: string[] }[] {
  return track.lessons.flatMap((lesson, index) => {
    const wordIds = lesson.wordIds.filter(id => { const ref = refOf(id); return ref === undefined || !reachable.has(ref) })
    return wordIds.length ? [{ lessonId: lesson.id, number: index + 1, wordIds }] : []
  })
}
