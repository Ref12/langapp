// Says which of tones 1-4 a pitch contour is, with a few rules a learner can read. The curve is one syllable on the five-level scale in tenths
// (pitch.ts: the speaker's own range is levels 1-5), the same for a model clip and for the learner's recording.
import type { LevelCurve } from './pitch'

/** Where the syllable sits in what was said: said alone, or the first or second of a word. */
export type SyllablePlace = 'single' | 'first' | 'second'

export interface ContourFeatures {
  /** Mean level of the first and of the last fifth of the voiced points. */
  start: number
  end: number
  /** Lowest and highest level, and the mean of all. */
  low: number
  high: number
  mean: number
  /** Where the lowest point is, from 0 (first point) to 1 (last). */
  lowAt: number
  /** The rise from the start to the end (negative for a fall). */
  rise: number
}

const mean = (list: number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length

/** The measures the rules use, or undefined when fewer than 4 points are voiced. */
export function contourFeatures(curve: LevelCurve | null | undefined): ContourFeatures | undefined {
  const values = (curve ?? []).filter((value): value is number => value !== null).map(value => value / 10)
  if (values.length < 4) return undefined
  const fifth = Math.max(2, Math.round(values.length * 0.2))
  const start = mean(values.slice(0, fifth)), end = mean(values.slice(-fifth))
  const low = Math.min(...values), high = Math.max(...values)
  return { start, end, low, high, mean: mean(values), lowAt: values.indexOf(low) / (values.length - 1), rise: end - start }
}

/** The thresholds of the rules, in levels of the five-level scale; tuned on the shipped clips (classify.test.ts reports how they do). */
export interface Rules {
  /** A syllable that starts at or above this level starts high. */
  highStart: number
  /** From a high start: a fall of at least this is a fall (tone 4, unless the syllable is low overall: mean under lowMean); a fall of at least mildFall that reaches the top of the range (high at least topLevel) also is. */
  fall: number
  mildFall: number
  topLevel: number
  lowMean: number
  /** From a low start: a rise of at least this is a rise; it counts as tone 2 when it ends at endHigh or more without a deep dip first (start minus low under dipBy). */
  rise: number
  endHigh: number
  dipBy: number
  /** Not rising, not high: in a word, a fall of less than this from the start is still tone 2 (the second tone after a low dip is flat there). */
  flat: number
}
export const RULES: Rules = { highStart: 2.95, fall: 0.75, mildFall: 0.45, topLevel: 5.05, lowMean: 2.45, rise: 0.8, endHigh: 2.9, dipBy: 0.8, flat: 0.25 }

export interface ToneHeard { tone: 1 | 2 | 3 | 4; /** Why, in a few words. */ why: string }

/**
 * Tone 1-4 for one syllable's contour, or undefined when there is too little pitch to say.
 * Starts high: falling (but not low overall) is tone 4, else level is tone 1; a low fall also is a third tone (a word's first syllable, said quickly, often is).
 * Starts low: a clear rise that ends high without a deep dip first is tone 2; a dip then a rise, or low and level or falling, is tone 3 (with or without the final rise);
 * in a word a low start that is not falling is tone 2, as the second tone after a low dip stays flat there.
 */
export function classifyTone(curve: LevelCurve | null | undefined, place: SyllablePlace = 'single', rules: Rules = RULES): ToneHeard | undefined {
  const f = contourFeatures(curve)
  if (!f) return undefined
  if (f.start >= rules.highStart) {
    if (f.rise <= -rules.fall) return f.mean < rules.lowMean ? { tone: 3, why: 'low and falling' } : { tone: 4, why: 'falls from high' }
    if (f.rise <= -rules.mildFall && f.high >= rules.topLevel) return { tone: 4, why: 'falls from the top' }
    return { tone: 1, why: 'high and level' }
  }
  if (f.rise >= rules.rise) {
    if (f.end >= rules.endHigh) return f.start - f.low < rules.dipBy ? { tone: 2, why: 'rises from the start' } : { tone: 3, why: 'dips low, then rises' }
    return place === 'single' ? { tone: 3, why: 'low, with a little rise' } : { tone: 2, why: 'rises' }
  }
  if (place !== 'single' && f.rise > -rules.flat) return { tone: 2, why: 'rises' }
  return { tone: 3, why: f.rise < 0 ? 'low and falling' : 'low' }
}
