// The Japanese Characters list of the Dictionary: the kana in table order (the basic sets, then voiced, then small forms), the kanji of the lesson words, and the other kanji the stroke data has as look-up.
// A character is listed only when the stroke data has it. The Dictionary page reads this through getPack().writing.characterList and never tests the language.
import { kanaToRomaji } from '../reading/romaji'
import { toHiragana } from './romanize'
import { isHan } from '../characters/scripts'
import type { PackCharacterList } from './writing'

// Hiragana in the usual table order (a i u e o, ka ki ku ke ko ...); the katakana sets are the same letters 0x60 further on.
const BASIC = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
const VOICED = 'がぎぐげござじずぜぞだぢづでどばぱびぴぶぷべぺぼぽゔ'
const SMALL = 'ぁぃぅぇぉっゃゅょゎゕゖ'
const katakana = (hiragana: string) => Array.from(hiragana, letter => String.fromCharCode(letter.charCodeAt(0) + 0x60)).join('')

const SMALL_NAME: Record<string, string> = { ぁ: 'small a', ぃ: 'small i', ぅ: 'small u', ぇ: 'small e', ぉ: 'small o', っ: 'small tsu (doubles the next consonant)', ゃ: 'small ya', ゅ: 'small yu', ょ: 'small yo', ゎ: 'small wa', ゕ: 'small ka', ゖ: 'small ke' }
const ROMAJI: Record<string, string> = { ゔ: 'vu', ゐ: 'wi', ゑ: 'we' }

/** The sound of a kana as the learner reads it: the hiragana letter and its romaji ("か · ka"); a small kana says what it is. */
export function kanaSound(character: string): string | undefined {
  const hiragana = toHiragana(character)
  if (!/^[\u3041-\u3096]$/.test(hiragana)) return undefined
  return `${hiragana} \u00b7 ${SMALL_NAME[hiragana] ?? ROMAJI[hiragana] ?? kanaToRomaji(hiragana)}`
}

export function japaneseCharacterList(has: (character: string) => boolean): PackCharacterList {
  const listed = (hiragana: string, convert: (text: string) => string) => Array.from(convert(hiragana)).filter(has)
  const kana = (convert: (text: string) => string) => [...listed(BASIC, convert), ...listed(VOICED, convert), ...listed(SMALL, convert)]
  return {
    groups: () => [
      { id: 'hiragana', title: 'Hiragana', characters: kana(text => text) },
      { id: 'katakana', title: 'Katakana', characters: kana(katakana) },
      { id: 'kanji', title: 'Kanji', role: 'lessons', characters: [] },
      { id: 'kanji-all', title: 'All kanji', role: 'lookup', characters: [] },
    ],
    classify: character => isHan(character) ? 'kanji' : undefined,
    reading: kanaSound,
  }
}
