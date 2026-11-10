import { parseParallelRef } from '../parallel/refs'
import { isLanguageId, type LanguageId } from './ids'
import { buildLanguage } from '../storage-names'
import { currentLanguageOf } from '../../data/tracks'
import type { Preferences } from '../model'

/**
 * Each language is its own world. One seam for "the rows of the language the learner is in", used by every page that lists or
 * counts a table holding more than one language (the Chinese Lab build keeps zh, ja and ko rows in one database).
 * The ways of telling a ref's language live in core/parallel/refs.ts (ja:w:..., ko:g:..., ja:f:...); a ref with no mark is Chinese.
 */

/** The language of a list of refs: the first marked ref decides; no refs, or only unmarked ones (vocabulary:, grammar:, phrase:, source:), is Chinese. */
export function languageOfRefs(refs: Iterable<string>): LanguageId {
  for (const ref of refs) { const parsed = parseParallelRef(ref); if (parsed) return parsed.language }
  return 'zh'
}

/**
 * The language the learner is in. A one-language build (ja, ko) has its own database: its language is the build's.
 * The Chinese build has the language switch: the currentLanguage preference (Chinese when unset or unknown).
 */
export function languageInUse(preferences: Pick<Preferences, 'currentLanguage'>): LanguageId {
  const built = buildLanguage()
  if (built !== 'zh') return built
  const chosen = currentLanguageOf(preferences)
  return isLanguageId(chosen) ? chosen : 'zh'
}

/**
 * The rows the learner sees: those of the language in use. A one-language build filters nothing (the database is the build's own,
 * and its rows carry plain vocabulary: / grammar: refs); the Chinese build keeps the rows of currentLanguage.
 */
export function rowsOfCurrentLanguage<T>(rows: readonly T[], refsOf: (row: T) => Iterable<string>, preferences: Pick<Preferences, 'currentLanguage'>): T[] {
  if (buildLanguage() !== 'zh') return [...rows]
  const language = languageInUse(preferences)
  return rows.filter(row => languageOfRefs(refsOf(row)) === language)
}
