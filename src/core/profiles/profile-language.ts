import type { LanguageId } from '../language/ids'
import { buildLanguage } from '../storage-names'
import type { ProfileSnapshot } from './contracts'

/** The language a profile file or snapshot was written for: the one it records, Chinese when it records none (every earlier file was Chinese). */
export const profileLanguage = (snapshot: Pick<ProfileSnapshot, 'language'>): LanguageId => snapshot.language ?? 'zh'
/** True when the file is of another language than this build: only its settings may come in. */
export const isOtherLanguageProfile = (snapshot: Pick<ProfileSnapshot, 'language'>): boolean => profileLanguage(snapshot) !== buildLanguage()
