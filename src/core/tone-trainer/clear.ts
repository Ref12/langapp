// A stricter test than the judging one (classify.ts): is a clip's pitch a clear example of its tone? Used by scripts/filter-tone-clips.ts to keep only such clips in the trainer,
// on the five-level scale of the clip's voice (pitch.ts), with the same contour measures the classifier uses.
import { contourFeatures } from './classify'
import type { LevelCurve } from './pitch'

/** The thresholds, in levels of the five-level scale. */
export const CLEAR = {
  /** Tone 1: high (mean at least) and level (high minus low at most). */
  t1: { meanAtLeast: 3.5, spreadAtMost: 1 },
  /** Tone 2: rises by at least riseAtLeast from the lowest point to the end, ends high (at least endAtLeast), and the lowest point is early (lowAt at most). */
  t2: { riseAtLeast: 1.5, endAtLeast: 3.3, lowAtMost: 0.5 },
  /** Tone 3: low (the minimum at most), with or without a final rise; a low fall counts, as it is how a third tone is said in a word. */
  t3: { lowAtMost: 2 },
  /** Tone 4: starts high (at least) and falls by at least. */
  t4: { startAtLeast: 3.5, fallAtLeast: 2 },
}

/**
 * Inside a two-syllable word a syllable is shorter and its pitch moves less: in the shipped voices half of the rising tones in words rise by 1 level or less, and a quarter by 1.5 or more.
 * Tones 2 and 4 in a word therefore have lower bars (tones 1 and 3 are tested the same everywhere); they still must clearly rise or fall.
 */
export const CLEAR_IN_WORD = {
  t2: { riseAtLeast: 1, endAtLeast: 2.8, lowAtMost: 0.5 },
  t4: { startAtLeast: 3.5, fallAtLeast: 1.5 },
}

/** Whether the curve is a clear example of the tone (1-4), alone or (inWord) as a syllable of a two-syllable word; a neutral tone (5) has no test and passes when there is a curve to measure. */
export function isClearExample(curve: LevelCurve | null | undefined, tone: number, inWord = false): boolean {
  const f = contourFeatures(curve)
  if (!f) return false
  const t2 = inWord ? CLEAR_IN_WORD.t2 : CLEAR.t2, t4 = inWord ? CLEAR_IN_WORD.t4 : CLEAR.t4
  switch (tone) {
    case 1: return f.mean >= CLEAR.t1.meanAtLeast && f.high - f.low <= CLEAR.t1.spreadAtMost
    case 2: return f.end - f.low >= t2.riseAtLeast && f.end >= t2.endAtLeast && f.lowAt <= t2.lowAtMost
    case 3: return f.low <= CLEAR.t3.lowAtMost
    case 4: return f.start >= t4.startAtLeast && f.start - f.end >= t4.fallAtLeast
    default: return true
  }
}

/** A clip is clear when every syllable is. */
export const isClearClip = (curves: (LevelCurve | null)[], tones: number[]): boolean => tones.every((tone, index) => isClearExample(curves[index], tone, tones.length === 2))
