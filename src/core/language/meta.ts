// The identity part of the language packs: names, tags, feature switches. Plain data with no data files behind it, so the build scripts can import it (packs.ts adds the data).

import { zhTrack } from '../../data/tracks'
import { AREAS, type Area, type Features } from './areas'
import type { SpeechLocale } from '../assistant/contracts'
import { isLanguageId, type LanguageId } from './ids'
import { kanaInput, pinyinInput, selfMarkedInput, type ReadingInput } from './reading-input'
import { jaIdentity, koIdentity, zhIdentity, type PhraseIdentity } from './phrase-identity'
import { zhWriting, jaWriting, koWriting, type PackWriting } from './writing'
import { jaSentence, koSentence, zhSentence, type SentenceForms } from './sentence-forms'
import { jaWordForms, koWordForms, zhWordForms, type PackWordForms } from './word-forms'
import { jaPractice, koPractice, zhPractice, type PracticeWording } from './practice-wording'
import { jaPage, koPage, zhPage, type PracticePage } from './practice-page'
import { jaDictionary, koDictionary, zhDictionary, type PackDictionary } from './dictionary'

/** The wording the screens use about the language; Chinese's values are the literal strings the screens had before packs. */
export interface PackWording {
  /** The language's name inside a sentence: "Mandarin", "Japanese". */
  language: string
  /** A band's name, {n} being its number: "HSK {n}", "Level {n}". */
  band: string
  /** What the line of readings under the text is called, in lower case: "pinyin", "readings". */
  reading: string
  /** What the learner works toward, in a sentence: "the HSK goals", "your goals". */
  goals: string
}

/** How readings are written: pinyin per Han character (annotated with Han runs), or one plain reading line under the text. */
export type ReadingStyle = 'pinyin' | 'line'

/** How a reading line is written when a pack offers a choice: in kana, or in romaji made from the kana. */
export type ReadingScript = 'kana' | 'romaji'

/** One form a learner may choose to see verbs in: its id in the pack's forms table, and the kinds of word it is shown for (the kinds the form is joined for in that table). */
export interface DisplayFormChoice { id: string; kinds: string[] }
/** The forms a pack lets the learner choose for display (Japanese: polite or dictionary), the default, and a sample word for the option labels. A pack without a forms table has none. */
export interface PackDisplayForms {
  /** The language of the forms engine (src/core/forms). */
  language: 'ja' | 'ko'
  choices: DisplayFormChoice[]
  default: string
  /** The word the option labels show their form of: "Polite form (勉強します)". */
  sample: { ch: string; pr: string; cl: string }
}
/** The reading styles a pack offers and the default; a pack that offers none keeps its own reading format setting. */
export interface PackReadingStyles {
  choices: ReadingScript[]
  default: ReadingScript
  /** A sample reading in the option labels, as the tokens of a sentence's reading line: ["べんきょう", "します"]. */
  sample: string[]
}

/** What a pack says about a sentence's identity and its tiles (phrase-identity.ts): phraseKey(text) and segment(text, words). */
export interface PackMeta extends PhraseIdentity, SentenceForms, PracticePage, PackWordForms {
  id: LanguageId
  /** The language's English name, e.g. "Japanese". */
  name: string
  nativeName: string
  /** The language tag of the learned language (content), also the manifest's `lang` outside Chinese. */
  learningTag: string
  /** The `<html lang>` of the app's own interface (English today in every build). */
  htmlLang: string
  features: Features
  wording: PackWording
  /** What the Practice page and the exercise engine say about the language and its reading (practice-wording.ts). */
  practiceWording: PracticeWording
  /** How a typed reading is marked, previewed and read back (reading-input.ts). */
  readingInput: ReadingInput
  /** Which stroke data the build writes with and which characters its write, stroke and introduction views take (writing.ts). */
  writing: PackWriting
  /** The locale the learned language is spoken in ("Hear", snippet actions, the voice setting). */
  speechLocale: SpeechLocale
  /** One glyph that stands for the language in the Lab app switch. */
  glyph: string
  /** Whether a Lab app of this language is published (at lab/ for Chinese, lab/<id>/ for the others): the app switch lists exactly these. Korean has none yet. */
  published: boolean
  readings: ReadingStyle
  /** Whether the knowledge counts include a count of Han characters. */
  countsCharacters: boolean
  /** Which form a verb is shown in, as a setting. Absent: no setting, words are shown as stored. */
  displayForms?: PackDisplayForms
  /** Kana or romaji for the reading line, as a setting. Absent: no setting. */
  readingStyles?: PackReadingStyles
  /** The Dictionary of the language: its sections, wording and search (dictionary.ts). */
  dictionary: PackDictionary
}

