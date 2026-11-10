// How a pack marks the typed reading ("Type the pinyin" / "Type the reading"): the pack says, the engine and the older drill screen ask. Chinese is pinyin with tones (session/grade.ts, unchanged);
// Japanese is kana or romaji (japanese-reading.ts); Korean has no grader yet and leaves the marking to the learner.
import type { RomajiOverrides } from '../reading/romaji'
import { gradePinyin, previewPinyin } from '../session/grade'
import { gradeKanaReading } from './japanese-reading'

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
}

export const pinyinInput: ReadingInput = {
  grade: (answer, accepted) => gradePinyin(answer, accepted), preview: previewPinyin, nearNote: 'Right syllables, tones:', audioIsAnswer: false, takesLearningScript: false, marks: false,
}

export const kanaInput: ReadingInput = {
  grade: (answer, accepted, romaji) => gradeKanaReading(answer, accepted, romaji), nearNote: 'Right sounds, long vowels:', audioIsAnswer: true, takesLearningScript: true, marks: true,
}

/** Korean: a typed reading is not graded yet; every answer is compared with the model and marked by the learner. */
export const selfMarkedInput: ReadingInput = {
  grade: () => ({ verdict: 'self' }), nearNote: 'Right sounds:', audioIsAnswer: false, takesLearningScript: false, marks: false,
}
