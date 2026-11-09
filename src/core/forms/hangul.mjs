// Hangul syllable arithmetic for the Korean forms (no dependencies).
const BASE = 0xac00
export const VOWEL = { ㅏ: 0, ㅐ: 1, ㅑ: 2, ㅒ: 3, ㅓ: 4, ㅔ: 5, ㅕ: 6, ㅖ: 7, ㅗ: 8, ㅘ: 9, ㅙ: 10, ㅚ: 11, ㅛ: 12, ㅜ: 13, ㅝ: 14, ㅞ: 15, ㅟ: 16, ㅠ: 17, ㅡ: 18, ㅢ: 19, ㅣ: 20 }
export const FINAL = { ㄴ: 4, ㄷ: 7, ㄹ: 8, ㅁ: 16, ㅂ: 17, ㅅ: 19, ㅆ: 20, ㅇ: 21, ㅎ: 27 }
export const INITIAL_IEUNG = 11
export const INITIAL_RIEUL = 5

/** {l, v, t} of a Hangul syllable, or null. */
export function decompose(char) {
  const code = String(char ?? '').charCodeAt(0) - BASE
  if (!(code >= 0 && code < 11172)) return null
  return { l: Math.floor(code / 588), v: Math.floor((code % 588) / 28), t: code % 28 }
}
export const compose = (l, v, t = 0) => String.fromCharCode(BASE + l * 588 + v * 28 + t)
export const lastChar = text => text.slice(-1)
export const init = text => text.slice(0, -1)
/** The last syllable with the final consonant t (it must have none), or with none. */
export function withFinal(text, t) {
  const d = decompose(lastChar(text))
  return init(text) + compose(d.l, d.v, t)
}
export const hasFinal = text => (decompose(lastChar(text))?.t ?? 0) > 0
export const endsInVowel = text => { const d = decompose(lastChar(text)); return d ? d.t === 0 : false }
/** Does a noun end in a vowel (no final consonant)? Non-Hangul endings count as consonant-like (digits are read, so they are not asked here). */
export const nounEndsInVowel = text => endsInVowel(String(text ?? '').replace(/[\s.,!?'"。、]+$/u, ''))
export const stripSpaces = text => String(text ?? '').replace(/\s+/g, '')
