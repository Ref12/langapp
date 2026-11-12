// What a pack says about the Dictionary of its own language: which sections it has, its wording, and how a catalog word is found by a search.
// The Dictionary page asks the pack and never tests the language. Chinese's values are the strings and the search the page had before packs.
import { makeMatcher } from '../dictionary-search'
import { forms as buildForm } from '../forms'
import { kindOfRecord } from '../forms/display'
import { kanaToRomaji, type RomajiOverrides } from '../reading/romaji'
import type { Unit } from '../study/catalog'
import type { PackDisplayForms, ReadingScript } from './meta'
import { toHiragana } from './romanize'
import type { DictGrammar, DictWord } from './dictionary-file'


export type CatalogUnit = Extract<Unit, { kind: 'vocabulary' | 'grammar' }>

/** A search over catalog units: the rank of a unit (lower is better; the scale of dictionary-search.ts), or undefined when it does not match. */
export interface UnitSearch { empty: boolean; rank(unit: CatalogUnit): number | undefined }

/** The look-up words of a pack: entries of a larger list that are not in the pack catalog, shown beside the lesson words and never studied. */
export interface LookupSource { words: DictWord[]; grammar: DictGrammar[]; search(query: string, romaji?: RomajiOverrides): LookupSearch }
/** A search over look-up entries on the same rank scale as UnitSearch. */
export interface LookupSearch { empty: boolean; word(word: DictWord): number | undefined; grammar(item: DictGrammar): number | undefined }
export interface PackLookup {
  /** Loads the look-up entries on demand (a dynamic import): every entry of the list whose id is not a catalog id. */
  load(inCatalog: (id: string) => boolean): Promise<LookupSource>
  /** How a look-up level is named, when the pack has a name for it; absent: the level as written in the data. */
  levelName?(level: string): string
}

/** What a phrase search matches: the sentence, its reading as the bank writes it, and the English. */
export interface PhraseSearchRow { text: string; reading: string; en: string }
/** A search over phrases on the same rank scale as UnitSearch. */
export interface PhraseSearch { empty: boolean; rank(row: PhraseSearchRow): number | undefined }
/** How the Phrases section speaks for a pack that is not Chinese: its wording, the language tag of the cells, the reading column and the search. Absent: the Chinese section as it was. */
export interface PackPhrases {
  /** The sentence under the heading of the section. */
  intro: string
  /** The search box's placeholder. */
  placeholder: string
  /** The column headings of the sentence and of its reading. */
  columns: { text: string; reading: string }
  /** The language tag of the sentence cells and of the word links. */
  lang: string
  /** The reading column for the reading setting (kana, romaji, hangul, romanized): the text of a row, or undefined when the column is hidden. */
  reading(row: { text: string; reading: string }, style: ReadingScript | undefined, romaji?: RomajiOverrides): string | undefined
  /** The pack's own folding, over the sentence, its reading and the English. */
  search(query: string, romaji?: RomajiOverrides): PhraseSearch
}

/** What a character of the Characters section is searched by: itself and its own reading (a kana: its sound). */
export interface CharacterSearchRow { character: string; reading?: string }
/** A search over characters on the same rank scale as UnitSearch. */
export interface CharacterSearch { empty: boolean; rank(row: CharacterSearchRow): number | undefined }
/** How the Characters section speaks for a pack with its own list (PackWriting.characterList): its wording and its search. */
export interface PackCharacters {
  title: string
  /** The sentence under the heading. */
  intro: string
  /** The note above the list. */
  note: string
  placeholder: string
  search(query: string, romaji?: RomajiOverrides): CharacterSearch
}

export interface PackDictionary {
  /** The sections beyond Vocabulary and Grammar, and the Draw box of the search: a section that is off has no tab and a link to it lands on Vocabulary. */
  sections: { characters: boolean; phrases: boolean; draw: boolean; media: boolean }
  /** The sentence under the heading of the Vocabulary and Grammar sections. */
  intro: string
  /** The search box's placeholder in Vocabulary and in Grammar. */
  placeholder: { vocabulary: string; grammar: string }
  /** The note under the Vocabulary and Grammar lists. */
  footnote: string
  /** How the search text finds a catalog word or grammar point. romaji: the hand-written romaji of the pack's readings. */
  searchUnits(query: string, romaji?: RomajiOverrides): UnitSearch
  /** A look-up source beside the catalog (Japanese: the JLPT words outside the lessons); absent when the pack has none. */
  lookup?: PackLookup
  /** The Characters section's wording and search for a pack with its own character list; absent for Chinese, whose section keeps its own. */
  characters?: PackCharacters
  /** The Phrases section's wording, reading and search; absent for Chinese, whose section keeps its own. */
  phrases?: PackPhrases
}

