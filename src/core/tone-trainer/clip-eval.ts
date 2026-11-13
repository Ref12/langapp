// Runs the classifier over the shipped clips' tracked pitch (fixtures/clip-curves.json, made by scripts/tone-clip-curves.ts) and tallies hits and confusions.
// The voice's range is taken the way a learner's calibration takes it: the 5th to 95th percentile of its single-syllable clips' voiced pitch.
import clips from './fixtures/clip-curves.json'
import { classifyTone, type Rules, RULES, type SyllablePlace } from './classify'
import { toLevel } from './pitch'

interface ClipRow { id: string; voice: string; tones: number[]; hz: (number | null)[][] }
const rows = clips as ClipRow[]

export function voiceRanges(): Record<string, [number, number]> {
  const pool: Record<string, number[]> = {}
  for (const row of rows) if (row.tones.length === 1) for (const curve of row.hz) for (const hz of curve) if (hz) (pool[row.voice] ??= []).push(hz)
  return Object.fromEntries(Object.entries(pool).map(([voice, list]) => { list.sort((a, b) => a - b); return [voice, [list[Math.floor(0.05 * (list.length - 1))], list[Math.floor(0.95 * (list.length - 1))]] as [number, number]] }))
}

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
