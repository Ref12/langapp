import type { BankPhrase } from '../phrases/contracts'
import { phraseKey } from '../phrases/key'
import { formatPinyin, parseReadings, withTone, type Syllable } from '../pinyin'

// Local grading for typed or spoken Chinese (design section 5a): no AI, no embeddings (tested and dropped). An answer is compared on its Han text with the
// accepted answers (the model answer plus other bank phrases with the same words and the same English), then, when it differs, word by word with the closest one.

/** Particles that are often optional: a difference that only touches them counts as right when an accepted answer shows they can be left out. */
export const OPTIONAL_WORDS: readonly string[] = ['了', '的']

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()
export const englishKey = (text: string) => norm(text).replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
export const pinyinKey = (text: string) => formatPinyin(text.trim(), 'marks').toLowerCase().replace(/[^\p{L}\p{M}]/gu, '').normalize('NFC')
const wordSetKey = (phrase: Pick<BankPhrase, 'words'>) => [...new Set(phrase.words)].sort().join('|')

/** The model answer first, then every other bank phrase with the same word set and the same English (by Han text, once each). The dataset's pre-generated accepted answers join through `extra`. */
export function acceptedAnswers(model: Pick<BankPhrase, 'zh' | 'en' | 'words'>, bank: readonly Pick<BankPhrase, 'zh' | 'en' | 'words'>[], extra: readonly string[] = []): string[] {
  const seen = new Set([phraseKey(model.zh)])
  const out = [model.zh]
  const en = englishKey(model.en)
  const words = wordSetKey(model)
  for (const candidate of [...bank.filter(phrase => englishKey(phrase.en) === en && wordSetKey(phrase) === words).map(phrase => phrase.zh), ...extra]) {
    const key = phraseKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key); out.push(candidate)
  }
  return out
}

/** The accepted English wordings of a phrase: its own, and the English of other bank phrases with the same Chinese words and Han text. */
export function acceptedEnglish(model: Pick<BankPhrase, 'zh' | 'en'>, bank: readonly Pick<BankPhrase, 'zh' | 'en'>[], extra: readonly string[] = []): string[] {
  const seen = new Set([englishKey(model.en)])
  const out = [model.en]
  for (const wording of extra) { const key = englishKey(wording); if (key && !seen.has(key)) { seen.add(key); out.push(wording) } }
  for (const phrase of bank) {
    if (phraseKey(phrase.zh) !== phraseKey(model.zh)) continue
    const key = englishKey(phrase.en)
    if (key && !seen.has(key)) { seen.add(key); out.push(phrase.en) }
  }
  return out
}

