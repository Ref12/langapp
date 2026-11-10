import { LANGUAGE_IDS, type LanguageId } from './ids'
import { metaFor } from './meta'
import { buildChannel, buildLanguage } from '../storage-names'

/** The published Lab apps, in registry order: the languages whose pack meta says `published` (Korean has no app yet). */
export function labApps(): { id: LanguageId; name: string; glyph: string }[] {
  return LANGUAGE_IDS.map(metaFor).filter(meta => meta.published).map(({ id, name, glyph }) => ({ id, name, glyph }))
}

/** Whether the top-bar app switch is shown: Lab builds with more than one published app. */
export function appSwitchShown(): boolean { return buildChannel() === 'lab' && labApps().length > 1 }

/**
 * Where another Lab app lives, relative to this build's own page. Lab is at lab/ and every other language at lab/<id>/ (scripts/assemble-site.mjs),
 * so from the Chinese app the way is ./<id>/ and from a language app ../ (Chinese) or ../<id>/. A relative link cannot name the wrong app, whatever the site's root is.
 */
export function appHref(target: LanguageId, from: LanguageId = buildLanguage()): string {
  if (target === from) return './'
  if (from === 'zh') return `./${target}/`
  return target === 'zh' ? '../' : `../${target}/`
}
