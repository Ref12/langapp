/** The Japanese and Korean dictionaries: compact files (src/data/dictionary/<language>.json) loaded on first use, never part of the main bundle. */
export type DictLanguage = 'ja' | 'ko'
export const dictLanguages: readonly DictLanguage[] = ['ja', 'ko']
export const languageGlyph: Record<'zh' | DictLanguage, string> = { zh: '\u4E2D', ja: '\u65E5', ko: '\uD55C' }
export const languageLabel: Record<'zh' | DictLanguage, string> = { zh: 'Chinese', ja: 'Japanese', ko: 'Korean' }

interface RawDictionary { v: number; lang: DictLanguage; levels: string[]; pos: string[]; classes?: Record<string, string>; words: (string | number)[][]; grammar: [string, string, string, string, number, [string, string][]][] }

export interface DictWord {
  /** The entry id from the curriculum files: the knowledge record is "<language>:w:<id>". */
  id: string
  ref: string
  form: string
  reading: string
  meaning: string
  pos: string
  /** N5..N1 or TOPIK 1..6; undefined for words the parallel lessons added. */
  level?: string
  levelNo: number
  hanja?: string
  /** The word-forms class of a verb or adjective (src/core/forms); absent for other words. */
  class?: string
  /** Search keys, folded once when the dictionary loads. */
  key: { form: string; reading: string; meaning: string }
}
export interface DictGrammar { id: string; ref: string; pattern: string; english: string; note: string; level?: string; levelNo: number; examples: { target: string; english: string }[]; key: { pattern: string; meaning: string } }
export interface Dictionary { language: DictLanguage; levels: string[]; words: DictWord[]; grammar: DictGrammar[]; byId: Map<string, DictWord> }

const loaders: Record<DictLanguage, () => Promise<{ default: unknown }>> = {
  ja: () => import('../../data/dictionary/ja.json'),
  ko: () => import('../../data/dictionary/ko.json'),
}
const cache = new Map<DictLanguage, Promise<Dictionary>>()

/** Katakana to hiragana, width and case folded: the form searches compare. */
export const fold = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[\u30A1-\u30F6]/g, character => String.fromCharCode(character.charCodeAt(0) - 0x60))

export function buildDictionary(raw: RawDictionary): Dictionary {
  const language = raw.lang
  const words = raw.words.map((row): DictWord => {
    const levelNo = (row[5] as number) + 1
    const form = row[1] as string, reading = row[2] as string, meaning = row[3] as string
    return { id: row[0] as string, ref: language + ':w:' + row[0], form, reading, meaning, pos: raw.pos[row[4] as number] ?? '',
      level: levelNo ? raw.levels[levelNo - 1] : undefined, levelNo, hanja: row[6] as string | undefined, class: raw.classes?.[row[0] as string],
      key: { form: fold(form), reading: fold(reading), meaning: meaning.toLowerCase() } }
  })
  const grammar = raw.grammar.map((row): DictGrammar => ({ id: row[0], ref: language + ':g:' + row[0], pattern: row[1], english: row[2], note: row[3], levelNo: row[4] + 1,
    level: row[4] >= 0 ? raw.levels[row[4]] : undefined, examples: row[5].map(([target, english]) => ({ target, english })), key: { pattern: fold(row[1]), meaning: (row[2] + ' ' + row[3]).toLowerCase() } }))
  return { language, levels: raw.levels, words, grammar, byId: new Map(words.map(word => [word.id, word])) }
}

export function loadDictionary(language: DictLanguage): Promise<Dictionary> {
  let pending = cache.get(language)
  if (!pending) {
    pending = loaders[language]().then(module => buildDictionary(module.default as RawDictionary))
    cache.set(language, pending)
    pending.catch(() => { if (cache.get(language) === pending) cache.delete(language) })
  }
  return pending
}
/** For tests. */
export const loadedDictionary = (language: DictLanguage): boolean => cache.has(language)
export const resetDictionaries = (): void => cache.clear()

/** The knowledge record id of a Japanese or Korean word or grammar point (practice work uses the same ids). */
export const wordRef = (language: DictLanguage, id: string): string => language + ':w:' + id

// ---------------------------------------------------------------- search

export type Script = 'kana' | 'hangul' | 'han' | 'latin'
/** The script a query is typed in: kana beats Han (a mixed word is Japanese), Hangul is Korean, Han characters alone fit Chinese and Japanese. */
export function queryScript(query: string): Script {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return 'kana'
  if (/\p{Script=Hangul}/u.test(query)) return 'hangul'
  if (/\p{Script=Han}/u.test(query)) return 'han'
  return 'latin'
}
const stripArticle = (value: string) => value.replace(/^(?:to|a|an|the)\s+/, '')
function meaningRank(meaning: string, query: string, bare: string): number | undefined {
  let at = meaning.indexOf(query)
  if (at < 0 && bare !== query) at = meaning.indexOf(bare)
  if (at < 0) return undefined
  // An exact sense ("student", "to eat"), then a whole word inside a sense, then any substring.
  for (const sense of meaning.split(/ \| |; |, | \/ /)) if (sense === query || sense === bare || stripArticle(sense) === bare) return 2
  const before = at === 0 ? ' ' : meaning[at - 1]
  return /[\p{L}\p{N}]/u.test(before) ? 4 : 3
}

export interface OtherMatcher { empty: boolean; word(word: DictWord): number | undefined; grammar(item: DictGrammar): number | undefined }

/** Ranks like the Chinese matcher: 0 exact form or reading, 1 prefix, 1.5 contains, 2-4 meaning (exact sense, whole word, substring). */
export function makeOtherMatcher(raw: string): OtherMatcher {
  const query = fold(raw.trim()).replace(/\s+/g, ' ')
  if (!query) return { empty: true, word: () => 0, grammar: () => 0 }
  const bare = stripArticle(query)
  const script = queryScript(query)
  const spelled = script !== 'latin'
  const form = (value: string): number | undefined => value === query ? 0 : value.startsWith(query) ? 1 : value.includes(query) ? 1.5 : undefined
  return {
    empty: false,
    word(word) {
      let best: number | undefined
      const take = (value: number | undefined) => { if (value !== undefined && (best === undefined || value < best)) best = value }
      take(form(word.key.form)); take(form(word.key.reading))
      if (word.hanja && query.includes(word.hanja)) take(1)
      if (!spelled) take(meaningRank(word.key.meaning, query, bare))
      return best
    },
    grammar(item) {
      let best: number | undefined
      const take = (value: number | undefined) => { if (value !== undefined && (best === undefined || value < best)) best = value }
      take(form(item.key.pattern))
      if (!spelled) take(meaningRank(item.key.meaning, query, bare))
      return best
    },
  }
}
