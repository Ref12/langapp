// The Chinese speech step (the pack's `speechText`, see speech-text.ts). Speech engines guess the reading of a character with several readings (还 hái / huán, 行 háng / xíng) and often guess wrong. The app knows the reading
// in its own sentences, so a polyphonic character is replaced, in the text sent to the voice only, by a common character with that one reading (还 hái -> 孩): the screen keeps the real character.
// The table is generated offline from the app's data by scripts/build-zh-polyphones.mjs (data/zh-polyphones.generated.json). Where the reading comes from, first match wins:
//  1. the caller's `reading` hint (pinyin of the text), when it has one syllable per Han character;
//  2. the pinyin the app noted for this exact text (the phrase bank's sentences, the catalog's examples and words): noteChineseReadings;
//  3. a dictionary word that pins it (银行 yín háng, 还书 huán shū): the text is cut longest match first, and a character no word decides is left alone.
// 了 的 地 得 着 么 都 和 一 不 are not in the table: the voices read them well, and tone sandhi stays the voice's job.
import { parseReadings } from '../pinyin'
import generated from './data/zh-polyphones.generated.json'
import type { SpeechHint } from './speech-text'

const substitutes = generated.substitutes as Record<string, Record<string, string>>
const words = generated.words as Record<string, string>
const HAN = /\p{Script=Han}/u
const LONGEST = Math.max(1, ...Object.keys(words).map(word => [...word].length))

/** The substitution table: character -> reading -> the character that has only that reading. */
export const chinesePolyphones = substitutes
/** The words whose reading pins a polyphonic character. */
export const chinesePolyphoneWords = words

interface Known { reading: string; ambiguous: boolean }
const known = new Map<string, Known>()
const normal = (text: string) => text.normalize('NFC').trim()

/** The one reading of a pinyin text as marked syllables, or undefined when it has none or several. */
function syllablesOf(reading: string | undefined): string[] | undefined {
  if (!reading) return undefined
  const readings = parseReadings(reading)
  return readings.length === 1 ? readings[0].map(syllable => syllable.marked.normalize('NFC').toLowerCase()) : undefined
}

/** Tells the Chinese pack the pinyin of a text (a sentence, a word). A text noted with two different readings is ambiguous and not guessed. */
export function noteChineseReadings(pairs: Iterable<readonly [string, string | undefined]>): void {
  for (const [raw, reading] of pairs) {
    const text = normal(raw)
    const syllables = syllablesOf(reading)
    if (!text || !syllables || !HAN.test(text)) continue
    const joined = syllables.join(' ')
    const old = known.get(text)
    if (!old) known.set(text, { reading: joined, ambiguous: false })
    else if (old.reading !== joined) old.ambiguous = true
  }
}
/** For tests: forget what was noted. */
export function resetChineseReadings(): void { known.clear() }
export const knownChineseReading = (text: string): string | undefined => { const entry = known.get(normal(text)); return entry && !entry.ambiguous ? entry.reading : undefined }

const substitute = (char: string, syllable: string | undefined): string => (syllable ? substitutes[char]?.[syllable] : undefined) ?? char

/** The text with each polyphonic character replaced by its reading's substitute; syllables are one per Han character, in order. */
function bySyllables(chars: string[], syllables: string[]): string {
  let at = 0
  return chars.map(char => (HAN.test(char) ? substitute(char, syllables[at++]) : char)).join('')
}

/** No reading known: cut the Han runs longest dictionary word first; a word with a polyphonic character decides it, anything else stays as it is. */
function byWords(chars: string[]): string {
  let out = ''
  for (let at = 0; at < chars.length;) {
    if (!HAN.test(chars[at]) || !substitutes[chars[at]] && !hasWordFrom(chars, at)) { out += chars[at++]; continue }
    let done = false
    for (let length = Math.min(LONGEST, chars.length - at); length >= 2 && !done; length--) {
      const slice = chars.slice(at, at + length)
      const reading = slice.every(char => HAN.test(char)) ? words[slice.join('')] : undefined
      if (reading) { out += bySyllables(slice, reading.split(' ')); at += length; done = true }
    }
    if (!done) out += chars[at++]
  }
  return out
}
const hasWordFrom = (chars: string[], at: number): boolean => at + 1 < chars.length && HAN.test(chars[at + 1])

/** The Chinese pack's speechText. `kind: 'character'` is one character said for the word it is practised in (hint.within) or a lesson word (hint.lesson). */
export function chineseSpeechText(text: string, hint?: SpeechHint): string {
  const bare = normal(text)
  if (!bare || !HAN.test(bare)) return text
  const chars = [...bare]
  const hanCount = chars.filter(char => HAN.test(char)).length
  if (hint?.kind === 'character') {
    if (chars.length !== 1 || !substitutes[bare]) return text
    for (const word of [...(hint.within ? [hint.within] : []), ...(hint.lesson ?? [])]) {
      const syllables = syllablesOf(word.reading) ?? syllablesOf(knownChineseReading(word.text))
      const letters = [...normal(word.text)].filter(char => HAN.test(char))
      const at = letters.indexOf(bare)
      if (syllables && syllables.length === letters.length && at >= 0 && letters.filter(char => char === bare).length === 1) return substitute(bare, syllables[at])
    }
    return text
  }
  const syllables = syllablesOf(hint?.reading) ?? syllablesOf(knownChineseReading(bare))
  if (syllables && syllables.length === hanCount) return bySyllables(chars, syllables)
  return byWords(chars)
}
