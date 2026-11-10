// How a typed Japanese reading is marked (the Japanese pack's readingInput, reading-input.ts): kana or romaji against the reading of the word.
//   Kana: hiragana or katakana, compared as hiragana; spaces and the middle dot are ignored.
//   Romaji: turned into kana by a table (Hepburn and the common other spellings: si/shi, tu/tsu, sya/sha, doubled consonants for っ, n, nn and n' for ん, long vowels as ou oo uu ei ee aa ii or a macron),
//   then compared as kana. The comparison treats おう and おお, えい and ええ as one sound (both are a long o, a long e), and ぢ づ を as じ ず お.
//   A reading whose は, へ or を is said wa, e or o (こんにちは) is also compared with its romanisation made as Lessons make it (the pack's romaji overrides), read back as kana.
//   A romaji answer that is right but for a long vowel written short (tokyo for とうきょう) is "near": the same verdict the Chinese build gives right syllables with wrong tones.
import { kanaToRomaji, type RomajiOverrides } from '../reading/romaji'
import { romanizeJapanese, toHiragana } from './romanize'

const ROWS: [string, string][] = [
  ['k', 'かきくけこ'], ['g', 'がぎぐげご'], ['s', 'さしすせそ'], ['z', 'ざじずぜぞ'], ['t', 'たちつてと'], ['d', 'だぢづでど'], ['n', 'なにぬねの'],
  ['h', 'はひふへほ'], ['b', 'ばびぶべぼ'], ['p', 'ぱぴぷぺぽ'], ['m', 'まみむめも'], ['r', 'らりるれろ'],
]
const VOWELS = ['a', 'i', 'u', 'e', 'o']
const TABLE = new Map<string, string>()
const add = (romaji: string, kana: string) => { TABLE.set(romaji, kana) }
VOWELS.forEach((vowel, at) => add(vowel, 'あいうえお'[at]))
for (const [consonant, kana] of ROWS) VOWELS.forEach((vowel, at) => add(consonant + vowel, kana[at]))
add('ya', 'や'); add('yu', 'ゆ'); add('yo', 'よ'); add('wa', 'わ'); add('wo', 'を'); add('o', 'お')
// The spellings that differ from the table's regular rows.
add('shi', 'し'); add('chi', 'ち'); add('tsu', 'つ'); add('fu', 'ふ'); add('ji', 'じ')
add('hu', 'ふ'); add('zi', 'じ'); add('ti', 'ち'); add('tu', 'つ'); add('si', 'し'); add('di', 'ぢ'); add('du', 'づ')
// Contracted sounds: consonant + y + a, u, o; sh, ch, j and the other spellings of them.
const small = ['ゃ', 'ゅ', 'ょ']
const ending = ['a', 'u', 'o']
for (const [consonant, kana] of [['k', 'き'], ['g', 'ぎ'], ['n', 'に'], ['h', 'ひ'], ['b', 'び'], ['p', 'ぴ'], ['m', 'み'], ['r', 'り']] as const)
  ending.forEach((vowel, at) => add(consonant + 'y' + vowel, kana + small[at]))
ending.forEach((vowel, at) => {
  for (const spelling of ['sh', 'sy']) add(spelling + vowel, 'し' + small[at])
  for (const spelling of ['ch', 'ty', 'cy']) add(spelling + vowel, 'ち' + small[at])
  for (const spelling of ['j', 'zy', 'jy']) add(spelling + vowel, 'じ' + small[at])
  add('dy' + vowel, 'ぢ' + small[at])
})
add('fi', 'ふぃ'); add('fe', 'ふぇ'); add('she', 'しぇ'); add('che', 'ちぇ'); add('je', 'じぇ')
add('fa', 'ふぁ'); add('fo', 'ふぉ')

const isVowel = (char: string | undefined) => char !== undefined && 'aiueo'.includes(char)
const MACRON: Record<string, string> = { ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'ou', â: 'aa', î: 'ii', û: 'uu', ê: 'ee', ô: 'ou' }
const LIMIT = 48

