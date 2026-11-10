// The identity part of the language packs: names, tags, feature switches. Plain data with no data files behind it, so the build scripts can import it (packs.ts adds the data).

import { zhTrack, jaTrack, koTrack } from '../../data/tracks'
import { AREAS, type Area, type Features } from './areas'
import { isLanguageId, type LanguageId } from './ids'

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
}

const everything = Object.fromEntries(AREAS.map(area => [area, true])) as Features
const nothing = Object.fromEntries(AREAS.map(area => [area, false])) as Features

export const zhMeta: PackMeta = { id: 'zh', name: zhTrack.name, nativeName: '\u4E2D\u6587', learningTag: 'zh-Hans', htmlLang: 'en', features: everything }
export const jaMeta: PackMeta = { id: 'ja', name: jaTrack.name, nativeName: '\u65E5\u672C\u8A9E', learningTag: 'ja', htmlLang: 'en', features: nothing }
export const koMeta: PackMeta = { id: 'ko', name: koTrack.name, nativeName: '\uD55C\uAD6D\uC5B4', learningTag: 'ko', htmlLang: 'en', features: nothing }

export const METAS: Record<LanguageId, PackMeta> = { zh: zhMeta, ja: jaMeta, ko: koMeta }

export function metaFor(id: LanguageId): PackMeta {
  if (!isLanguageId(id)) throw new Error('Unknown language "' + String(id) + '"')
  return METAS[id]
}

export const isAreaOn = (pack: PackMeta, area: Area | undefined): boolean => area === undefined || pack.features[area]
