import { characterAssetIndex } from './assets'

export type WritingScope = 'all' | 'knowledge'
export interface WritingQuery { word: string[]; index: number; back?: string }

const HAN = /\p{Script=Han}/u
export const isHan = (character: string): boolean => HAN.test(character)
export const hasGuide = (character: string): boolean => characterAssetIndex.some(asset => asset.character === character)
export const hexOf = (character: string): string => character.codePointAt(0)!.toString(16)
const cleanRoute = (value: string): string => value.replace(/^#?\/*/, '')

/** Parses the optional `?word=&i=&back=` part of a writing route (without the leading "?"). The route's own
 *  character wins: when word[i] disagrees with it, i is recomputed from the character (or the word is dropped). */
export function parseWritingQuery(query: string | undefined, character?: string): WritingQuery {
  const params = new URLSearchParams(query ?? '')
  let word = [...(params.get('word') ?? '')]
  const parsed = Number.parseInt(params.get('i') ?? '', 10)
  let index = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
  if (word.length && character !== undefined && word[index] !== character) index = word.indexOf(character)
  if (!word.length || index < 0 || index >= word.length) { word = []; index = 0 }
  const back = cleanRoute(params.get('back') ?? '')
  return { word, index, back: back || undefined }
}

/** Builds `writing/<hex>/<scope>[?word=&i=&back=]` (no leading "#"). */
export function buildWritingRoute(character: string, scope: WritingScope, options: { word?: string; index?: number; back?: string } = {}): string {
  const query: string[] = []
  if (options.word) { query.push(`word=${encodeURIComponent(options.word)}`); if (options.index) query.push(`i=${options.index}`) }
  if (options.back) query.push(`back=${encodeURIComponent(cleanRoute(options.back))}`)
  return `writing/${hexOf(character)}/${scope}${query.length ? `?${query.join('&')}` : ''}`
}

/** Index of the nearest practicable character in a direction (non-Han and guide-less characters are skipped). */
export function neighbourIndex(word: string[], index: number, direction: 1 | -1): number | undefined {
  for (let at = index + direction; at >= 0 && at < word.length; at += direction) if (isHan(word[at]) && hasGuide(word[at])) return at
  return undefined
}
