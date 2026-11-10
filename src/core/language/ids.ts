// The languages a build can be made for. Plain data with no imports: the build scripts, the storage names and the packs all read it.

export const LANGUAGE_IDS = ['zh', 'ja', 'ko'] as const
export type LanguageId = (typeof LANGUAGE_IDS)[number]
/** The two languages that are not Chinese: their rows live in a Chinese build's storage under a language prefix (ja:, ko:). */
export type ParallelLanguage = Exclude<LanguageId, 'zh'>
export const DEFAULT_BUILD_LANGUAGE: LanguageId = 'zh'

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && (LANGUAGE_IDS as readonly string[]).includes(value)
}
