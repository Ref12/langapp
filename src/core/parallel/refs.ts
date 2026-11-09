import type { ParallelLanguage } from './data'

/** Knowledge ids of the parallel tracks: ja:w:<entry> (a word) and ja:g:<grammar> (a grammar point), likewise ko:. Chinese refs never look like this. */
export type ParallelKind = 'w' | 'g'
export const parallelRef = (language: ParallelLanguage, kind: ParallelKind, id: string): string => `${language}:${kind}:${id}`
const PATTERN = /^(ja|ko):([wg]):([a-z][a-z0-9]*(?:--?[a-z0-9]+)*)$/
export const isParallelRef = (ref: string): boolean => PATTERN.test(ref)
export function parseParallelRef(ref: string): { language: ParallelLanguage; kind: ParallelKind; id: string } | undefined {
  const match = PATTERN.exec(ref)
  return match ? { language: match[1] as ParallelLanguage, kind: match[2] as ParallelKind, id: match[3] } : undefined
}
/** Any language-prefixed ref (ja:, ko:, or a language this build does not know yet): never a Chinese record. */
export const isLanguageRef = (ref: string): boolean => /^[a-z]{2,3}:/.test(ref)
/** Records of another language than ja/ko (a profile from a newer build, say) are not ours: they are left alone and never shown. */
export const parallelRefsOf = (language: ParallelLanguage, refs: Iterable<string>): string[] => [...refs].filter(ref => parseParallelRef(ref)?.language === language)
