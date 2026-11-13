// The learner's own pitch range: the 5th to 95th percentile of the voiced F0 of "mā, má, mǎ, mà" (or of one recording when there is no calibration yet).
// It is the range pitch.ts's toLevel puts on the five-level scale, as VOICE_RANGE does for the model voices.
import { trackPitch, type PitchTrack } from './pitch'

/** The pitch search range while tracking a learner: wide enough for any voice. */
export const LEARNER_PITCH = { fmin: 60, fmax: 500, threshold: 0.3 } as const
/** Voiced frames (10 ms each) needed for a range, and the least spread (high / low) a range may have. */
export const MIN_VOICED_FRAMES = 40
export const MIN_SPREAD = 1.3

export type PitchRange = [number, number]

const percentile = (sorted: number[], share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))]

/** Voiced frames of a track, in Hz. */
export const voicedHz = (track: PitchTrack): number[] => Array.from(track.f0).filter(hz => hz > 0)

/** The learner's range from what was tracked in their calibration, or undefined when too little was voiced to trust. */
export function rangeFromTrack(track: PitchTrack): PitchRange | undefined {
  const hz = voicedHz(track).sort((a, b) => a - b)
  if (hz.length < MIN_VOICED_FRAMES) return undefined
  const range: PitchRange = [Math.round(percentile(hz, 0.05)), Math.round(percentile(hz, 0.95))]
  return range[1] / range[0] >= MIN_SPREAD ? range : undefined
}

/** A range for someone who has not calibrated, from this recording alone: its percentiles, widened evenly (in semitones) to a plausible spread. */
export function provisionalRange(track: PitchTrack): PitchRange | undefined {
  const hz = voicedHz(track).sort((a, b) => a - b)
  if (hz.length < 8) return undefined
  const low = percentile(hz, 0.05), high = percentile(hz, 0.95)
  if (high / low >= MIN_SPREAD) return [Math.round(low), Math.round(high)]
  const middle = Math.sqrt(low * high), half = Math.sqrt(MIN_SPREAD)
  return [Math.round(middle / half), Math.round(middle * half)]
}

export function calibrate(pcm: Float32Array, sampleRate: number): PitchRange | undefined { return rangeFromTrack(trackPitch(pcm, sampleRate, LEARNER_PITCH)) }
