/** Which script a character is written in. Shared by the writing entry of the language packs (core/language/writing.ts) and the writing routes. */
const HAN = /\p{Script=Han}/u
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/u
const HANGUL = /[\u1100-\u11ff\u3131-\u318e\uac00-\ud7a3]/u
export const isHan = (character: string): boolean => HAN.test(character)
export const isKana = (character: string): boolean => KANA.test(character)
export const isHangul = (character: string): boolean => HANGUL.test(character)
