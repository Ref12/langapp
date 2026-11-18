import { LANGUAGE_IDS, type LanguageId } from './ids'
import { metaFor } from './meta'
import { buildChannel, buildLanguage } from '../storage-names'

/** The published apps, in registry order: the languages whose pack meta says `published` (Korean has no app yet). */
export function labApps(): { id: LanguageId; name: string; glyph: string }[] {
  return LANGUAGE_IDS.map(metaFor).filter(meta => meta.published).map(({ id, name, glyph }) => ({ id, name, glyph }))
}

/** Whether the top-bar app switch is shown: builds of the main app with more than one published app. */
export function appSwitchShown(): boolean { return buildChannel() === 'lab' && labApps().length > 1 }

/**
 * Where another app lives, relative to this build's own page. The main (Chinese) app is at the site root and every other language at <id>/ (scripts/assemble-site.mjs),
 * so from the Chinese app the way is ./<id>/ and from a language app ../ (Chinese) or ../<id>/. A relative link cannot name the wrong app, whatever the site's root is.
 */
export function appHref(target: LanguageId, from: LanguageId = buildLanguage()): string {
  if (target === from) return './'
  if (from === 'zh') return `./${target}/`
  return target === 'zh' ? '../' : `../${target}/`
}

/** Where Stable, the old version, lives, relative to this build's own page: ./stable/ from the root app, ../stable/ from a language app. */
export function stableHref(from: LanguageId = buildLanguage()): string {
  return from === 'zh' ? './stable/' : '../stable/'
}
