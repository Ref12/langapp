import type { Catalog, Unit } from '../study/catalog'
import type { ParallelData, ParallelLanguage, ParallelLesson, ParallelPhrase } from '../parallel/data'
import { shortGloss } from '../parallel/data'
import type { DictWord } from './other'

export interface SameWord { language: 'zh' | ParallelLanguage; form: string; reading?: string; gloss: string; href: string; basis: 'lesson' | 'han' }

type Vocabulary = Extract<Unit, { kind: 'vocabulary' }>
const bySense = new WeakMap<Catalog, Map<string, Vocabulary>>()
const byForm = new WeakMap<Catalog, Map<string, Vocabulary[]>>()
function indexes(catalog: Catalog) {
  let senses = bySense.get(catalog), forms = byForm.get(catalog)
  if (!senses || !forms) {
    senses = new Map(); forms = new Map()
    for (const unit of catalog.units.values()) {
      if (unit.kind !== 'vocabulary') continue
      senses.set(unit.record.id, unit)
      const list = forms.get(unit.record.ch)
      if (list) list.push(unit); else forms.set(unit.record.ch, [unit])
    }
    bySense.set(catalog, senses); byForm.set(catalog, forms)
  }
  return { senses, forms }
}

const searchHref = (form: string, language: 'zh' | ParallelLanguage) => '#dictionary/vocabulary/all?q=' + encodeURIComponent(form) + '&lang=' + language
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'one', 'not'])
/** Whether a Chinese definition shares a whole English word (3+ letters) with the first senses of this word's meaning. */
export function sharesMeaning(meaning: string, zhDefinition: string): boolean {
  const target = zhDefinition.toLowerCase()
  const words = new Set(meaning.toLowerCase().split(' | ').slice(0, 3).join(' ').split(/[^a-z]+/).filter(word => word.length >= 3 && !STOP.has(word)))
  return [...words].some(word => new RegExp('(?:^|[^a-z])' + word + '(?:[^a-z]|$)').test(target))
}

/** The lessons that teach a word, in order. */
export const lessonsTeaching = (data: ParallelData, id: string): ParallelLesson[] => data.lessons.filter(lesson => lesson.words.some(word => word.entry === id))
export const phrasesUsing = (data: ParallelData, id: string): { lesson: number; phrase: ParallelPhrase }[] =>
  data.lessons.flatMap(lesson => lesson.phrases.filter(phrase => phrase.words.includes(id)).map(phrase => ({ lesson: lesson.number, phrase })))

/**
 * "Same word in": the Chinese entry a parallel lesson maps this word to (its sense), the same word in the other language through that
 * Chinese sense, and Chinese words with the same Han form and a shared meaning (e.g. 学生) when no lesson maps it.
 */
export function sameWordIn(language: ParallelLanguage, word: DictWord, data: Partial<Record<ParallelLanguage, ParallelData>>, catalog: Catalog | undefined, lookup: (language: ParallelLanguage, id: string) => DictWord | undefined): SameWord[] {
  const own = data[language]
  const found: SameWord[] = []
  const senseIds: string[] = []
  for (const lesson of own?.lessons ?? []) for (const sense of lesson.senses) if (sense.entry === word.id && sense.status !== 'no-equivalent' && !senseIds.includes(sense.zh)) senseIds.push(sense.zh)
  const zhSeen = new Set<string>()
  const addChinese = (unit: Vocabulary, basis: 'lesson' | 'han') => {
    if (zhSeen.has(unit.record.id)) return
    zhSeen.add(unit.record.id)
    found.push({ language: 'zh', form: unit.record.ch, reading: unit.record.pr, gloss: shortGloss(unit.record.ds), href: searchHref(unit.record.ch, 'zh'), basis })
  }
  if (catalog) {
    const { senses, forms } = indexes(catalog)
    for (const id of senseIds) { const unit = senses.get(id); if (unit) addChinese(unit, 'lesson') }
    // Shared Han characters: a Chinese word spelled the same (or the Korean Hanja) with a meaning in common.
    for (const spelling of new Set([word.form, word.hanja].filter((value): value is string => !!value && /^\p{Script=Han}+$/u.test(value)))) {
      for (const unit of forms.get(spelling) ?? []) if (sharesMeaning(word.meaning, unit.record.ds)) addChinese(unit, 'han')
    }
  }
  // Between Japanese and Korean through the shared Chinese sense.
  const other: ParallelLanguage = language === 'ja' ? 'ko' : 'ja'
  const otherData = data[other]
  const seen = new Set<string>()
  if (otherData) for (const lesson of otherData.lessons) for (const sense of lesson.senses) {
    if (!sense.entry || !senseIds.includes(sense.zh) || (sense.status !== 'word' && sense.status !== 'covered-by') || seen.has(sense.entry)) continue
    seen.add(sense.entry)
    const entry = otherData.entries[sense.entry]
    const full = lookup(other, sense.entry)
    if (entry) found.push({ language: other, form: entry.target, reading: entry.reading, gloss: shortGloss(full?.meaning ?? entry.english), href: searchHref(entry.target, other), basis: 'lesson' })
  }
  return found
}
