// What makes two sentences the same sentence, and how a sentence is cut into the tiles of Word order: the pack answers, no caller tests the language.
// Chinese is the Han-only key and the Han-run segmenter exactly as they were (moved here from phrases/key.ts and session/grade.ts); Japanese and Korean read the sentence's own tokens.

/** One token of a sentence as the pack's data writes it (the same shape as an authored example's segment, phrases/contracts.ts). */
export interface SentenceToken { word?: string; grammar?: string; punctuation?: string; text?: string; reading?: string; form?: string }

/** What the segmenter may use: the known written forms (Chinese), and the sentence's tokens with a way to read a word's written form (Japanese, Korean). */
export interface SegmentWords {
  forms: ReadonlySet<string>
  tokens?: readonly SentenceToken[]
  /** The written form of a vocabulary ref, for a token that carries no text of its own. */
  surface?: (ref: string) => string | undefined
}

import { canonicalTimeOrder, jaTime, koTime, zhTime } from './time-order'

export interface PhraseIdentity {
  /** What makes two sentences the same: equal keys mean the same sentence. Stored data is keyed by it. */
  phraseKey(text: string): string
  /** The tiles of a sentence, in order, without punctuation. Empty when the data cannot say. */
  segment(text: string, words: SegmentWords): string[]
  /** The tiles with a sentence-initial time expression and the subject in one order (time first): a time word before or after the subject is the same answer (time-order.ts). */
  canonicalTimeOrder(words: readonly string[]): string[]
}

const NOT_HAN = /[^\p{Script=Han}]/gu

/** Chinese: the Han characters only, so punctuation, spaces and full-width marks do not count. Kept in step with phraseKey in scripts/build-phrase-bank.mjs (a test compares them). */
export const hanPhraseKey = (zh: string): string => zh.replace(NOT_HAN, '')

/** Words of a text: the longest known form at each position, an uncovered Han character on its own. Punctuation and spaces are dropped. */
export function segmentHan(text: string, forms: ReadonlySet<string>): string[] {
  const longest = Math.max(1, ...[...forms].map(form => form.length))
  const out: string[] = []
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    let start = 0
    while (start < run.length) {
      let length = Math.min(longest, run.length - start)
      while (length > 1 && !forms.has(run.slice(start, start + length))) length--
      out.push(run.slice(start, start + length)); start += length
    }
  }
  return out
}

export const zhIdentity: PhraseIdentity = { phraseKey: hanPhraseKey, segment: (text, words) => segmentHan(text, words.forms), canonicalTimeOrder: words => canonicalTimeOrder(words, zhTime) }

const NOT_LETTER = /[^\p{L}\p{N}\p{M}]/gu

/**
 * Japanese and Korean: letters and numbers only. Full-width and half-width forms are folded (NFKC), spaces and punctuation, Japanese and Latin, are dropped, Latin case does not count.
 * Hiragana and katakana are different letters (ケーキ is not けーき), and the reading is not the key.
 */
export const lettersPhraseKey = (text: string): string => text.normalize('NFKC').toLowerCase().replace(NOT_LETTER, '')

/** The tiles from the sentence's tokens: a word or grammar token is one tile with its whole surface (勉強します), punctuation is no tile. `atSpaces`: a token of several words is cut at its spaces (Korean). */
export function segmentTokens(words: SegmentWords, atSpaces = false): string[] {
  const out: string[] = []
  for (const token of words.tokens ?? []) {
    if (token.punctuation !== undefined) continue
    const text = token.text ?? (token.word !== undefined ? words.surface?.(token.word) : undefined)
    if (!text) continue
    for (const piece of atSpaces ? text.split(/\s+/u) : [text]) if (lettersPhraseKey(piece)) out.push(piece)
  }
  return out
}

export const jaIdentity: PhraseIdentity = { phraseKey: lettersPhraseKey, segment: (_text, words) => segmentTokens(words), canonicalTimeOrder: words => canonicalTimeOrder(words, jaTime) }

/**
 * Korean: the letters key, and a question mark counts (공부해요? asks what 공부해요. states, so they are two sentences). The tiles are the sentence's tokens cut at spaces, so a particle is its own tile
 * (저는 is 저 + 는) and a word between spaces is one tile; a sentence with no tokens is cut at its spaces.
 */
export const koIdentity: PhraseIdentity = {
  phraseKey: text => lettersPhraseKey(text) + (/[?\uFF1F]\s*$/u.test(text.trim()) ? '?' : ''),
  segment: (text, words) => words.tokens?.length ? segmentTokens(words, true) : text.split(/\s+/u).filter(part => lettersPhraseKey(part)),
  canonicalTimeOrder: words => canonicalTimeOrder(words, koTime),
}