const everySection = { characters: true, phrases: true, draw: true, media: true }
const noSection = { characters: false, phrases: false, draw: false, media: false }

function pinyinSearch(query: string): UnitSearch {
  const matcher = makeMatcher(query)
  return { empty: matcher.empty, rank: unit => matcher.empty ? 0 : matcher.rank({ text: [unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt], pr: unit.record.pr, ds: unit.record.ds }) }
}

export const zhDictionary: PackDictionary = {
  sections: everySection,
  intro: 'Every HSK 1-6 sense and construction in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.',
  placeholder: { vocabulary: 'Character, pinyin, or meaning', grammar: 'Pattern, pinyin, or meaning' },
  footnote: 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Writing practice is available in Characters and is tracked separately. The inventory follows the November 2025 HSK examination syllabus; it is an AI-assisted editorial draft, not an official sense list.',
  searchUnits: pinyinSearch,
}

// Japanese search. Text and kana are compared after NFKC (so width does not matter), lower case and katakana-to-hiragana; romaji after
// dropping macrons and apostrophes and writing a long vowel short (ou, oo, uu, aa, ii, ee -> o, u, a, i, e), on both sides: toukyou, tōkyō and tokyo all find 東京.
export const foldText = (text: string): string => toHiragana(text.normalize('NFKC').toLowerCase()).replace(/\s+/g, ' ').trim()
export const foldRomaji = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '').replace(/(ou|oo)/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e')

export interface Keys { text: string[]; kana: string[]; romaji: () => string[]; ds: string }
export const lazy = <T,>(make: () => T): (() => T) => { let value: T | undefined; return () => (value ??= make()) }
const keysCache = new WeakMap<object, Keys>()

function keysOf(unit: CatalogUnit, offer: PackDisplayForms, overrides: RomajiOverrides): Keys {
  const cached = keysCache.get(unit.record)
  if (cached) return cached
  const text = new Set<string>(), kana = new Set<string>()
  if (unit.kind === 'vocabulary') {
    const record = unit.record
    text.add(foldText(record.ch)); kana.add(foldText(record.pr))
    // every form the word can be shown in (a verb: polite and dictionary), as the pack's forms engine builds it
    const kind = kindOfRecord(offer.language, record)
    if (record.cl && kind !== undefined) for (const choice of offer.choices) if (choice.kinds.includes(kind)) {
      const built = buildForm(offer.language, record.ch, record.cl, choice.id, { reading: record.pr })
      if (built) { text.add(foldText(built.surface)); kana.add(foldText(built.reading ?? (offer.language === 'ko' ? built.surface : record.pr))) }
    }
  } else {
    const record = unit.record
    text.add(foldText(record.pt)); if (record.st) text.add(foldText(record.st)); kana.add(foldText(record.pr))
  }
  const value = { text: [...text], kana: [...kana], romaji: lazy(() => [...kana].map(item => foldRomaji(kanaToRomaji(item, overrides)))), ds: unit.record.ds.toLowerCase() }
  keysCache.set(unit.record, value)
  return value
}

const stripArticle = (value: string) => value.replace(/^(?:to|a|an|the)\s+/, '')
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/u

/** The rank of a set of keys for a query: 0 exact, 1 prefix, 1.4-1.5 inside, 2-3 English. undefined: no match. */
export function japaneseRanker(query: string): { empty: boolean; rank(keys: Keys): number | undefined } {
  const lower = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!lower) return { empty: true, rank: () => 0 }
  const written = foldText(lower)
  const japanese = JAPANESE.test(written)
  const latin = !japanese && /^[\p{Script=Latin}\p{M}'\- ]+$/u.test(written) ? foldRomaji(written) : ''
  const bare = stripArticle(lower)
  return {
    empty: false,
    rank(keys) {
      let best: number | undefined
      const take = (value: number) => { if (best === undefined || value < best) best = value }
      for (const key of [...keys.text, ...keys.kana]) { if (key === written) take(0); else if (key.startsWith(written)) take(1); else if (key.includes(written)) take(1.4) }
      if (latin) for (const key of keys.romaji()) { if (key === latin) take(0); else if (key.startsWith(latin)) take(1); else if (key.includes(latin)) take(1.5) }
      if (!japanese && keys.ds) {
        const parts = keys.ds.split(/[;,/]/).map(part => part.trim())
        if (parts.some(part => part === lower || stripArticle(part) === bare)) take(2)
        else if (keys.ds.includes(lower)) take(3)
      }
      return best
    },
  }
}

export function japaneseUnitSearch(offer: PackDisplayForms, query: string, overrides: RomajiOverrides = {}): UnitSearch {
  const ranker = japaneseRanker(query)
  return { empty: ranker.empty, rank: unit => ranker.empty ? 0 : ranker.rank(keysOf(unit, offer, overrides)) }
}

/** The JLPT list (src/data/dictionary/ja.json, read by the one reader in core/language/dictionary-file.ts) less the entries the lessons already have. Its code and data load on demand (lookup-ja.ts). */
export const jaLookup: PackLookup = { load: inCatalog => import('./lookup-ja').then(module => module.loadJapaneseLookup(inCatalog)) }

const phraseKeys = new WeakMap<object, Keys>()
/** Japanese phrase search: the sentence and its kana after the same folding as a word; romaji from the kana with long vowels folded; the English. */
export function japanesePhraseSearch(query: string, overrides: RomajiOverrides = {}): PhraseSearch {
  const ranker = japaneseRanker(query)
  const keysOfRow = (row: PhraseSearchRow): Keys => {
    let keys = phraseKeys.get(row)
    if (!keys) { const kana = foldText(row.reading); keys = { text: [foldText(row.text)], kana: [kana], romaji: lazy(() => [foldRomaji(kanaToRomaji(kana, overrides))]), ds: row.en.toLowerCase() }; phraseKeys.set(row, keys) }
    return keys
  }
  return { empty: ranker.empty, rank: row => ranker.empty ? 0 : ranker.rank(keysOfRow(row)) }
}

const characterKeys = new WeakMap<object, Keys>()
/** Japanese character search: the character (a katakana letter also by its hiragana), its kana sound and its romaji with long vowels folded. */
export function japaneseCharacterSearch(query: string, overrides: RomajiOverrides = {}): CharacterSearch {
  const ranker = japaneseRanker(query)
  const keysOfRow = (row: CharacterSearchRow): Keys => {
    let keys = characterKeys.get(row)
    if (!keys) {
      const kana = row.reading ? foldText(row.reading.split(' \u00b7 ')[0]) : ''
      keys = { text: [foldText(row.character)], kana: kana ? [kana] : [], romaji: lazy(() => kana ? [foldRomaji(kanaToRomaji(kana, overrides))] : []), ds: '' }
      characterKeys.set(row, keys)
    }
    return keys
  }
  return { empty: ranker.empty, rank: row => ranker.empty ? 0 : ranker.rank(keysOfRow(row)) }
}

/** The Japanese Characters section: kana and kanji to practise writing. */
export const jaCharacters: PackCharacters = {
  title: 'Kana and kanji, one stroke at a time.',
  intro: 'Hiragana and katakana, then the kanji of your lesson words. Practice writing any of them here; this is separate from the writing in Practice sessions, which takes kanji only.',
  note: 'Kana are in table order, then the kanji by the lesson that first uses them. All kanji adds every kanji with a stroke guide, for look-up. A kanji card shows the lesson words that use it, with their readings.',
  placeholder: 'Character, reading, or romaji',
  search: japaneseCharacterSearch,
}

/** The Japanese Phrases section: the lesson sentences with their kana, or the romaji made from it. */
export const jaPhrases: PackPhrases = {
  intro: 'Every sentence of the lessons, with the words and grammar it uses. A sentence is ready when you know all its words and grammar.',
  placeholder: 'Japanese, reading, or English',
  columns: { text: 'Japanese', reading: 'Reading' },
  lang: 'ja',
  reading: (row, style, romaji) => style === 'romaji' ? kanaToRomaji(row.reading, romaji) : row.reading,
  search: japanesePhraseSearch,
}

/** Japanese: Vocabulary and Grammar of the lessons, the lesson sentences as Phrases, and the JLPT words outside them as look-up. */
export const jaDictionary = (offer: PackDisplayForms): PackDictionary => ({
  sections: { ...noSection, phrases: true, characters: true },
  phrases: jaPhrases,
  characters: jaCharacters,
  intro: 'Every word and grammar point in your lessons, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.',
  placeholder: { vocabulary: 'Word, reading, or English', grammar: 'Pattern, reading, or English' },
  footnote: 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Look-up words: JMdict/EDICT, the Electronic Dictionary Research and Development Group (EDRDG); JLPT levels from Jonathan Waller\u2019s JLPT Resources.',
  searchUnits: (query, romaji) => japaneseUnitSearch(offer, query, romaji),
  lookup: jaLookup,
})

export { koDictionary } from './dictionary-ko'
