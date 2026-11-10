// The identity part of the language packs: names, tags, feature switches. Plain data with no data files behind it, so the build scripts can import it (packs.ts adds the data).

import { zhTrack, jaTrack, koTrack } from '../../data/tracks'
import { AREAS, type Area, type Features } from './areas'
import type { SpeechLocale } from '../assistant/contracts'
import { isLanguageId, type LanguageId } from './ids'

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

export interface PackMeta {
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
  /** The locale the learned language is spoken in ("Hear", snippet actions, the voice setting). */
  speechLocale: SpeechLocale
  /** Whether the build offers the course-track selector (a build with one language has nothing to choose). */
  courseTracks: boolean
  readings: ReadingStyle
  /** Whether the knowledge counts include a count of Han characters. */
  countsCharacters: boolean
}

/** "HSK 1" or "Level 1". */
export const bandName = (pack: Pick<PackMeta, 'wording'>, band: string | number): string => pack.wording.band.replace('{n}', String(band))
/** The reading's name with a capital: "Pinyin", "Readings". */
export const readingTitle = (pack: Pick<PackMeta, 'wording'>): string => pack.wording.reading.charAt(0).toUpperCase() + pack.wording.reading.slice(1)

const everything = Object.fromEntries(AREAS.map(area => [area, true])) as Features
const nothing = Object.fromEntries(AREAS.map(area => [area, false])) as Features

export const zhMeta: PackMeta = { id: 'zh', name: zhTrack.name, nativeName: '\u4E2D\u6587', learningTag: 'zh-Hans', htmlLang: 'en', features: everything,
  wording: { language: 'Mandarin', band: 'HSK {n}', reading: 'pinyin', goals: 'the HSK goals' }, speechLocale: 'zh-Hans', courseTracks: true, readings: 'pinyin', countsCharacters: true }
export const jaMeta: PackMeta = { id: 'ja', name: jaTrack.name, nativeName: '\u65E5\u672C\u8A9E', learningTag: 'ja', htmlLang: 'en', features: nothing,
  wording: { language: 'Japanese', band: 'Level {n}', reading: 'readings', goals: 'your goals' }, speechLocale: 'ja-JP', courseTracks: false, readings: 'line', countsCharacters: false }
export const koMeta: PackMeta = { id: 'ko', name: koTrack.name, nativeName: '\uD55C\uAD6D\uC5B4', learningTag: 'ko', htmlLang: 'en', features: nothing,
  wording: { language: 'Korean', band: 'Level {n}', reading: 'readings', goals: 'your goals' }, speechLocale: 'ko-KR', courseTracks: false, readings: 'line', countsCharacters: false }

export const METAS: Record<LanguageId, PackMeta> = { zh: zhMeta, ja: jaMeta, ko: koMeta }

export function metaFor(id: LanguageId): PackMeta {
  if (!isLanguageId(id)) throw new Error('Unknown language "' + String(id) + '"')
  return METAS[id]
}

export const isAreaOn = (pack: PackMeta, area: Area | undefined): boolean => area === undefined || pack.features[area]