/** Words of a text: the longest known form at each position, an uncovered Han character on its own. Punctuation and spaces are dropped. */
export function segmentWords(text: string, forms: ReadonlySet<string>): string[] {
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

/** Chinese wordings the English cannot tell apart: a swap of these is as right as the model answer. Add rows to extend. */
export interface Equivalence { words: readonly string[]; /** True when the English leaves the choice open. */ when: (english: string) => boolean; note: (given: string, expected: string) => string }
const HE_SHE = /\b(he|she|him|her|his|hers|himself|herself)\b/i
export const EQUIVALENT_WORDS: readonly Equivalence[] = [
  { words: ['你', '您'], when: () => true, note: () => '您 is the polite form; 你 is fine here.' },
  { words: ['他', '她', '它'], when: english => !HE_SHE.test(english) && /\b(it|its)\b/i.test(english), note: () => '他, 她 and 它 are all "it" in English; any is fine here.' },
  { words: ['他们', '她们', '它们'], when: english => !HE_SHE.test(english) && /\b(they|them|their)\b/i.test(english), note: () => '他们, 她们 and 它们 are all "they" in English; any is fine here.' },
]
const WH = /\b(who|whom|whose|what|which|when|where|why|how)\b/i
/** A plain yes/no question in English: ends in ? and has no question word. */
export const isYesNoQuestion = (english: string) => /\?\s*$/.test(english) && !WH.test(english)
/** 好不好 becomes 好吗, so the two question forms compare equal. */
const asMa = (text: string) => text.replace(/(.)不\1/g, '$1吗')

/** All differences are one allowed swap (or one question form for the other): the answer is right, with a note. */
function equivalentChoice(answer: string, accepted: readonly string[], differences: readonly Difference[], english: string): { closest: string; note: string } | undefined {
  if (!english) return undefined
  if (isYesNoQuestion(english)) {
    const mine = phraseKey(asMa(answer))
    const hit = accepted.find(candidate => /不/.test(candidate + answer) && phraseKey(asMa(candidate)) === mine)
    if (hit) return { closest: hit, note: 'Both 吗 and A-not-A make a yes/no question; either is fine here.' }
  }
  if (!differences.length || !differences.every(difference => difference.kind === 'instead')) return undefined
  const swaps = differences as { kind: 'instead'; word: string; expected: string }[]
  const rule = EQUIVALENT_WORDS.find(entry => entry.when(english) && swaps.every(swap => entry.words.includes(swap.word) && entry.words.includes(swap.expected)))
  if (!rule) return undefined
  const first = swaps[0]
  return { closest: accepted[0], note: rule.note(first.word, first.expected) }
}

export type Difference =
  | { kind: 'missing'; word: string }
  | { kind: 'extra'; word: string }
  | { kind: 'swapped'; a: string; b: string }
  | { kind: 'instead'; word: string; expected: string }
  | { kind: 'order' }

export function describeDifference(difference: Difference): string {
  switch (difference.kind) {
    case 'missing': return `missing ${difference.word}`
    case 'extra': return `extra ${difference.word}`
    case 'swapped': return `word order: ${difference.a} comes before ${difference.b}`
    case 'instead': return `${difference.word} instead of ${difference.expected}`
    case 'order': return 'the word order differs'
  }
}

const count = (words: readonly string[], word: string) => words.filter(item => item === word).length

function lcs(a: readonly string[], b: readonly string[]): number {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1])
  return table[a.length][b.length]
}

/** The differences between an accepted answer's words and the learner's, as specific as the words allow. */
export function diffWords(expected: readonly string[], given: readonly string[]): Difference[] {
  const missing: string[] = [], extra: string[] = []
  for (const word of new Set([...expected, ...given])) {
    const delta = count(expected, word) - count(given, word)
    for (let index = 0; index < delta; index++) missing.push(word)
    for (let index = 0; index < -delta; index++) extra.push(word)
  }
  const out: Difference[] = []
  if (!missing.length && !extra.length) {
    const wrong = expected.map((word, index) => given[index] === word ? -1 : index).filter(index => index >= 0)
    if (wrong.length === 2 && expected[wrong[0]] === given[wrong[1]] && expected[wrong[1]] === given[wrong[0]]) out.push({ kind: 'swapped', a: expected[wrong[0]], b: expected[wrong[1]] })
    else if (wrong.length) out.push({ kind: 'order' })
    return out
  }
  // A word dropped and another added at the same place is a substitution.
  const used = new Set<string>()
  for (const word of missing) {
    const at = expected.indexOf(word)
    const swap = extra.find(other => !used.has(other) && given.indexOf(other) >= 0 && Math.abs(given.indexOf(other) - at) <= 1)
    if (swap) { used.add(swap); out.push({ kind: 'instead', word: swap, expected: word }) } else out.push({ kind: 'missing', word })
  }
  for (const word of extra) if (!used.has(word)) out.push({ kind: 'extra', word })
  return out
}

export interface ChineseGrade {
  /** correct: an accepted answer, or a difference only in optional words. diff: shown to the learner, who marks it themselves. */
  verdict: 'correct' | 'diff'
  /** The accepted answer that matched or came closest. */
  closest: string
  /** Matched an accepted answer other than the model answer. */
  alternative: boolean
  /** The differences that count, after optional words are set aside. */
  differences: Difference[]
  /** Optional words (了, 的) the learner added or left out that were set aside. */
  ignored: string[]
  messages: string[]
  /** A one-line reason the answer is as right as the model one (an equivalent wording). */
  note?: string
}

