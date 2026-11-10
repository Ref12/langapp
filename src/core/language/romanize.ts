// Moved from the old src/core/parallel (removed): Hepburn romaji of kana and the other reading helpers the Japanese pack shares.
// Revised Romanization of Korean, syllable by syllable (no sound-change rules): the reading shown in the pinyin slot.
const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const FINAL = ['', 'k', 'kk', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 'tt', 'ng', 't', 't', 'k', 't', 'p', 'h']

export function romanizeKorean(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)! - 0xac00
    if (code < 0 || code > 11171) { out += char; continue }
    out += INITIAL[Math.floor(code / 588)] + MEDIAL[Math.floor((code % 588) / 28)] + FINAL[code % 28]
  }
  return out
}

const BASE = `a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa wo n
ga gi gu ge go za ji zu ze zo da ji zu de do ba bi bu be bo pa pi pu pe po vu`
const KANA_BASE = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゔ'
const SMALL: Record<string, string> = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' }
// Small vowels after a consonant kana (katakana loan sounds: ファ, ティ, ウィ, シェ).
const SMALL_VOWEL: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }
const SINGLE = new Map<string, string>(KANA_BASE.split('').map((kana, index) => [kana, BASE.split(/\s+/)[index]]))
const LOAN = new Map<string, string>([['ふぁ', 'fa'], ['ふぃ', 'fi'], ['ふぇ', 'fe'], ['ふぉ', 'fo'], ['てぃ', 'ti'], ['でぃ', 'di'], ['うぃ', 'wi'], ['うぇ', 'we'], ['うぉ', 'wo'], ['しぇ', 'she'], ['じぇ', 'je'], ['ちぇ', 'che'], ['ゔぁ', 'va'], ['ゔぃ', 'vi'], ['ゔぇ', 've'], ['ゔぉ', 'vo']])
const YOON = new Map<string, string>([['し', 'sh'], ['ち', 'ch'], ['じ', 'j'], ['ぢ', 'j']])

/** Katakana to hiragana (the long-vowel mark is kept). */
export const toHiragana = (text: string): string => text.replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
/** Hiragana to katakana. */
export const toKatakana = (text: string): string => text.replace(/[\u3041-\u3096]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60))
export const isKana = (text: string): boolean => /^[\u3041-\u309f\u30a0-\u30ffー・]+$/u.test(text)
export const isKatakana = (text: string): boolean => /^[\u30a0-\u30ffー・]+$/u.test(text)

/** Hepburn romaji of kana (hiragana or katakana): ん is n, a doubled consonant for っ, a long vowel repeats its vowel; other characters stay as written. */
export function romanizeJapanese(text: string): string {
  const kana = Array.from(toHiragana(text))
  let out = ''
  let doubled = false
  for (let index = 0; index < kana.length; index++) {
    const char = kana[index]
    if (char === 'っ') { doubled = true; continue }
    if (char === 'ー') { out += out.match(/[aiueo]$/)?.[0] ?? ''; continue }
    const next = kana[index + 1]
    let piece: string | undefined
    if (next && LOAN.has(char + next)) { piece = LOAN.get(char + next); index++ }
    else if (next && SMALL[next] && SINGLE.has(char)) {
      const base = SINGLE.get(char)!
      const initial = YOON.get(char)
      piece = initial ? initial + SMALL[next].slice(1) : base.slice(0, -1) + SMALL[next]
      index++
    } else if (next && SMALL_VOWEL[next] && SINGLE.has(char)) { piece = SINGLE.get(char)!.slice(0, -1) + SMALL_VOWEL[next]; index++ }
    else piece = SINGLE.get(char) ?? char
    if (doubled) { piece = (piece!.startsWith('ch') ? 't' : piece![0]) + piece; doubled = false }
    out += piece
  }
  return out
}

export type JapaneseReadingFormat = 'romaji' | 'kana'
export const DEFAULT_JAPANESE_READING: JapaneseReadingFormat = 'romaji'

/** What the pinyin slot shows for a Japanese or Korean form, or undefined when it has no reading (punctuation, Latin text). */
export function readingFor(language: 'ja' | 'ko', text: string, reading: string | undefined, format: JapaneseReadingFormat): string | undefined {
  if (language === 'ko') return /[\uac00-\ud7a3]/.test(text) ? romanizeKorean(text) : undefined
  const kana = reading ?? (isKana(text) ? text : undefined)
  if (!kana) return undefined
  return format === 'kana' ? (isKatakana(text) ? toKatakana(kana) : toHiragana(kana)) : romanizeJapanese(kana)
}

/** The reading of a token that is an inflected form of a dictionary word (勉強し from 勉強する): the word's kanji keep their reading, the kana is as written. */
export function tokenReading(target: string, reading: string | undefined, token: string): string | undefined {
  if (!reading) return undefined
  if (token === target) return reading
  const kanji = target.match(/^[^\u3040-\u30ff]+/u)?.[0]
  if (!kanji || !token.startsWith(kanji)) return undefined
  const okurigana = target.slice(kanji.length)
  if (!reading.endsWith(okurigana)) return undefined
  return reading.slice(0, reading.length - okurigana.length) + token.slice(kanji.length)
}
