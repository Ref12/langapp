import { parseParallelRef } from '../parallel/refs'
import { isLanguageId, type LanguageId } from '../language/ids'
import { buildLanguage } from '../storage-names'
import { currentLanguageOf } from '../../data/tracks'
import type { Preferences } from '../model'

/**
 * The language a drill set belongs to, worked out from its items (a set stores no language). The ways of telling an
 * item's language from its ref live in core/parallel/refs.ts (ja:w:..., ko:g:..., ja:f:...); the language pack has none.
 * A set with no items, or whose items carry no ja:/ko: mark (vocabulary:, grammar:, phrase:, source:), is Chinese.
 */
export function languageOfSet(set: { refs: readonly string[] }): LanguageId {
  for (const ref of set.refs) { const parsed = parseParallelRef(ref); if (parsed) return parsed.language }
  return 'zh'
}

/**
 * The sets the learner sees in Recent sessions. A one-language build (ja, ko) has its own database, so every stored set is
 * its own: no filter. The Chinese build has the language switch: it keeps the sets of the currentLanguage preference.
 */
export function setsOfCurrentLanguage<T extends { refs: readonly string[] }>(sets: readonly T[], preferences: Pick<Preferences, 'currentLanguage'>): T[] {
  if (buildLanguage() !== 'zh') return [...sets]
  const chosen = currentLanguageOf(preferences)
  const language = isLanguageId(chosen) ? chosen : 'zh'
  return sets.filter(set => languageOfSet(set) === language)
}