/** Grades a Chinese answer against the accepted answers. `forms` are the words the segmenter knows (the learner's vocabulary and the phrases' own words). */
export function gradeChinese(answer: string, accepted: readonly string[], forms: ReadonlySet<string>, optional: readonly string[] = [], english = ''): ChineseGrade {
  const key = phraseKey(answer)
  const exact = accepted.findIndex(candidate => phraseKey(candidate) === key)
  if (key && exact >= 0) return { verdict: 'correct', closest: accepted[exact], alternative: exact > 0, differences: [], ignored: [], messages: [] }
  const given = segmentWords(answer, forms)
  const options = accepted.map(candidate => ({ candidate, words: segmentWords(candidate, forms) }))
  let best = options[0]
  let cost = Infinity
  for (const option of options) {
    const distance = option.words.length + given.length - 2 * lcs(option.words, given)
    if (distance < cost) { cost = distance; best = option }
  }
  const all = diffWords(best.words, given)
  const equal = equivalentChoice(answer, accepted, all, english)
  if (equal) return { verdict: 'correct', closest: equal.closest, alternative: true, differences: [], ignored: [], messages: [], note: equal.note }
  const ignored: string[] = []
  const differences = all.filter(difference => {
    const word = difference.kind === 'missing' || difference.kind === 'extra' ? difference.word : undefined
    if (!word) return true
    // a word the dataset marks optional for this phrase may always be left out or added
    if (optional.includes(word)) { ignored.push(word); return false }
    if (!OPTIONAL_WORDS.includes(word)) return true
    // optional only when an accepted answer shows it can be left out (or, for an extra one, when the accepted answers lack it)
    const fewest = Math.min(...options.map(option => count(option.words, word)))
    if (fewest < Math.max(count(given, word), count(best.words, word))) { ignored.push(word); return false }
    return true
  })
  if (!differences.length && given.length) return { verdict: 'correct', closest: best.candidate, alternative: true, differences, ignored, messages: ignored.map(word => `${word} is optional here`) }
  return { verdict: 'diff', closest: best.candidate, alternative: false, differences, ignored, messages: differences.map(describeDifference) }
}

/** Grades pinyin: right on a normalised match with an accepted wording, otherwise the learner marks it. */
export function gradeSimple(answer: string, accepted: readonly string[], language: 'en' | 'py'): 'correct' | 'self' {
  if (language === 'en') return gradeMeaning(answer, accepted).verdict === 'correct' || gradeMeaning(answer, accepted).verdict === 'near' ? 'correct' : 'self'
  return gradePinyin(answer, accepted).verdict === 'correct' ? 'correct' : 'self'
}

const TONE_MARK = /[\u0304\u0301\u030c\u0300]/
const MARK_TONE: Record<string, string> = { '\u0304': '1', '\u0301': '2', '\u030c': '3', '\u0300': '4' }

/**
 * Reads typed pinyin against the syllables expected, so neither spaces nor a missing tone get in the way: numbers (xue2xi2, xue2 xi2) or marks (xué xí), 5, 0 or nothing for the neutral tone,
 * v or u: for ü, any case, apostrophes and hyphens ignored. Returns the tone typed for each syllable, or undefined when the letters are not these syllables.
 */
