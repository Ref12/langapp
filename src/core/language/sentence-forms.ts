// What a pack says about the sentence forms of Practice (Word order, Fill the gap, Dictation and typing the sentence): how a built or typed sentence is marked, the wrong tiles, and where a word sits in a sentence.
// The builders (session/bank-forms.ts) and the question screens ask the pack; none tests the language. Chinese is the code that was in those builders and in gradeChinese, moved; Japanese and Korean are in japanese-sentence.ts.
import type { ChineseGrade } from '../session/grade'
import { gradeChinese } from '../session/grade'
import { SUBJECT_WORDS, type ParticleLanguage, type SubjectPerson } from './particles'
import { blankJapanese, gradeJapaneseSentence, japaneseDistractors, JA_RULE, KO_RULE, spellKoreanTokens, spellTokens } from './japanese-sentence'
import type { SegmentWords, SentenceToken } from './phrase-identity'

/** One token of a sentence as written, with its reading in kana; `grammar` marks a particle or an ending. */
export interface SpelledToken { text: string; reading: string; grammar?: boolean }

/** What `spell` reads: the segmenter's input, the reading of a vocabulary word by its label, and the sentence's own reading when it has no tokens. */
export interface SpellInput extends SegmentWords { reading?: (label: string) => string | undefined; wholeReading?: string }

/** A built sentence (`placed`: the tiles in the order the learner put them) or a typed one (`text`), and what counts as right. */
export interface SentenceInput {
  text: string
  placed?: readonly string[]
  accepted: readonly string[]
  /** The spelled tokens of each accepted wording, by index; an entry is undefined when the data cannot say. */
  spelled?: readonly (readonly SpelledToken[] | undefined)[]
  /** The written forms the segmenter knows. */
  forms: ReadonlySet<string>
  optional?: readonly string[]
  /** The English the sentence answers, for the wordings it leaves open. */
  english?: string
}
export type SentenceGrade = ChineseGrade

export interface DistractorInput {
  tiles: readonly string[]
  /** The words the learner knows: as stored, and as shown. */
  known: readonly { text: string; shown: string }[]
  rng: () => number
  shuffle: <T>(items: readonly T[], rng: () => number) => T[]
}

/** A vocabulary word as the gap needs it. */
export interface BlankWord { ref: string; /** The word's label, which a sentence token's `word` carries. */ label: string; ch: string; pr: string; cl?: string; band: string | number
  /** The word is a set phrase or whole expression (the bank uses it alone as a sentence), not a single word of a sentence. */ phrase?: boolean }
export interface BlankInput {
  sentence: string
  tokens?: readonly SentenceToken[]
  surface?: (label: string) => string | undefined
  target: BlankWord
  known: readonly BlankWord[]
  rng: () => number
  shuffle: <T>(items: readonly T[], rng: () => number) => T[]
}
/** The sentence with the word blanked, the word as it stands in the sentence, and the wrong options (in the same form as the answer). */
export interface Blanked { gapped: string; answer: string; wrong: string[] }

export interface SentenceForms {
  /** The tokens of a sentence with their readings, for marking a typed sentence; undefined when the pack marks by the text alone. */
  spell(text: string, words: SpellInput): SpelledToken[] | undefined
  /** The leading words of a sentence that may be left out when it is typed from its English (Korean 저는); undefined or empty: none. */
  optionalWords?(tokens: readonly SpelledToken[]): string[]
  /** Does the sentence leave its subject open, so that the English of it may have any subject pronoun? (Japanese and Korean without a subject; undefined: no.) */
  subjectOpen?(sentence: string): boolean
  /** Marks a built or typed sentence against the accepted wordings. */
  gradeSentence(input: SentenceInput): SentenceGrade
  /** The wrong tiles of a sentence. */
  distractors(input: DistractorInput): string[]
  /** Where a word sits in a sentence; undefined when it cannot be found or too few options exist. */
  blank(input: BlankInput): Blanked | undefined
}

