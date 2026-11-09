import { romanizeJapanese, romanizeKorean } from '../parallel/romanize'

export type CharacterScript = 'hiragana' | 'katakana' | 'kanji' | 'syllable' | 'jamo' | 'other'
export const scriptLabel: Record<CharacterScript, string> = { hiragana: 'Hiragana', katakana: 'Katakana', kanji: 'Kanji', syllable: 'Hangul syllable', jamo: 'Hangul letter', other: 'Other' }
/** The filter choices of each language's Characters list. */
export const scriptsOf = { ja: ['hiragana', 'katakana', 'kanji'], ko: ['syllable', 'jamo'] } as const satisfies Record<'ja' | 'ko', readonly CharacterScript[]>

export function characterScript(character: string): CharacterScript {
  if (/[\u3041-\u3096]/.test(character)) return 'hiragana'
  if (/[\u30a1-\u30fa]/.test(character)) return 'katakana'
  if (/\p{Script=Han}/u.test(character)) return 'kanji'
  if (/[\uac00-\ud7a3]/.test(character)) return 'syllable'
  if (/[\u1100-\u11ff\u3130-\u318f]/.test(character)) return 'jamo'
  return 'other'
}

/** Characters a learner writes: kana, kanji and Hangul; the index's punctuation marks are left out. */
export const isListed = (character: string): boolean => characterScript(character) !== 'other'

/** Whether a search text finds the character: the character itself, its code point (U+AC00 or hex), or its romanization. */
export function matchesCharacter(character: string, language: 'ja' | 'ko', raw: string): boolean {
  const query = raw.trim().toLowerCase()
  if (!query) return true
  if (character === query || (query.length > 0 && Array.from(query).length === 1 && character === query)) return true
  const hex = character.codePointAt(0)!.toString(16)
  if (query === hex || query === 'u+' + hex || query === 'u' + hex) return true
  const roman = language === 'ja' ? romanizeJapanese(character) : romanizeKorean(character)
  return /^[a-z]+$/.test(query) && roman === query
}
