import { buildLanguage } from '../storage-names'
import { packFor, type LanguagePack } from './packs'

export * from './ids'
export * from './areas'
export * from './packs'

/** The pack of the language this bundle was built for. */
export function getPack(): LanguagePack { return packFor(buildLanguage()) }