export function typedTones(typed: string, expected: readonly Syllable[]): string[] | undefined {
  const text = typed.toLowerCase().replace(/u:|v/g, 'ü').normalize('NFD').replace(/[\s'’\-·]/g, '')
  if (!text) return undefined
  let at = 0
  const tones: string[] = []
  for (const syllable of expected) {
    let mark: string | undefined
    for (const letter of syllable.base.toLowerCase().normalize('NFD')) {
      if (text[at] !== letter) return undefined
      at++
      while (TONE_MARK.test(text[at] ?? '')) { const found = MARK_TONE[text[at]]; if (mark && mark !== found) return undefined; mark = found; at++ }
    }
    const digit = /[0-5]/.test(text[at] ?? '') ? text[at++] : undefined
    const number = digit === '0' ? '5' : digit
    if (mark && number && mark !== number) tones.push('x')
    else tones.push(mark ?? number ?? '5')
  }
  return at === text.length ? tones : undefined
}

export interface PinyinGrade {
  /** correct: right syllables and tones. tones: right syllables, a tone missing or wrong (counted as Needed a hint). self: the letters differ; the learner marks it. */
  verdict: 'correct' | 'tones' | 'self'
  /** The expected reading, syllable by syllable, with the ones whose tone was off. */
  syllables?: { marked: string; off: boolean }[]
}

/** Grades typed pinyin with tones (see typedTones). Right syllables with a missing or wrong tone are never self-marked. */
export function gradePinyin(answer: string, accepted: readonly string[]): PinyinGrade {
  let nearest: PinyinGrade | undefined
  for (const candidate of accepted) for (const reading of parseReadings(candidate)) {
    const tones = typedTones(answer, reading)
    if (!tones) continue
    const syllables = reading.map((syllable, index) => ({ marked: syllable.marked, off: tones[index] !== syllable.tone }))
    if (!syllables.some(entry => entry.off)) return { verdict: 'correct', syllables }
    nearest ??= { verdict: 'tones', syllables }
  }
  return nearest ?? { verdict: 'self' }
}

/** The tone-marked form of what is typed, for a live preview: as typed when it fits an accepted reading, else the general conversion; empty when there is nothing to show. */
export function previewPinyin(answer: string, accepted: readonly string[]): string {
  if (!answer.trim()) return ''
  for (const candidate of accepted) for (const reading of parseReadings(candidate)) {
    const tones = typedTones(answer, reading)
    if (tones && !tones.includes('x')) return reading.map((syllable, index) => withTone(syllable.base, tones[index])).join(' ')
  }
  const general = formatPinyin(answer.trim().replace(/\s+/g, ' '), 'marks')
  return general
}

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'is', 'are', 'am', 'be'])
/** Lower case, no punctuation or articles, no leading "to": the comparable form of an English meaning. */
export const meaningKey = (text: string) => norm(text).replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim().replace(/^to /, '')
const stem = (word: string) => word.length > 3 && word.endsWith('ies') ? word.slice(0, -3) + 'y' : word.length > 3 && /(ses|xes|ches|shes)$/.test(word) ? word.slice(0, -2) : word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
const contentWords = (text: string) => meaningKey(text).split(' ').filter(word => word && !STOP.has(word)).map(stem)

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i)
}

/** The senses of a gloss: split on ; and , (and the full-width forms), without empty parts. */
export const sensesOf = (gloss: string): string[] => gloss.split(/[;；,，]/).map(part => part.trim()).filter(Boolean)

export interface MeaningGrade {
  /** correct: a sense. near: one small typo or a plural, counted as correct with a note. wrong: Chinese in the answer or nothing in common. self: partial overlap, the learner marks it. */
  verdict: 'correct' | 'near' | 'wrong' | 'self'
  note?: string
  /** The accepted wording that matched or came closest. */
  closest?: string
}

/** Grades an English meaning (a word's senses, or a sentence's wordings) locally, no AI. */
export function gradeMeaning(answer: string, accepted: readonly string[]): MeaningGrade {
  if (/\p{Script=Han}/u.test(answer)) return { verdict: 'wrong', note: 'The answer should be in English.' }
  const key = meaningKey(answer)
  if (!key) return { verdict: 'wrong' }
  const options = accepted.map(text => ({ text, key: meaningKey(text) })).filter(option => option.key)
  const exact = options.find(option => option.key === key)
  if (exact) return { verdict: 'correct', closest: exact.text }
  for (const option of options) {
    const plural = stem(key) === stem(option.key) && key.split(' ').length === 1 && option.key.split(' ').length === 1
    if (plural || (key.length >= 4 && option.key.length >= 4 && editDistanceAtMostOne(key, option.key)))
      return { verdict: 'near', closest: option.text, note: `Counted as correct; the usual spelling is "${option.text}".` }
  }
  const given = new Set(contentWords(answer))
  let best: { text: string; shared: number } | undefined
  for (const option of options) {
    const shared = contentWords(option.text).filter(word => given.has(word)).length
    if (shared > (best?.shared ?? 0)) best = { text: option.text, shared }
  }
  if (!best) return { verdict: 'wrong', closest: options[0]?.text }
  return { verdict: 'self', closest: best.text }
}
