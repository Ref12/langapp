// The language packs: what a build knows about the language it is made for: the identity (meta.ts) and the data the loaders read (data/*.ts).
// A build that sets __PACK_DATA__ (scripts/build-channel.ts) keeps only its own language's data: the other languages' data modules are folded away by the constant
// conditions below and never reach the bundle. Tests set it to 'all' and pick the pack at run time (setBuildLanguageForTests).

import { isLanguageId, type LanguageId } from './ids'
import { jaMeta, koMeta, zhMeta, type PackMeta } from './meta'
import type { PackData } from './pack-data'
import { emptyData } from './data/empty'
import { jaData } from './data/ja'
import { koData } from './data/ko'
import { zhData } from './data/zh'

export * from './meta'
export * from './pack-data'

export interface LanguagePack extends PackMeta, PackData {}

/** The name of the build, for the manifest and the page title: "LinguaWeave", "LinguaWeave Lab", "LinguaWeave Lab Japanese". */
export function buildDisplayName(channel: 'stable' | 'lab', pack: PackMeta): string {
  if (channel === 'stable') return 'LinguaWeave'
  return pack.id === 'zh' ? 'LinguaWeave Lab' : 'LinguaWeave Lab ' + pack.name
}

declare const __PACK_DATA__: string

export const zhPack: LanguagePack = { ...zhMeta, ...(typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'zh' ? zhData : emptyData) }
export const jaPack: LanguagePack = { ...jaMeta, ...(typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ja' ? jaData : emptyData) }
export const koPack: LanguagePack = { ...koMeta, ...(typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ko' ? koData : emptyData) }

export const PACKS: Record<LanguageId, LanguagePack> = { zh: zhPack, ja: jaPack, ko: koPack }

export function packFor(id: LanguageId): LanguagePack {
  if (!isLanguageId(id)) throw new Error('Unknown language "' + String(id) + '"')
  return PACKS[id]
}
