// A small pitch tracker (YIN, de Cheveigné and Kawahara 2002) with no dependency: mono PCM in, one fundamental frequency per frame out.
// Made for short clips of one voice (the tone trainer's sounds today, the learner's own voice in the speaking practice later); it runs in a few milliseconds per second of sound.

export interface PitchTrack {
  /** Seconds between frames; frame i is centred at i * hop. */
  hop: number
  /** F0 in Hz per frame; 0 where the frame is unvoiced. */
  f0: Float32Array
  /** RMS level per frame (of the signal as given), for finding the dip between two syllables. */
  energy: Float32Array
}

export interface PitchOptions {
  /** Lowest and highest F0 to look for (Hz). Default 60 to 500, which covers men and women; pass a narrower range for one voice. */
  fmin?: number
  fmax?: number
  /** Seconds between frames (default 0.01). */
  hop?: number
  /** YIN's absolute threshold on the normalised difference (default 0.2): a frame is voiced when a dip goes below it. */
  threshold?: number
}

const WORKING_RATE = 8000
const SILENCE = 0.15   // a frame quieter than this share of the loudest frame is unvoiced, and so is anything below an absolute floor
const ABSOLUTE_FLOOR = 1e-4

/** Averages groups of samples so that the working rate is about 16 kHz: pitch needs nothing above 2 kHz, and the cost falls with the square of the rate. */
function decimate(pcm: Float32Array, sampleRate: number): { x: Float32Array; rate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / WORKING_RATE))
  if (factor === 1) return { x: pcm, rate: sampleRate }
  const x = new Float32Array(Math.floor(pcm.length / factor))
  for (let i = 0; i < x.length; i++) { let sum = 0; for (let k = 0; k < factor; k++) sum += pcm[i * factor + k]; x[i] = sum / factor }
  return { x, rate: sampleRate / factor }
}

export function trackPitch(pcm: Float32Array, sampleRate: number, options: PitchOptions = {}): PitchTrack {
  const { fmin = 60, fmax = 500, hop = 0.01, threshold = 0.2 } = options
  const { x, rate } = decimate(pcm, sampleRate)
  const frames = Math.max(0, Math.floor((x.length / rate) / hop) + 1)
  const tauMin = Math.max(2, Math.floor(rate / fmax)), tauMax = Math.ceil(rate / fmin)
  const window = tauMax   // samples compared per lag: one period of the lowest voice
  const f0 = new Float32Array(frames), energy = new Float32Array(frames)
  const d = new Float32Array(tauMax + 1), cmnd = new Float32Array(tauMax + 1)
  const at = (i: number): number => (i >= 0 && i < x.length ? x[i] : 0)
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.round(frame * hop * rate) - Math.floor((window + tauMax) / 2)
    let power = 0
    for (let j = 0; j < window; j++) power += at(start + tauMax / 2 + j) ** 2
    energy[frame] = Math.sqrt(power / window)
  }
  const loudest = energy.reduce((max, value) => Math.max(max, value), 0)
  if (loudest < ABSOLUTE_FLOOR) return { hop, f0, energy }
  for (let frame = 0; frame < frames; frame++) {
    if (energy[frame] < SILENCE * loudest) continue
    const start = Math.round(frame * hop * rate) - Math.floor((window + tauMax) / 2)
    // The difference function d(tau) = sum over the window of (x[j] - x[j + tau])^2, then its cumulative-mean normalisation.
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0
      for (let j = 0; j < window; j++) { const delta = at(start + j) - at(start + j + tau); sum += delta * delta }
      d[tau] = sum
    }
    let running = 0
    cmnd[0] = 1
    for (let tau = 1; tau <= tauMax; tau++) { running += d[tau]; cmnd[tau] = running > 0 ? d[tau] * tau / running : 1 }
    // The first lag below the threshold, followed down to its local minimum; no such lag means no voice.
    let tau = -1
    for (let lag = tauMin; lag < tauMax; lag++) {
      if (cmnd[lag] < threshold) { while (lag + 1 < tauMax && cmnd[lag + 1] < cmnd[lag]) lag++; tau = lag; break }
    }
    if (tau < 0) continue
    // Parabolic interpolation around the minimum for a lag between samples.
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[Math.min(tauMax, tau + 1)]
    const shift = a - 2 * b + c !== 0 ? (a - c) / (2 * (a - 2 * b + c)) : 0
    const hz = rate / (tau + shift)
    if (hz >= fmin && hz <= fmax) f0[frame] = hz
  }
  clean(f0)
  return { hop, f0, energy }
}

const semitones = (hz: number): number => 12 * Math.log2(hz)