export const zhSentence: SentenceForms = {
  spell: () => undefined,
  gradeSentence: input => gradeChinese(input.text, input.accepted, input.forms, input.optional, input.english),
  distractors: ({ tiles, known, rng, shuffle }) => {
    const inside = new Set(tiles)
    return shuffle(known.filter(unit => !inside.has(unit.text) && unit.text.length <= 3).map(unit => unit.shown).filter(form => !inside.has(form)), rng).slice(0, tiles.length >= 4 ? 2 : 1)
  },
  blank: ({ sentence, target, known, rng, shuffle }) => {
    if (!target.ch || !sentence.includes(target.ch)) return undefined
    const band = Number(target.band ?? 1)
    const inPhrase = (form: string) => sentence.includes(form) || form.includes(target.ch) || target.ch.includes(form)
    const pool = shuffle(known, rng).filter(unit => unit.ref !== target.ref && !inPhrase(unit.ch))
      .sort((a, b) => Math.abs(Number(a.band) - band) - Math.abs(Number(b.band) - band) || Math.abs(a.ch.length - target.ch.length) - Math.abs(b.ch.length - target.ch.length))
    const wrong: string[] = []
    for (const unit of pool) { if (wrong.length >= 3) break; if (!wrong.includes(unit.ch)) wrong.push(unit.ch) }
    if (wrong.length < 2) return undefined
    return { gapped: sentence.replace(target.ch, '\uFF3F\uFF3F'), answer: target.ch, wrong }
  },
}

/** The first subject phrase of a sentence's tokens: a pronoun from the pack's table and a subject or topic particle (私は, 私たちは, 저는), each a token or the two split into pieces. The phrase as written and who it names; undefined when the sentence does not open with one, or it is the whole sentence. */
export function leadingSubject(language: ParticleLanguage, tokens: readonly SpelledToken[]): { text: string; person: SubjectPerson } | undefined {
  const { words, particles } = SUBJECT_WORDS[language]
  let joined = ''
  for (let at = 0; at < Math.min(3, tokens.length - 1); at++) {
    joined += tokens[at].text
    for (const [word, person] of Object.entries(words)) for (const particle of particles) if (joined === word + particle) return { text: joined, person }
  }
  return undefined
}
const subjectRegex = (language: ParticleLanguage): RegExp => {
  const { words, particles } = SUBJECT_WORDS[language]
  const alternatives = (items: string[]) => items.sort((a, b) => b.length - a.length).join('|')
  return new RegExp(`${language === 'ko' ? '(?<![\\uAC00-\\uD7A3])' : ''}(?:${alternatives(Object.keys(words))})(?:${alternatives([...particles])})`, 'u')
}
const SUBJECT_REGEX: Record<ParticleLanguage, RegExp> = { ja: subjectRegex('ja'), ko: subjectRegex('ko') }
/** Does a sentence name its subject anywhere (私は…, …彼女が…)? One that does not says nothing about who: its English subject is open. */
export const hasSubject = (language: ParticleLanguage, sentence: string): boolean => SUBJECT_REGEX[language].test(sentence.normalize('NFKC'))

/** Japanese: tokens with readings; kana for kanji, katakana for hiragana and romaji are right (japanese-sentence.ts). */
export const jaSentence: SentenceForms = {
  spell: spellTokens,
  optionalWords: tokens => { const subject = leadingSubject('ja', tokens); return subject ? [subject.text] : [] },
  subjectOpen: sentence => !hasSubject('ja', sentence),
  gradeSentence: input => gradeJapaneseSentence(JA_RULE, input),
  distractors: ({ tiles }) => japaneseDistractors(JA_RULE, tiles),
  blank: input => blankJapanese(JA_RULE, input),
}

/** Korean: tokens as the data cuts them (a particle is its own tile, a token of several words is cut at its spaces); the sentence as written is what is right, with other spacing right but noted, and a leading 저는 may be left out when typing from English. */
export const koSentence: SentenceForms = {
  spell: spellKoreanTokens,
  optionalWords: tokens => { const subject = leadingSubject('ko', tokens); return subject ? [subject.text] : [] },
  subjectOpen: sentence => !hasSubject('ko', sentence),
  gradeSentence: input => gradeJapaneseSentence(KO_RULE, input),
  distractors: ({ tiles }) => japaneseDistractors(KO_RULE, tiles),
  blank: input => blankJapanese(KO_RULE, input),
}
