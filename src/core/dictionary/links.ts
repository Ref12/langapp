import type { ParallelData, ParallelLesson, ParallelPhrase } from '../parallel/data'

/** The lessons that teach a word, in order. */
export const lessonsTeaching = (data: ParallelData, id: string): ParallelLesson[] => data.lessons.filter(lesson => lesson.words.some(word => word.entry === id))
export const phrasesUsing = (data: ParallelData, id: string): { lesson: number; phrase: ParallelPhrase }[] =>
  data.lessons.flatMap(lesson => lesson.phrases.filter(phrase => phrase.words.includes(id)).map(phrase => ({ lesson: lesson.number, phrase })))
