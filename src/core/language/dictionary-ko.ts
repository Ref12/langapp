// The Korean Dictionary of the pack: Vocabulary and Grammar of the lessons, the TOPIK words as look-up (lookup-ko.ts), and the Hangul search over both.
// Ranks are on the scale of dictionary-search.ts and the Japanese ranker: 0 exact spelling, 1 prefix, 1.1-1.3 initial consonants, 1.4 inside, 1.5 romanization inside, 2-3 English.
// Spelling is compared after NFKC and lower case; romanization (Revised Romanization, as the app writes a reading) after dropping everything but letters.
import { forms as buildForm } from '../forms'
import { kindOfRecord } from '../forms/display'
import type { Unit } from '../study/catalog'
import type { PackDisplayForms } from './meta'
import { romanizeKorean } from './korean-reading'
import type { DictGrammar, DictWord } from './dictionary-file'
import type { LookupSearch, PackDictionary, PackLookup, UnitSearch } from './dictionary'

type CatalogUnit = Extract<Unit, { kind: 'vocabulary' | 'grammar' }>

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const lazy = <T,>(make: () => T): (() => T) => { let value: T | undefined; return () => (value ??= make()) }
export const foldSpelling = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
export const foldRomanization = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')
/** The initial consonants of a word: 학생 -> ㅎㅅ (characters that are not Hangul syllables are left out). */
export const initialsOf = (text: string): string => Array.from(text).map(char => { const code = char.codePointAt(0)! - 0xac00; return code >= 0 && code <= 11171 ? INITIALS[Math.floor(code / 588)] : '' }).join('')

export interface KoKeys { text: string[]; romaji: () => string[]; initials: () => string[]; ds: string }
const keysOfText = (text: string[], ds: string): KoKeys => ({ text, romaji: lazy(() => text.map(item => foldRomanization(romanizeKorean(item)))), initials: lazy(() => text.map(initialsOf)), ds })
const stripArticle = (value: string) => value.replace(/^(?:to|a|an|the)\s+/, '')
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u
const CONSONANTS = /^[\u3131-\u314e]+$/u

/** The rank of a set of keys for a query: undefined when it does not match. */
export function koreanRanker(query: string): { empty: boolean; rank(keys: KoKeys): number | undefined } {
  const lower = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!lower) return { empty: true, rank: () => 0 }
  const written = foldSpelling(lower)
  const hangul = HANGUL.test(written) || /[\u1100-\u11ff]/.test(written)
  const letters = lower.normalize('NFC').replace(/ /g, '') // compatibility jamo (ㅎ) stay as typed: NFKC would turn them into conjoining ones
  const initialsOnly = CONSONANTS.test(letters)
  const latin = !hangul && /^[\p{Script=Latin}\p{M}'\- ]+$/u.test(written) ? foldRomanization(written) : ''
  const bare = stripArticle(lower)
  return {
    empty: false,
    rank(keys) {
      let best: number | undefined
      const take = (value: number) => { if (best === undefined || value < best) best = value }
      if (initialsOnly) for (const key of keys.initials()) { if (key === letters) take(1.1); else if (key.startsWith(letters)) take(1.2) }
      else if (hangul) for (const key of keys.text) { if (key === written) take(0); else if (key.startsWith(written)) take(1); else if (key.includes(written)) take(1.4) }
      if (latin) for (const key of keys.romaji()) { if (key === latin) take(0); else if (key.startsWith(latin)) take(1); else if (key.includes(latin)) take(1.5) }
      if (!hangul && keys.ds) {
        const parts = keys.ds.split(/[;,/|]/).map(part => part.trim())
        if (parts.some(part => part === lower || stripArticle(part) === bare)) take(2)
        else if (keys.ds.includes(lower)) take(3)
      }
      return best
    },
  }
}

const unitKeys = new WeakMap<object, KoKeys>()
function keysOf(unit: CatalogUnit, offer: PackDisplayForms): KoKeys {
  const cached = unitKeys.get(unit.record)
  if (cached) return cached
  const text = new Set<string>()
  if (unit.kind === 'vocabulary') {
    const record = unit.record
    text.add(foldSpelling(record.ch))
    // every form the word can be shown in (a verb: polite, dictionary and formal), as the pack's forms engine builds it
    const kind = kindOfRecord(offer.language, record)
    if (record.cl && kind !== undefined) for (const choice of offer.choices) if (choice.kinds.includes(kind)) {
      const built = buildForm(offer.language, record.ch, record.cl, choice.id, { reading: record.pr })
      if (built) text.add(foldSpelling(built.surface))
    }
  } else { text.add(foldSpelling(unit.record.pt)); if (unit.record.st) text.add(foldSpelling(unit.record.st)) }
  const value = keysOfText([...text], unit.record.ds.toLowerCase())
  unitKeys.set(unit.record, value)
  return value
}

export function koreanUnitSearch(offer: PackDisplayForms, query: string): UnitSearch {
  const ranker = koreanRanker(query)
  return { empty: ranker.empty, rank: unit => ranker.empty ? 0 : ranker.rank(keysOf(unit, offer)) }
}

const lookupKeys = new WeakMap<object, KoKeys>()
const wordKeys = (word: DictWord): KoKeys => {
  let keys = lookupKeys.get(word)
  if (!keys) { keys = keysOfText([foldSpelling(word.form)], word.meaning.replace(/ [|/] /g, '; ').toLowerCase()); lookupKeys.set(word, keys) }
  return keys
}
const grammarKeys = (item: DictGrammar): KoKeys => {
  let keys = lookupKeys.get(item)
  if (!keys) { keys = keysOfText([foldSpelling(item.pattern)], item.english.toLowerCase()); lookupKeys.set(item, keys) }
  return keys
}
/** The same search as the catalog's, over look-up entries. */
export function koreanLookupSearch(query: string): LookupSearch {
  const ranker = koreanRanker(query)
  return { empty: ranker.empty, word: word => ranker.empty ? 0 : ranker.rank(wordKeys(word)), grammar: item => ranker.empty ? 0 : ranker.rank(grammarKeys(item)) }
}

/** The TOPIK list (src/data/dictionary/ko.json, read by core/language/dictionary-file.ts) less the entries the lessons already have. Its code and data load on demand (lookup-ko.ts). */
export const koLookup: PackLookup = { load: inCatalog => import('./lookup-ko').then(module => module.loadKoreanLookup(inCatalog)), levelName: level => level }

const noSection = { characters: false, phrases: false, draw: false, media: false }

/** Korean: Vocabulary and Grammar of the lessons, and the TOPIK words outside them as look-up. */
export const koDictionary = (offer: PackDisplayForms): PackDictionary => ({
  sections: noSection,
  intro: 'Every word and grammar point in your lessons, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.',
  placeholder: { vocabulary: 'Word, romanization, or English', grammar: 'Pattern, romanization, or English' },
  footnote: 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Look-up words: Korean-English Learners\u2019 Dictionary, National Institute of Korean Language (CC BY-SA 2.0 KR); TOPIK levels as given in that list.',
  searchUnits: query => koreanUnitSearch(offer, query),
  lookup: koLookup,
})
