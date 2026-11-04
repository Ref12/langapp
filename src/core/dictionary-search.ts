import { parseReadings, type Syllable } from './pinyin'

// Dictionary search looks only at an entry's own characters, pronunciations and meanings.
// Ranks (lower is better): 0 exact character or exact pronunciation, 1 pronunciation prefix or word containing the query,
// 2 exact meaning, 3 meaning contains the query. Callers use FALLBACK for a weaker last-resort match.
export const FALLBACK = 4

export interface SearchTarget {
  /** Exact spellings: a word, a pattern, or one character. */
  text?: readonly string[]
  /** When set, the target is a single character that matches if the query contains it. */
  character?: string
  /** Raw pinyin field (cached parse) or already-parsed readings. */
  pr?: string
  readings?: readonly (readonly Syllable[])[]
  /** Meanings, one string (separators ; , /). */
  ds?: string
}

const parsed = new Map<string, Syllable[][]>()
function readingsOf(target: SearchTarget): readonly (readonly Syllable[])[] {
  if (target.readings) return target.readings
  if (!target.pr) return []
  let value = parsed.get(target.pr)
  if (!value) { value = parseReadings(target.pr); parsed.set(target.pr, value) }
  return value
}

const PINYIN_QUERY = /^(?:[\p{Script=Latin}\p{M}:'\-0-5])+$/u

/** 0 no match, 1 query is a prefix of the reading, 2 the whole reading. A toneless syllable fits any tone; a number or tone mark fits only that tone. */
function matchReading(query: string, syllables: readonly Syllable[]): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0
  const go = (k: number, at: number): void => {
    if (best === 2) return
    if (at === query.length) { if (k === syllables.length) best = 2; else if (k > 0 && best < 1) best = 1; return }
    if (k === syllables.length) return
    const syllable = syllables[k]
    const rest = query.slice(at)
    const forms = [syllable.marked.normalize('NFC'), `${syllable.base}${syllable.tone}`, ...(syllable.tone === '5' ? [`${syllable.base}0`] : []), syllable.base]
    for (const form of new Set(forms)) if (rest.startsWith(form)) go(k + 1, at + form.length)
    if (syllable.base.startsWith(rest) && best < 1) best = 1
  }
  go(0, 0)
  return best
}

const stripArticle = (value: string) => value.replace(/^(?:to|a|an|the)\s+/, '')

export interface Matcher {
  empty: boolean
  /** The rank of a target, or undefined when it does not match. */
  rank(target: SearchTarget): number | undefined
}

export function makeMatcher(raw: string): Matcher {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!lower) return { empty: true, rank: () => 0 }
  const hanQuery = /\p{Script=Han}/u.test(lower)
  const spelled = lower.normalize('NFC').replace(/u:|v/g, 'ü').replace(/[\s'-]/g, '')
  const pinyin = !hanQuery && PINYIN_QUERY.test(spelled) ? spelled : undefined
  const queryChars = new Set(Array.from(lower).filter(character => /\p{Script=Han}/u.test(character)))
  const bare = stripArticle(lower)
  return {
    empty: false,
    rank(target) {
      let best: number | undefined
      const take = (value: number) => { if (best === undefined || value < best) best = value }
      if (hanQuery) {
        if (target.character !== undefined && queryChars.has(target.character)) take(0)
        for (const text of target.text ?? []) { if (text === lower) take(0); else if (text.includes(lower)) take(1) }
      }
      if (pinyin) for (const syllables of readingsOf(target)) { const match = matchReading(pinyin, syllables); if (match === 2) take(0); else if (match === 1) take(1) }
      if (!hanQuery && target.ds) {
        const meaning = target.ds.toLowerCase()
        const parts = meaning.split(/[;,/]/).map(part => part.trim())
        if (parts.some(part => part === lower || stripArticle(part) === bare)) take(2)
        else if (meaning.includes(lower)) take(3)
      }
      return best
    },
  }
}

/** A character's own readings and meanings, taken from the words that contain it: single-character words in full, and its syllable in longer words. */
export function ownCharacterData(character: string, words: readonly { ch: string; pr: string; ds: string }[]): { readings: Syllable[][]; ds: string } {
  const readings: Syllable[][] = []
  const meanings: string[] = []
  for (const word of words) {
    const chars = Array.from(word.ch)
    const options = parseReadings(word.pr)
    if (chars.length === 1) { if (chars[0] === character) { readings.push(...options); meanings.push(word.ds) } continue }
    chars.forEach((value, index) => { if (value === character) for (const option of options) if (option.length === chars.length) readings.push([option[index]]) })
  }
  return { readings, ds: meanings.join('; ') }
}
