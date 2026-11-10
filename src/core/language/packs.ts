// The language packs: what a build knows about the language it is made for: the identity (meta.ts) and the data the loaders read (data/*.ts).
// A build that sets __PACK_DATA__ (scripts/build-channel.ts) keeps only its own language's data: the other languages' data modules are folded away by the constant
// conditions below and never reach the bundle. Tests set it to 'all' and pick the pack at run time (setBuildLanguageForTests).

import { isLanguageId, type LanguageId } from './ids'
import { jaMeta, koMeta, zhMeta, type PackMeta } from './meta'
import type { PackData } from './pack-data'
import { emptyData } from './data/empty'
import { jaData } from './data/ja'
import { zhData } from './data/zh'

export * from './meta'
export * from './pack-data'

export interface LanguagePack extends PackMeta, PackData {}

declare const __PACK_DATA__: string

export const zhPack: LanguagePack = { ...zhMeta, ...(typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'zh' ? zhData : emptyData) }
export const jaPack: LanguagePack = { ...jaMeta, ...(typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ja' ? jaData : emptyData) }
/** A placeholder: Korean has no data yet, so its catalog is empty (no bands), its phrase bank is empty and it has no dataset. */
export const koPack: LanguagePack = { ...koMeta, ...emptyData }

export const PACKS: Record<LanguageId, LanguagePack> = { zh: zhPack, ja: jaPack, ko: koPack }

export function packFor(id: LanguageId): LanguagePack {
  if (!isLanguageId(id)) throw new Error('Unknown language "' + String(id) + '"')
  return PACKS[id]
}
