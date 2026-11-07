import { pinyin as proPinyin } from 'pinyin-pro'

// Whole-phrase pinyin from the catalog's authored readings (neutral tones kept), the app's twin of phrasePinyin in scripts/build-phrase-bank.mjs.
// The pipeline throws on a character no catalog word covers; app text (assistant, media) can contain anything, so a span no word covers
// is read by pinyin-pro for that span only. src/core/pinyin/phrase.parity.test.ts keeps the two in step.

/** Catalog word form -> authored pinyin, one syllable per character, space separated. */
export type PhraseReadings = ReadonlyMap<string, string>

export interface CharReading {
  char: string
  /** Lower-case tone-marked syllable after the 一/不 changes; 'r' for a 儿 that is joined to the syllable before it. */
  syllable: string
  /** True when a catalog word supplied the syllable, false for the pinyin-pro fallback. */
  covered: boolean
  /** 儿 joined to the previous syllable (erhua). */
  joined: boolean
  /** On the first character of a catalog word: its length in characters; 0 elsewhere (and for fallback characters). */
  wordLength: number
}

const HAN_RUN = /\p{Script=Han}+/gu
const TONE_MARKS: Record<number, string> = { 1: 'āēīōūǖ', 2: 'áéíóúǘ', 3: 'ǎěǐǒǔǚ', 4: 'àèìòùǜǹ' }

/** 1 to 4 by the tone mark, 0 for a neutral syllable. */
export function toneOf(syllable: string): number {
  for (const [tone, marks] of Object.entries(TONE_MARKS)) if ([...syllable].some(char => marks.includes(char))) return Number(tone)
  return 0
}

const longestCache = new WeakMap<PhraseReadings, number>()
function longestForm(readings: PhraseReadings): number {
  let longest = longestCache.get(readings)
  if (longest === undefined) {
    longest = 1
    for (const form of readings.keys()) longest = Math.max(longest, [...form].length)
    longestCache.set(readings, longest)
  }
  return longest
}

function fallbackSyllables(span: string[]): string[] {
  try {
    const out = proPinyin(span.join(''), { type: 'array', toneType: 'symbol', nonZh: 'consecutive' }) as string[]
    if (out.length === span.length) return out.map(item => item.toLowerCase())
  } catch { /* fall through to per-character */ }
  return span.map(char => { try { return (proPinyin(char, { toneType: 'symbol' }) as string).toLowerCase() } catch { return '' } })
}

/**
 * One entry per Han character of the text, across the whole text (punctuation and other scripts are skipped, and do not stop 一/不 or 儿 from seeing their neighbours).
 * Words are the longest catalog forms, left to right; their authored syllables are used as written. A character no word covers is read by pinyin-pro together with
 * the other uncovered characters next to it. Then 一 and 不 change tone by the next syllable (bú kè qi, yì diǎn r), and 儿 is joined to the syllable before it.
 */
export function phraseCharReadings(text: string, readings: PhraseReadings): CharReading[] {
  const longest = longestForm(readings)
  const pairs: { char: string; syllable: string; covered: boolean; wordLength: number }[] = []
  for (const run of String(text).match(HAN_RUN) ?? []) {
    const chars = [...run]
    let pending: string[] = []
    const flush = () => {
      if (!pending.length) return
      const syllables = fallbackSyllables(pending)
      pending.forEach((char, i) => pairs.push({ char, syllable: syllables[i] ?? '', covered: false, wordLength: 0 }))
      pending = []
    }
    for (let at = 0; at < chars.length;) {
      let taken = 0
      for (let length = Math.min(longest, chars.length - at); length >= 1 && !taken; length--) {
        const form = chars.slice(at, at + length).join('')
        const reading = readings.get(form)
        const syllables = reading?.trim().toLowerCase().split(/\s+/)
        if (syllables && syllables.length === length) {
          flush()
          syllables.forEach((syllable, i) => pairs.push({ char: chars[at + i], syllable, covered: true, wordLength: i === 0 ? length : 0 }))
          taken = length
        }
      }
      if (taken) at += taken
      else { pending.push(chars[at]); at++ }
    }
    flush()
  }
  const erhua = (at: number) => pairs[at].char === '儿' && at > 0 && !'女男'.includes(pairs[at - 1].char) && !(at + 1 < pairs.length && '子女童'.includes(pairs[at + 1].char))
  return pairs.map(({ char, syllable, covered, wordLength }, at): CharReading => {
    if (erhua(at)) return { char, syllable: 'r', covered, joined: true, wordLength }
    const next = at + 1 < pairs.length ? toneOf(pairs[at + 1].syllable) : 0
    if (char === '不' && syllable === 'bù' && next === 4) syllable = 'bú'
    if (char === '一' && syllable === 'yī' && next && !'第十二三四五六七八九零百千万'.includes(pairs[at - 1]?.char ?? ' ')) syllable = next === 4 ? 'yí' : 'yì'
    return { char, syllable, covered, joined: false, wordLength }
  })
}

/** A phrase's pinyin: syllables separated by spaces, lower case, no punctuation, 儿 joined (yì diǎnr). */
export function phrasePinyin(text: string, readings: PhraseReadings): string {
  const out: string[] = []
  for (const item of phraseCharReadings(text, readings)) {
    if (item.joined && out.length) out[out.length - 1] += item.syllable
    else if (item.syllable) out.push(item.syllable)
  }
  return out.join(' ')
}
