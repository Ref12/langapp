/**
 * The reader of the compact dictionary files (src/data/dictionary/<language>.json), loaded on first use. The Japanese app's look-up source (lookup-ja.ts) reads ja.json through it;
 * ko.json waits here for the Korean app. A build keeps only its own language's file (__PACK_DATA__), so the Chinese build ships neither.
 */
declare const __PACK_DATA__: string
export type DictLanguage = 'ja' | 'ko'

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

const absent = (name: string) => () => Promise.reject(new Error('The ' + name + ' dictionary is not part of this build.'))
// The literal tests below let the bundler drop a file the build does not carry.
const loaders: Record<DictLanguage, () => Promise<{ default: unknown }>> = {
  ja: (typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ja') ? () => import('../../data/dictionary/ja.json') : absent('Japanese'),
  ko: (typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ko') ? () => import('../../data/dictionary/ko.json') : absent('Korean'),
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

