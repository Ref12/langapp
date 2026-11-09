import { characterAssetIndex } from './assets'
import { isWritingLanguage, type WritingLanguage } from './language'

export type WritingScope = 'all' | 'knowledge'
export interface WritingQuery { word: string[]; index: number; back?: string; language?: WritingLanguage }

const HAN = /\p{Script=Han}/u
export const isHan = (character: string): boolean => HAN.test(character)
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/u
const HANGUL = /[\u1100-\u11ff\u3131-\u318e\uac00-\ud7a3]/u
/** A character the language's writing practice can take: Han for Chinese, Han and kana for Japanese, Hangul for Korean. Whether stroke data exists is known only once it loads. */
export const isWritable = (character: string, language: WritingLanguage = 'zh'): boolean =>
  language === 'zh' ? isHan(character) : language === 'ja' ? isHan(character) || KANA.test(character) : HANGUL.test(character)
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
  const lang = params.get('lang')
  return { word, index, back: back || undefined, ...(isWritingLanguage(lang) && lang !== 'zh' ? { language: lang } : {}) }
}

/** Builds `writing/<hex>/<scope>[?word=&i=&back=]` (no leading "#"). */
export function buildWritingRoute(character: string, scope: WritingScope, options: { word?: string; index?: number; back?: string; language?: WritingLanguage } = {}): string {
  const query: string[] = []
  if (options.word) { query.push(`word=${encodeURIComponent(options.word)}`); if (options.index) query.push(`i=${options.index}`) }
  if (options.language && options.language !== 'zh') query.push(`lang=${options.language}`)
  if (options.back) query.push(`back=${encodeURIComponent(cleanRoute(options.back))}`)
  return `writing/${hexOf(character)}/${scope}${query.length ? `?${query.join('&')}` : ''}`
}

/** Index of the nearest practicable character in a direction (non-Han and guide-less characters are skipped). */
export function neighbourIndex(word: string[], index: number, direction: 1 | -1, language: WritingLanguage = 'zh'): number | undefined {
  for (let at = index + direction; at >= 0 && at < word.length; at += direction) if (language === 'zh' ? isHan(word[at]) && hasGuide(word[at]) : isWritable(word[at], language)) return at
  return undefined
}
