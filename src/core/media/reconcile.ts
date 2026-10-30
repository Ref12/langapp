import { charReadings } from './readings'
import type { WovenToken } from './contracts'

// The source line is the truth. The model's tokens are aligned to it character by character: tokens that match in order are kept,
// characters the model dropped (particles, punctuation) are added back, and characters it invented are dropped.
// The result always reproduces the line exactly, so a chunk is never rejected for a token/text mismatch.

const han = /\p{Script=Han}/u
const LOOKAHEAD = 8

/** Tone-marked reading of every character of a line (empty for anything that is not Han), read in context per Han run. */
export function lineReadings(chars: readonly string[]): string[] {
  const out: string[] = chars.map(() => '')
  for (let index = 0; index < chars.length;) {
    if (!han.test(chars[index])) { index++; continue }
    let end = index
    while (end < chars.length && han.test(chars[end])) end++
    const readings = charReadings(chars.slice(index, end).join(''))
    for (let k = index; k < end; k++) out[k] = readings[k - index] ?? ''
    index = end
  }
  return out
}

export interface Reconciled { tokens: WovenToken[]; /** The model's tokens did not already reproduce the line. */ repaired: boolean }

/** Builds the tokens of a line from the model's attempt. Every character of `line` ends up in exactly one token's text or trailing. */
export function reconcileLine(line: string, attempt: readonly Pick<WovenToken, 'text' | 'pinyin' | 'meaning' | 'trailing'>[]): Reconciled {
  const chars = Array.from(line)
  const exact = attempt.length > 0 && attempt.every(token => token.text) && attempt.map(token => token.text + token.trailing).join('') === line
  if (exact) return { tokens: attempt.map(token => ({ text: token.text, pinyin: token.pinyin, meaning: token.meaning, trailing: token.trailing })), repaired: false }
  const readings = lineReadings(chars)
  const out: WovenToken[] = []
  let position = 0
  /** Source characters nobody claimed: punctuation joins the previous token's trailing, Han characters become unglossed tokens with their own reading. */
  const absorb = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      const previous = out[out.length - 1]
      if (han.test(chars[k])) out.push({ text: chars[k], pinyin: readings[k], meaning: '', trailing: '' })
      else if (previous) previous.trailing += chars[k]
      else out.push({ text: chars[k], pinyin: '', meaning: '', trailing: '' })
    }
  }
  for (const token of attempt) {
    const want = Array.from(token.text)
    if (!want.length) continue
    let found = -1
    for (let start = position; start <= Math.min(chars.length - want.length, position + LOOKAHEAD) && found < 0; start++) {
      if (want.every((char, offset) => chars[start + offset] === char)) found = start
    }
    if (found < 0) continue // Added or altered by the model: the characters come back from the source below.
    absorb(position, found)
    position = found + want.length
    let trailing = ''
    for (const char of Array.from(token.trailing)) {
      if (position < chars.length && chars[position] === char) { trailing += char; position++ } else break
    }
    out.push({ text: token.text, pinyin: token.pinyin, meaning: token.meaning, trailing })
  }
  absorb(position, chars.length)
  if (out.map(token => token.text + token.trailing).join('') !== line) return { tokens: fallbackTokens(line), repaired: true }
  return { tokens: out, repaired: true }
}

/** A line with no usable model tokens: one unglossed token per Han character, punctuation as trailing. */
export function fallbackTokens(line: string): WovenToken[] {
  const chars = Array.from(line)
  const out: WovenToken[] = []
  const readings = lineReadings(chars)
  chars.forEach((char, index) => {
    const previous = out[out.length - 1]
    if (han.test(char) || !previous) out.push({ text: char, pinyin: readings[index], meaning: '', trailing: '' })
    else previous.trailing += char
  })
  return out
}
