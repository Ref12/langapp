// What a pack says about the Dictionary of its own language: which sections it has, its wording, and how a catalog word is found by a search.
// The Dictionary page asks the pack and never tests the language. Chinese's values are the strings and the search the page had before packs.
import { makeMatcher } from '../dictionary-search'
import { forms as buildForm } from '../forms'
import { kindOfClass } from '../forms/display'
import { kanaToRomaji, type RomajiOverrides } from '../reading/romaji'
import type { Unit } from '../study/catalog'
import type { PackDisplayForms } from './meta'
import { toHiragana } from './romanize'

export type CatalogUnit = Extract<Unit, { kind: 'vocabulary' | 'grammar' }>

/** A search over catalog units: the rank of a unit (lower is better; the scale of dictionary-search.ts), or undefined when it does not match. */
export interface UnitSearch { empty: boolean; rank(unit: CatalogUnit): number | undefined }

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
const foldText = (text: string): string => toHiragana(text.normalize('NFKC').toLowerCase()).replace(/\s+/g, ' ').trim()
const foldRomaji = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '').replace(/(ou|oo)/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e')

interface Keys { text: string[]; kana: string[]; romaji: string[]; ds: string }
const keysCache = new WeakMap<object, Keys>()

function keysOf(unit: CatalogUnit, offer: PackDisplayForms, overrides: RomajiOverrides): Keys {
  const cached = keysCache.get(unit.record)
  if (cached) return cached
  const text = new Set<string>(), kana = new Set<string>()
  if (unit.kind === 'vocabulary') {
    const record = unit.record
    text.add(foldText(record.ch)); kana.add(foldText(record.pr))
    // every form the word can be shown in (a verb: polite and dictionary), as the pack's forms engine builds it
    const kind = record.cl ? kindOfClass(offer.language, record.cl) : undefined
    if (record.cl && kind !== undefined) for (const choice of offer.choices) if (choice.kinds.includes(kind)) {
      const built = buildForm(offer.language, record.ch, record.cl, choice.id, { reading: record.pr })
      if (built) { text.add(foldText(built.surface)); kana.add(foldText(built.reading ?? record.pr)) }
    }
  } else {
    const record = unit.record
    text.add(foldText(record.pt)); if (record.st) text.add(foldText(record.st)); kana.add(foldText(record.pr))
  }
  const value = { text: [...text], kana: [...kana], romaji: [...kana].map(item => foldRomaji(kanaToRomaji(item, overrides))), ds: unit.record.ds.toLowerCase() }
  keysCache.set(unit.record, value)
  return value
}

const stripArticle = (value: string) => value.replace(/^(?:to|a|an|the)\s+/, '')
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/u

export function japaneseUnitSearch(offer: PackDisplayForms, query: string, overrides: RomajiOverrides = {}): UnitSearch {
  const lower = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!lower) return { empty: true, rank: () => 0 }
  const written = foldText(lower)
  const japanese = JAPANESE.test(written)
  const latin = !japanese && /^[\p{Script=Latin}\p{M}'\- ]+$/u.test(written) ? foldRomaji(written) : ''
  const bare = stripArticle(lower)
  return {
    empty: false,
    rank(unit) {
      const keys = keysOf(unit, offer, overrides)
      let best: number | undefined
      const take = (value: number) => { if (best === undefined || value < best) best = value }
      for (const key of [...keys.text, ...keys.kana]) { if (key === written) take(0); else if (key.startsWith(written)) take(1); else if (key.includes(written)) take(1.4) }
      if (latin) for (const key of keys.romaji) { if (key === latin) take(0); else if (key.startsWith(latin)) take(1); else if (key.includes(latin)) take(1.5) }
      if (!japanese && keys.ds) {
        const parts = keys.ds.split(/[;,/]/).map(part => part.trim())
        if (parts.some(part => part === lower || stripArticle(part) === bare)) take(2)
        else if (keys.ds.includes(lower)) take(3)
      }
      return best
    },
  }
}

/** Japanese: Vocabulary and Grammar of the lessons only in this stage. */
export const jaDictionary = (offer: PackDisplayForms): PackDictionary => ({
  sections: noSection,
  intro: 'Every word and grammar point in your lessons, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.',
  placeholder: { vocabulary: 'Word, reading, or English', grammar: 'Pattern, reading, or English' },
  footnote: 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading.',
  searchUnits: (query, romaji) => japaneseUnitSearch(offer, query, romaji),
})

/** A pack with no Dictionary of its own (Korean for now): nothing is offered, the search is the plain one. */
export const koDictionary: PackDictionary = { ...zhDictionary, sections: noSection, intro: '', footnote: '', placeholder: { vocabulary: 'Word, reading, or English', grammar: 'Pattern, reading, or English' } }