/** The kana a romaji answer can be read as (more than one when the spelling is ambiguous: konnya is こんや and こんにゃ). Empty when it cannot be read. */
export function romajiToKana(romaji: string): string[] {
  const text = romaji.normalize('NFC').toLowerCase().replace(/[āīūēōâîûêô]/g, char => MACRON[char]).replace(/[\s·・]/g, '')
  const memo = new Map<number, string[]>()
  const parse = (at: number): string[] => {
    if (at >= text.length) return ['']
    const known = memo.get(at)
    if (known) return known
    const out = new Set<string>()
    const follow = (kana: string, next: number) => { for (const rest of parse(next)) { if (out.size >= LIMIT) return; out.add(kana + rest) } }
    const char = text[at], next = text[at + 1]
    if (char === "'" || char === '’' || char === '-') follow('', at + 1)
    else {
      if (char === 'n') {
        if (next === "'" || next === '’') follow('ん', at + 2)
        else if (next === 'n') { follow('ん', at + 2); follow('ん', at + 1) }
        else if (!isVowel(next) && next !== 'y') follow('ん', at + 1)
      }
      if (char === 'm' && next !== undefined && 'bpm'.includes(next)) follow('ん', at + 1)
      if (char !== 'n' && !isVowel(char) && char !== 'y' && char !== 'w' && char !== 'm' && next === char) follow('っ', at + 1)
      if (char === 't' && text.startsWith('ch', at + 1)) follow('っ', at + 1)
      for (const length of [3, 2, 1]) {
        const kana = TABLE.get(text.slice(at, at + length))
        if (kana !== undefined && text.length >= at + length) follow(kana, at + length)
      }
    }
    const list = [...out]
    memo.set(at, list)
    return list
  }
  return parse(0)
}

const VOWEL_KANA: Record<string, string> = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' }
const O_ROW = 'おこそとのほもよろをごぞどぼぽょぉ', E_ROW = 'えけせてねへめれげぜでべぺぇ'
const A_ROW = 'あかさたなはまやらわがざだばぱゃぁ', I_ROW = 'いきしちにひみりぎじぢびぴぃ', U_ROW = 'うくすつぬふむゆるぐずづぶぷゅぅゔ'

/** Kana as one comparable string: hiragana, no spaces, dots or apostrophes, ー spelled as its vowel, ぢ づ を as じ ず お, and a long o or e written one way (おう = おお, えい = ええ). */
export function kanaKey(kana: string): string {
  let out = ''
  for (const char of toHiragana(kana).normalize('NFC').replace(/[\s・·'’-]/g, '')) {
    if (char === 'ー') { out += VOWEL_KANA[romanizeJapanese(out).slice(-1)] ?? ''; continue }
    out += char === 'ぢ' ? 'じ' : char === 'づ' ? 'ず' : char === 'を' ? 'お' : char === 'ゐ' ? 'い' : char === 'ゑ' ? 'え' : char
  }
  return out.replace(new RegExp('([' + O_ROW + '])う', 'g'), '$1お').replace(new RegExp('([' + E_ROW + '])い', 'g'), '$1え')
}

/** The same with every long vowel written short: the key of a romaji answer that forgot the length. */
const shortKey = (kana: string): string => kanaKey(kana)
  .replace(new RegExp('([' + O_ROW + '])お', 'g'), '$1').replace(new RegExp('([' + E_ROW + '])え', 'g'), '$1')
  .replace(new RegExp('([' + A_ROW + '])あ', 'g'), '$1').replace(new RegExp('([' + I_ROW + '])い', 'g'), '$1').replace(new RegExp('([' + U_ROW + '])う', 'g'), '$1')

export interface KanaGrade {
  /** correct; tones: right but for a long vowel written short (counted as Needed a hint); wrong: it reads as kana or romaji and is not the word; self: it cannot be read (kanji, other characters). */
  verdict: 'correct' | 'tones' | 'wrong' | 'self'
  /** The reading that was meant: the accepted reading that matched, else the first. */
  kana?: string
}

const KANA_ONLY = /^[\u3041-\u309f\u30a0-\u30ffー]+$/u
const LATIN_ONLY = /^[a-zāīūēōâîûêô'’-]+$/i

/** What an accepted reading can be typed as: itself, and its romanisation as Lessons show it (the pack's overrides first, so こんにちは is also konnichiwa) read back as kana. */
function spellings(reading: string, overrides: RomajiOverrides): string[] {
  const out = new Set<string>([reading])
  for (const kana of romajiToKana(kanaToRomaji(reading, overrides))) out.add(kana)
  return [...out]
}

/** Grades a typed reading (kana or romaji) against the accepted readings of a word. */
export function gradeKanaReading(answer: string, accepted: readonly string[], overrides: RomajiOverrides = {}): KanaGrade {
  const typed = answer.normalize('NFC').trim().replace(/[\s・·]/g, '')
  const meant = accepted[0]
  if (!typed) return { verdict: 'self', kana: meant }
  const kana = KANA_ONLY.test(typed), latin = LATIN_ONLY.test(typed)
  if (!kana && !latin) return { verdict: 'self', kana: meant }
  const options = accepted.map(reading => ({ reading, spelled: spellings(reading, overrides) }))
  const candidates = kana ? [typed] : romajiToKana(typed)
  for (const option of options) if (candidates.some(candidate => option.spelled.some(spelled => kanaKey(spelled) === kanaKey(candidate)))) return { verdict: 'correct', kana: option.reading }
  if (latin) for (const option of options) if (candidates.some(candidate => option.spelled.some(spelled => shortKey(spelled) === shortKey(candidate)))) return { verdict: 'tones', kana: option.reading }
  return { verdict: 'wrong', kana: meant }
}
