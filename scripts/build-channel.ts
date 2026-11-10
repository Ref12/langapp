import { execSync } from 'node:child_process'
import { DEFAULT_BUILD_LANGUAGE, LANGUAGE_IDS, isLanguageId, type LanguageId } from '../src/core/language/ids'

export type BuildChannel = 'stable' | 'lab'

export function buildCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev' } catch { return 'dev' }
}

/** The language to build for: LANGAPP_LANGUAGE (default zh). An unknown id, or any language but zh on Stable, is an error. */
export function languageFromEnv(channel: BuildChannel, env: Record<string, string | undefined> = process.env): LanguageId {
  const raw = env.LANGAPP_LANGUAGE?.trim()
  const language = raw ? raw : DEFAULT_BUILD_LANGUAGE
  if (!isLanguageId(language)) throw new Error('LANGAPP_LANGUAGE="' + language + '" is not a known language. Known ids: ' + LANGUAGE_IDS.join(', ') + '.')
  if (channel === 'stable' && language !== 'zh') throw new Error('The Stable channel is Chinese only: LANGAPP_LANGUAGE="' + language + '" can be built on the Lab channel only.')
  return language
}

/**
 * The compile-time constants `__BUILD_CHANNEL__` ('stable' | 'lab'), `__BUILD_LANGUAGE__` ('zh' | 'ja' | 'ko'), `__BUILD_COMMIT__` (short sha) and `__PACK_DATA__`: whose data the bundle may contain
 * (the build language, so a build leaves the other languages' data out; 'all' for tests, which load any pack at run time).
 */
export function buildDefines(channel: BuildChannel, language: LanguageId = DEFAULT_BUILD_LANGUAGE, packData: LanguageId | 'all' = language): Record<string, string> {
  if (!isLanguageId(language)) throw new Error('"' + String(language) + '" is not a known language. Known ids: ' + LANGUAGE_IDS.join(', ') + '.')
  if (channel === 'stable' && language !== 'zh') throw new Error('The Stable channel is Chinese only.')
  return { __BUILD_CHANNEL__: JSON.stringify(channel), __BUILD_LANGUAGE__: JSON.stringify(language), __BUILD_COMMIT__: JSON.stringify(buildCommit()), __PACK_DATA__: JSON.stringify(packData) }
}