/** Drops a frame that is more than 5 semitones from both voiced neighbours (an octave slip), then voiced runs of a single frame. */
function clean(f0: Float32Array): void {
  for (let i = 1; i < f0.length - 1; i++) {
    if (!f0[i] || !f0[i - 1] || !f0[i + 1]) continue
    if (Math.abs(semitones(f0[i]) - semitones(f0[i - 1])) > 5 && Math.abs(semitones(f0[i]) - semitones(f0[i + 1])) > 5) f0[i] = 0
  }
  for (let i = 0; i < f0.length; i++) if (f0[i] && !f0[i - 1] && !f0[i + 1]) f0[i] = 0
}

/** Each voice's own range in Hz (5th to 95th percentile of its voiced frames over all its clips, measured once offline with scripts/check-tone-pitch.py's Praat pitch). It puts every voice on the same five-level scale. */
export const VOICE_RANGE: Record<string, [number, number]> = { yunjian: [80, 145], xiaoxiao: [189, 333], xiaoyi: [223, 379], yunxi: [110, 248] }

/** The search range for a voice: its own range with room on both sides; the wide default for a voice not in the table. */
export function voiceBounds(voice: string): { fmin: number; fmax: number } {
  const range = VOICE_RANGE[voice]
  return range ? { fmin: range[0] * 0.7, fmax: range[1] * 1.25 } : { fmin: 60, fmax: 500 }
}

/** One syllable's pitch on the five-level scale in tenths (10 = level 1, 50 = level 5), null where unvoiced. */
export type LevelCurve = (number | null)[]

export const CURVE_POINTS = 20

/** F0 to tenths of a level: the voice's range (5th to 95th percentile) is levels 1 to 5, a little past it is allowed, clamped at 0.5 and 5.5. */
export function toLevel(hz: number, range: [number, number]): number {
  const level = 1 + 4 * (12 * Math.log2(hz / range[0])) / (12 * Math.log2(range[1] / range[0]))
  return Math.round(Math.min(5.5, Math.max(0.5, level)) * 10)
}

/**
 * The frame where a pair's first syllable ends: the middle of the longest unvoiced gap in the middle half of the voiced stretch, else its quietest frame.
 * undefined when nothing is voiced.
 */
export function splitFrame(track: PitchTrack): number | undefined {
  const voiced: number[] = []
  track.f0.forEach((hz, i) => { if (hz) voiced.push(i) })
  if (voiced.length < 2) return undefined
  const first = voiced[0], last = voiced[voiced.length - 1], span = last - first
  const lo = first + span * 0.25, hi = first + span * 0.75
  let best: [number, number] | undefined
  for (let k = 0; k + 1 < voiced.length; k++) {
    const gap = voiced[k + 1] - voiced[k] - 1, middle = (voiced[k] + voiced[k + 1]) / 2
    if (gap >= 3 && middle >= lo && middle <= hi && (!best || gap > best[0])) best = [gap, Math.round(middle)]
  }
  if (best) return best[1]
  let quiet = Math.round((first + last) / 2)
  for (let i = Math.ceil(first + span * 0.3); i <= first + span * 0.7; i++) if (track.energy[i] < track.energy[quiet]) quiet = i
  return quiet
}

/** Resamples the voiced frames of [from, to) to CURVE_POINTS points; a point between two voiced frames is interpolated, one beside a gap is null. Null when too few frames are voiced. */
function curveOf(track: PitchTrack, from: number, to: number, range: [number, number]): LevelCurve | null {
  const frames: number[] = []
  for (let i = from; i < to; i++) if (track.f0[i]) frames.push(i)
  if (frames.length < 4) return null
  const start = frames[0], end = frames[frames.length - 1]
  const out: LevelCurve = []
  for (let p = 0; p < CURVE_POINTS; p++) {
    const at = start + (end - start) * p / (CURVE_POINTS - 1), a = Math.floor(at), b = Math.min(end, a + 1)
    const fa = track.f0[a], fb = track.f0[b]
    if (!fa || !fb) { out.push(fa && at - a < 0.5 ? toLevel(fa, range) : fb && at - a >= 0.5 ? toLevel(fb, range) : null); continue }
    out.push(toLevel(Math.exp(Math.log(fa) + (Math.log(fb) - Math.log(fa)) * (at - a)), range))
  }
  return out
}

/** One curve per syllable of a clip in a known voice: a single's voiced stretch, or a pair cut at splitFrame. A syllable with too little pitch gives null. */
export function clipCurves(track: PitchTrack, voice: string, syllables: 1 | 2): (LevelCurve | null)[] {
  const range = VOICE_RANGE[voice] ?? [100, 300]
  if (syllables === 1) return [curveOf(track, 0, track.f0.length, range)]
  const cut = splitFrame(track)
  if (cut === undefined) return [null, null]
  return [curveOf(track, 0, cut, range), curveOf(track, cut, track.f0.length, range)]
}