/** "HSK 1" or "Level 1". */
export const bandName = (pack: Pick<PackMeta, 'wording'>, band: string | number): string => pack.wording.band.replace('{n}', String(band))
/** The reading's name with a capital: "Pinyin", "Readings". */
export const readingTitle = (pack: Pick<PackMeta, 'wording'>): string => pack.wording.reading.charAt(0).toUpperCase() + pack.wording.reading.slice(1)

const everything = Object.fromEntries(AREAS.map(area => [area, true])) as Features
const nothing = Object.fromEntries(AREAS.map(area => [area, false])) as Features

const jaDisplayForms: PackDisplayForms = { language: 'ja', choices: [{ id: 'masu', kinds: ['verb'] }, { id: 'dict', kinds: [] }], default: 'masu', sample: { ch: '\u52C9\u5F37\u3059\u308B', pr: '\u3079\u3093\u304D\u3087\u3046\u3059\u308B', cl: 'suru-compound' } }

export const zhMeta: PackMeta = { id: 'zh', name: zhTrack.name, nativeName: '\u4E2D\u6587', learningTag: 'zh-Hans', htmlLang: 'en', features: everything,
  wording: { language: 'Mandarin', band: 'HSK {n}', reading: 'pinyin', goals: 'the HSK goals' }, speechLocale: 'zh-Hans', glyph: '\u4E2D', published: true, readings: 'pinyin', countsCharacters: true, practiceWording: zhPractice, readingInput: pinyinInput,
  dictionary: zhDictionary, writing: zhWriting, ...zhIdentity, ...zhSentence, ...zhPage, ...zhWordForms }
export const jaMeta: PackMeta = { id: 'ja', name: 'Japanese', nativeName: '\u65E5\u672C\u8A9E', learningTag: 'ja', htmlLang: 'en', features: { ...nothing, writing: true, dictionary: true },
  wording: { language: 'Japanese', band: 'Level {n}', reading: 'readings', goals: 'your goals' }, speechLocale: 'ja-JP', glyph: '\u65E5', published: true, readings: 'line', countsCharacters: false, practiceWording: jaPractice, readingInput: kanaInput,
  writing: jaWriting, ...jaIdentity, ...jaSentence, ...jaPage, ...jaWordForms,
  displayForms: jaDisplayForms, dictionary: jaDictionary(jaDisplayForms),
  readingStyles: { choices: ['kana', 'romaji'], default: 'kana', sample: ['\u3079\u3093\u304D\u3087\u3046', '\u3057\u307E\u3059'] } }
export const koMeta: PackMeta = { id: 'ko', name: 'Korean', nativeName: '\uD55C\uAD6D\uC5B4', learningTag: 'ko', htmlLang: 'en', features: { ...nothing, writing: true },
  wording: { language: 'Korean', band: 'Level {n}', reading: 'readings', goals: 'your goals' }, speechLocale: 'ko-KR', glyph: '\uD55C', published: true, readings: 'line', countsCharacters: false, practiceWording: koPractice, readingInput: selfMarkedInput,
  dictionary: koDictionary, writing: koWriting, ...koIdentity, ...koSentence, ...koPage, ...koWordForms }

export const METAS: Record<LanguageId, PackMeta> = { zh: zhMeta, ja: jaMeta, ko: koMeta }

export function metaFor(id: LanguageId): PackMeta {
  if (!isLanguageId(id)) throw new Error('Unknown language "' + String(id) + '"')
  return METAS[id]
}

export const isAreaOn = (pack: PackMeta, area: Area | undefined): boolean => area === undefined || pack.features[area]
