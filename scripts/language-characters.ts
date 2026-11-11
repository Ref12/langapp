/// <reference types="vite/client" />
import { cp } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { languageFolder } from '../src/core/characters/language'
import type { LanguageId } from '../src/core/language/ids'

/**
 * Which files of public/ a build copies. A build ships the stroke data of its own language only: public/characters/<folder>/ of the build language
 * (with its ATTRIBUTION page, licence notices and, for Chinese, the source archives that page links), and nothing of the other languages' folders.
 * Everything outside public/characters is kept.
 */
export function keepPublicFile(language: LanguageId, relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  if (parts[0] !== 'characters' || parts.length < 2) return true
  return parts[1] === languageFolder(language)
}

/** Copy a public folder into an output folder, leaving out the other languages' stroke data. */
export function copyPublic(language: LanguageId, publicDir: string, outDir: string): Promise<void> {
  return cp(publicDir, outDir, { recursive: true, filter: source => keepPublicFile(language, relative(publicDir, source)) })
}

/** The build's copy of public/: use with build.copyPublicDir = false. */
export function languageCharacters(language: LanguageId): Plugin {
  let publicDir = ''
  let outDir = ''
  return {
    name: 'langapp-language-characters',
    apply: 'build',
    configResolved(config) { publicDir = config.publicDir; outDir = resolve(config.root, config.build.outDir) },
    writeBundle: { sequential: true, handler: () => publicDir ? copyPublic(language, publicDir, outDir) : undefined },
  }
}
