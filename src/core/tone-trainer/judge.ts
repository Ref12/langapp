// Judges one recording of a syllable or a two-syllable word: tracks the pitch, cuts a pair in two, puts each syllable on the learner's five-level scale,
// classifies it (classify.ts) and says what was heard, with a hint for the usual mix-ups.
import { classifyTone, type SyllablePlace } from './classify'
import { LEARNER_PITCH, provisionalRange, type PitchRange } from './calibration'
import { splitFrame, toLevel, trackPitch, CURVE_POINTS, type LevelCurve, type PitchTrack } from './pitch'

/** A recording with fewer voiced frames than this (10 ms each, about 0.15 s of voice) is "too little voice": not judged, not counted. */
export const MIN_SPOKEN_FRAMES = 15

export interface Judgement {
  /** 'quiet': too little voiced speech; nothing else is set. */
  status: 'ok' | 'quiet'
  /** The tone heard per syllable (undefined for a syllable with too little pitch). */
  heard: (number | undefined)[]
  expected: number[]
  correct: boolean
  /** The learner's curve per syllable, on the five-level scale of the range used. */
  curves: (LevelCurve | null)[]
  /** The range used and whether it was estimated from this recording. */
  range?: PitchRange
  provisional: boolean
  /** One line of advice when something was wrong, else empty. */
  hint: string
}

/** The learner's curve between two frames: the voiced frames resampled to CURVE_POINTS (as pitch.ts's clip curves). */
function curveOf(track: PitchTrack, from: number, to: number, range: PitchRange): LevelCurve | null {
  const frames: number[] = []
  for (let i = from; i < to; i++) if (track.f0[i]) frames.push(i)
  if (frames.length < 4) return null
  const start = frames[0], end = frames[frames.length - 1]
  return Array.from({ length: CURVE_POINTS }, (_, p) => {
    const at = start + (end - start) * p / (CURVE_POINTS - 1), a = Math.floor(at), b = Math.min(end, a + 1), fa = track.f0[a], fb = track.f0[b]
    if (!fa || !fb) return fa && at - a < 0.5 ? toLevel(fa, range) : fb && at - a >= 0.5 ? toLevel(fb, range) : null
    return toLevel(Math.exp(Math.log(fa) + (Math.log(fb) - Math.log(fa)) * (at - a)), range)
  })
}

/** The advice for hearing `heard` when `expected` was asked: the common mix-ups, else the tone's shape. */
export function hintFor(expected: number, heard: number | undefined): string {
  if (expected === heard) return ''
  if ((expected === 2 && heard === 3) || (expected === 3 && heard === 2)) return expected === 2 ? 'Start higher and rise all the way.' : 'Stay low; the rise is not needed.'
  if (expected === 1) return 'Keep it high and steady.'
  if (expected === 4) return 'Start high and drop fast.'
  if (expected === 2) return 'Start in the middle and rise.'
  return 'Go low, then a little up.'
}

/**
 * Judges a recording against the tones asked for. `range` is the learner's calibrated range; without it a provisional one comes from the recording itself.
 * A third tone is accepted low and falling in a word's first syllable (classifyTone already calls it 3), and low with or without the rise alone.
 */
export function judgeRecording(pcm: Float32Array, sampleRate: number, expected: number[], range?: PitchRange): Judgement {
  const track = trackPitch(pcm, sampleRate, LEARNER_PITCH)
  const voiced = Array.from(track.f0).filter(Boolean).length
  const used = range ?? (voiced >= MIN_SPOKEN_FRAMES ? provisionalRange(track) : undefined)
  const quiet: Judgement = { status: 'quiet', heard: [], expected, correct: false, curves: [], provisional: !range, hint: '' }
  if (voiced < MIN_SPOKEN_FRAMES || !used) return quiet
  const cut = expected.length === 2 ? splitFrame(track) : undefined
  if (expected.length === 2 && cut === undefined) return quiet
  const curves = expected.length === 1 ? [curveOf(track, 0, track.f0.length, used)] : [curveOf(track, 0, cut!, used), curveOf(track, cut!, track.f0.length, used)]
  const heard = curves.map((curve, index) => classifyTone(curve, expected.length === 1 ? 'single' : (index === 0 ? 'first' : 'second') as SyllablePlace)?.tone)
  if (heard.every(tone => tone === undefined)) return quiet
  const correct = expected.every((tone, index) => tone === heard[index])
  const firstWrong = expected.findIndex((tone, index) => tone !== heard[index])
  return { status: 'ok', heard, expected, correct, curves, range: used, provisional: !range, hint: correct ? '' : hintFor(expected[firstWrong], heard[firstWrong]) }
}
