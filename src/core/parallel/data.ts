/** Japanese and Korean parallel lessons: one lesson per v2 HSK 1 group. The JSON is loaded lazily, never part of the main bundle. */
export type ParallelLanguage = 'ja' | 'ko'
export const parallelLanguages: readonly ParallelLanguage[] = ['ja', 'ko']
export const isParallelLanguage = (value: unknown): value is ParallelLanguage => value === 'ja' || value === 'ko'

export interface ParallelEntry { target: string; reading?: string; english: string; /** The short lesson gloss shown on cards; `english` stays the full dictionary definition. */ gloss?: string; pos?: string; new?: boolean; /** The word-forms class of a verb or adjective (src/core/forms). */ class?: string }
export interface ParallelGrammar { pattern: string; english: string; new?: boolean }
export interface ParallelSense { zh: string; status: 'word' | 'covered-by' | 'grammar' | 'no-equivalent'; entry: string | null; grammar?: string; note?: string }
/** An inflected token carries its form id and span: the number of following tokens that belong to the same surface (勉強し + ます). */
export interface ParallelToken { t: string; w?: string; g?: string; form?: string; span?: number }
/** An irregular form of a word: a lesson item of its own (ja:f:<lemma>:<form>). */
export interface ParallelFormItem { lemma: string; form: string; class: string; entry: string; surface: string; reading?: string; lesson: number; spellings: string[] }
export interface ParallelPhrase { id: number; text: string; reading?: string; en: string; zh: string; tokens: ParallelToken[]; words: string[]; grammar: string[]; forms?: string[] }
export interface ParallelLesson {
  number: number
  words: { entry: string; status: string; zh: string[]; new?: boolean }[]
  senses: ParallelSense[]
  grammar: string[]
  /** Irregular form items the lesson teaches (refs into formItems). */
  forms?: string[]
  phrases: ParallelPhrase[]
}
export interface ParallelData { schemaVersion: number; language: ParallelLanguage; entries: Record<string, ParallelEntry>; grammar: Record<string, ParallelGrammar>; formItems?: Record<string, ParallelFormItem>; lessons: ParallelLesson[] }

const loaders: Record<ParallelLanguage, () => Promise<{ default: unknown }>> = {
  ja: () => import('../../data/parallel/ja.json'),
  ko: () => import('../../data/parallel/ko.json'),
}
const cache = new Map<ParallelLanguage, Promise<ParallelData>>()

export function loadParallel(language: ParallelLanguage): Promise<ParallelData> {
  let pending = cache.get(language)
  if (!pending) {
    pending = Promise.all([loaders[language](), import('../../data/parallel/glosses.json')]).then(([module, glosses]) => {
      const data = module.default as ParallelData
      const short = (glosses.default as Record<ParallelLanguage, Record<string, string>>)[language] ?? {}
      for (const [id, entry] of Object.entries(data.entries)) if (short[id] && !entry.gloss) entry.gloss = short[id]
      return data
    })
    cache.set(language, pending)
    pending.catch(() => { if (cache.get(language) === pending) cache.delete(language) })
  }
  return pending
}

/** For tests. */
export const loadedParallel = (language: ParallelLanguage): boolean => cache.has(language)
export const resetParallel = (): void => cache.clear()

export const LESSON_COUNT = 87
export const parallelLessonId = (language: ParallelLanguage, number: number): string => `${language}:lesson:${number}`
/** A lesson id of a parallel track (kept in the lessons table next to the Chinese v1 ids). */
export const isParallelLessonId = (id: string): boolean => /^(?:ja|ko):lesson:[1-9]\d*$/.test(id)

/** The lesson's new words, in order, without repeats of the same entry. */
export function lessonWords(data: ParallelData, lesson: ParallelLesson): (ParallelEntry & { id: string })[] {
  const seen = new Set<string>()
  const out: (ParallelEntry & { id: string })[] = []
  for (const word of lesson.words) {
    const entry = data.entries[word.entry]
    if (!entry || seen.has(word.entry)) continue
    seen.add(word.entry)
    out.push({ ...entry, id: word.entry })
  }
  return out
}

const TITLE_ITEMS = 5
/** Row title: the lesson's first distinct words, as the Chinese rows list theirs. */
export const lessonTitle = (data: ParallelData, lesson: ParallelLesson): string =>
  lessonWords(data, lesson).slice(0, TITLE_ITEMS).map(word => word.target).join('\u2009\u00B7\u2009')

/** A short gloss: the first sense of a dictionary definition. */
export const shortGloss = (english: string): string => english.split(' | ')[0].replace(/^1\.\s*/, '')
/** What a card shows for a word: its short lesson gloss, else the first sense of its definition. */
export const glossOf = (entry: { english: string; gloss?: string }): string => entry.gloss ?? shortGloss(entry.english)

export interface CardLine { language: ParallelLanguage; target: string; reading?: string; lesson: number }
const senseMaps = new WeakMap<ParallelData, Map<string, CardLine>>()

/** The line a Chinese vocabulary sense gets on its card in this language: the mapped word (or the word covering it) and its lesson. */
export function cardLineFor(data: ParallelData, zhSenseId: string): CardLine | undefined {
  let map = senseMaps.get(data)
  if (!map) {
    map = new Map()
    for (const lesson of data.lessons) for (const sense of lesson.senses) {
      if ((sense.status !== 'word' && sense.status !== 'covered-by') || !sense.entry || map.has(sense.zh)) continue
      const entry = data.entries[sense.entry]
      if (entry) map.set(sense.zh, { language: data.language, target: entry.target, reading: entry.reading, lesson: lesson.number })
    }
    senseMaps.set(data, map)
  }
  return map.get(zhSenseId)
}
