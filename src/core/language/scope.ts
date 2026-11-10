import { parseParallelRef } from './refs'
import type { LanguageId } from './ids'
import { buildLanguage } from '../storage-names'
import type { Preferences } from '../model'

/**
 * Each language is its own world. One seam for "the rows of the language the learner is in", used by every page that lists or
 * counts a table holding more than one language (the Chinese Lab build keeps zh, ja and ko rows in one database).
 * The ways of telling a ref's language live in core/language/refs.ts (ja:w:..., ko:g:..., ja:f:...); a ref with no mark is Chinese.
 */

/** The language of a list of refs: the first marked ref decides; no refs, or only unmarked ones (vocabulary:, grammar:, phrase:, source:), is Chinese. */
export function languageOfRefs(refs: Iterable<string>): LanguageId {
  for (const ref of refs) { const parsed = parseParallelRef(ref); if (parsed) return parsed.language }
  return 'zh'
}

/**
 * The language the learner is in: the build's own (each language is its own app; there is no switch inside the Chinese build any more).
 * The preferences argument is kept for the callers: an old `currentLanguage` setting is still stored but no longer chooses anything.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function languageInUse(_preferences?: Pick<Preferences, 'currentLanguage'>): LanguageId {
  return buildLanguage()
}

/**
 * The rows the learner sees: those of the language in use. A one-language build filters nothing (the database is the build's own,
 * and its rows carry plain vocabulary: / grammar: refs); the Chinese build keeps its own (unmarked) rows and hides the ja:/ko: ones an older version wrote.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function rowsOfCurrentLanguage<T>(rows: readonly T[], refsOf: (row: T) => Iterable<string>, _preferences?: Pick<Preferences, 'currentLanguage'>): T[] {
  if (buildLanguage() !== 'zh') return [...rows]
  const language = languageInUse()
  return rows.filter(row => languageOfRefs(refsOf(row)) === language)
}
