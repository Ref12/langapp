import { languageOfRefs, rowsOfCurrentLanguage } from '../language/scope'
import type { LanguageId } from '../language/ids'
import type { Preferences } from '../model'

/** The language a drill set belongs to, worked out from its items (a set stores no language). A set with no items, or only unmarked ones, is Chinese. */
export function languageOfSet(set: { refs: readonly string[] }): LanguageId {
  return languageOfRefs(set.refs)
}

/** The sets the learner sees in Recent sessions: see rowsOfCurrentLanguage (a one-language build filters nothing). */
export function setsOfCurrentLanguage<T extends { refs: readonly string[] }>(sets: readonly T[], preferences: Pick<Preferences, 'currentLanguage'>): T[] {
  return rowsOfCurrentLanguage(sets, set => set.refs, preferences)
}
