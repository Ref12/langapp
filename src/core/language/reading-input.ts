// How a pack marks the typed reading ("Type the pinyin" / "Type the reading"): the pack says, the engine and the older drill screen ask. Chinese is pinyin with tones (session/grade.ts, unchanged);
// Japanese is kana or romaji (japanese-reading.ts); Korean has no grader yet and leaves the marking to the learner.
import type { RomajiOverrides } from '../reading/romaji'
import { gradePinyin, previewPinyin } from '../session/grade'
import { gradeKanaReading } from './japanese-reading'
import { romanizeKorean, romanizePronunciation } from './korean-reading'

export interface ReadingGrade {
  /** correct; tones: right apart from tones (Chinese) or a long vowel written short (Japanese), counted as Needed a hint; wrong: a reading that is not the word's; self: the learner marks it. */
  verdict: 'correct' | 'tones' | 'wrong' | 'self'
  /** Chinese: the expected reading, syllable by syllable, with the ones whose tone was off. */
  syllables?: { marked: string; off: boolean }[]
  /** Japanese: the reading that was meant, in kana (shown in the learner's Readings setting). */
  kana?: string
}

export interface ReadingInput {
  grade(answer: string, accepted: readonly string[], romaji?: RomajiOverrides): ReadingGrade
  /** The live line under the input; undefined: the pack has none and no such line is shown. */
  preview?(answer: string, accepted: readonly string[]): string
  /** The lead of the note after a "tones" verdict ("Right syllables, tones:"). */
  nearNote: string
  /** The reading that is typed is what the audio says: the Hear button waits until the answer is checked. */
  audioIsAnswer: boolean
  /** The input takes the language's own writing (kana): its lang is the pack's learning tag. */
  takesLearningScript: boolean
  /** The pack marks a typed reading right or wrong, so the result shows the reading in the learner's Readings setting. */
  marks: boolean
  /** The older drill's Hint: its label and the text for a reading; undefined: the pack has none and the button is not shown. */
  hint?: { label: string; of(reading: string): string }
}

const letters = { label: 'Letters only:', of: (reading: string) => reading.normalize('NFD').replace(/\p{M}/gu, '') }
const firstKana = { label: 'Starts with:', of: (reading: string) => { const first = Array.from(reading.trim())[0]; return first ? first + '…' : '' } }

export const pinyinInput: ReadingInput = {
  grade: (answer, accepted) => gradePinyin(answer, accepted), preview: previewPinyin, nearNote: 'Right syllables, tones:', audioIsAnswer: false, takesLearningScript: false, marks: false, hint: letters,
}

export const kanaInput: ReadingInput = {
  grade: (answer, accepted, romaji) => gradeKanaReading(answer, accepted, romaji), nearNote: 'Right sounds, long vowels:', audioIsAnswer: true, takesLearningScript: true, marks: true, hint: firstKana,
}


const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u
/** A typed romanization as it is compared: letters only, in lower case, accents gone, so spaces, hyphens and apostrophes do not count. */
const romanKey = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '')
const hangulKey = (text: string): string => text.normalize('NFC').replace(/[^\u3131-\u318e\uac00-\ud7a3]/gu, '')

/**
 * Korean: a typed romanization (Revised Romanization) is marked against the word's Hangul, with the sound changes (haksaeng, gongbuhaeyo) or as spelled (hagsaeng); spaces, hyphens, capitals and apostrophes do not count.
 * The Hangul itself, typed, is right too. A word that is not in letters or Hangul is left to the learner.
 */
export const romanizationInput: ReadingInput = {
  grade: (answer, accepted) => {
    const meant = accepted[0]
    const typed = answer.normalize('NFC').trim()
    if (!typed) return { verdict: 'self', kana: meant }
    const hangul = HANGUL.test(typed)
    const latin = /^[\p{Script=Latin}\s'\u2019\u00b7.-]+$/u.test(typed) && /[a-z]/i.test(typed)
    if (!hangul && !latin) return { verdict: 'self', kana: meant }
    for (const reading of accepted) {
      if (hangul ? hangulKey(typed) === hangulKey(reading) : [romanizeKorean(reading), romanizePronunciation(reading)].some(roman => romanKey(roman) === romanKey(typed))) return { verdict: 'correct', kana: reading }
    }
    return { verdict: 'wrong', kana: meant }
  },
  nearNote: 'Right sounds:', audioIsAnswer: false, takesLearningScript: false, marks: true,
}
