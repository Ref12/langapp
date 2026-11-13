// Runs the classifier over the shipped clips' tracked pitch (fixtures/clip-curves.json, made by scripts/tone-clip-curves.ts) and tallies hits and confusions.
// The voice's range is its VOICE_RANGE entry, which is the way a learner's calibration takes it: the 5th to 95th percentile of the voice's pitch.
import clips from './fixtures/clip-curves.json'
import { classifyTone, type Rules, RULES, type SyllablePlace } from './classify'
import { toLevel, VOICE_RANGE } from './pitch'

interface ClipRow { id: string; voice: string; tones: number[]; hz: (number | null)[][] }
const rows = clips as ClipRow[]

/** The voices' ranges (pitch.ts's VOICE_RANGE, the 5th to 95th percentile of the kept clips: what a learner's calibration is for their own voice). */
export const voiceRanges = (): Record<string, [number, number]> => VOICE_RANGE

export interface Tally { total: number; hit: number; unmeasured: number; /** said[expected][heard], heard 0 = no tone could be told. */ said: number[][] }
const empty = (): Tally => ({ total: 0, hit: 0, unmeasured: 0, said: [1, 2, 3, 4].map(() => [0, 0, 0, 0, 0]) })

/** Per voice and kind ('single' or 'pair'), and 'all': every syllable of tones 1-4 in the shipped clips. */
export function evaluateClips(rules: Rules = RULES): Record<string, Tally> {
  const ranges = voiceRanges(), out: Record<string, Tally> = {}
  for (const row of rows) row.hz.forEach((curve, index) => {
    const tone = row.tones[index]
    if (tone > 4) return
    const kind = row.tones.length === 1 ? 'single' : 'pair'
    const place: SyllablePlace = kind === 'single' ? 'single' : index === 0 ? 'first' : 'second'
    const heard = classifyTone(curve.map(hz => (hz ? toLevel(hz, ranges[row.voice]) : null)), place, rules)?.tone ?? 0
    for (const key of [row.voice + ' ' + kind, 'all']) {
      const tally = out[key] ??= empty()
      tally.total++; tally.said[tone - 1][heard]++
      if (heard === tone) tally.hit++
      if (!heard) tally.unmeasured++
    }
  })
  return out
}
