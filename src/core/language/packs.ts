// The language packs: what a build knows about the language it is made for. This step holds only what it uses (names, tags,
// feature switches); each later step adds the fields it consumes. No browser or Vite API in here: the build scripts import it too.

import { zhTrack, jaTrack, koTrack } from '../../data/tracks'
import { AREAS, type Area, type Features } from './areas'
import { isLanguageId, type LanguageId } from './ids'

export interface LanguagePack {
  id: LanguageId
  /** The language's English name, e.g. "Japanese". */
  name: string
  nativeName: string
  /** The language tag of the learned language (content), also the manifest's `lang` outside Chinese. */
  learningTag: string
  /** The `<html lang>` of the app's own interface (English today in every build). */
  htmlLang: string
  features: Features
}

const everything = Object.fromEntries(AREAS.map(area => [area, true])) as Features
const nothing = Object.fromEntries(AREAS.map(area => [area, false])) as Features

export const zhPack: LanguagePack = { id: 'zh', name: zhTrack.name, nativeName: '\u4E2D\u6587', learningTag: 'zh-Hans', htmlLang: 'en', features: everything }
export const jaPack: LanguagePack = { id: 'ja', name: jaTrack.name, nativeName: '\u65E5\u672C\u8A9E', learningTag: 'ja', htmlLang: 'en', features: nothing }
export const koPack: LanguagePack = { id: 'ko', name: koTrack.name, nativeName: '\uD55C\uAD6D\uC5B4', learningTag: 'ko', htmlLang: 'en', features: nothing }

export const PACKS: Record<LanguageId, LanguagePack> = { zh: zhPack, ja: jaPack, ko: koPack }

export function packFor(id: LanguageId): LanguagePack {
  if (!isLanguageId(id)) throw new Error('Unknown language "' + String(id) + '"')
  return PACKS[id]
}

export const isAreaOn = (pack: LanguagePack, area: Area | undefined): boolean => area === undefined || pack.features[area]

/** The name of the build, for the manifest and the page title: "LinguaWeave", "LinguaWeave Lab", "LinguaWeave Lab Japanese". */
export function buildDisplayName(channel: 'stable' | 'lab', pack: LanguagePack): string {
  if (channel === 'stable') return 'LinguaWeave'
  return pack.id === 'zh' ? 'LinguaWeave Lab' : 'LinguaWeave Lab ' + pack.name
}
