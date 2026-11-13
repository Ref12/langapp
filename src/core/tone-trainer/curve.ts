// The pitch curves of the tone trainer's clips: types, the shapes of the four tones, and a sentence that says what a curve does.
// The values come from the in-browser tracker (pitch.ts) via play.ts.

/** One syllable's pitch: tenths of a level on the five-level tone scale (10 = 1 = low ... 50 = 5 = high), null where the voice is silent or unvoiced. */
export type Curve = (number | null)[]

/** The classic five-level shapes of the four tones, as levels 1-5 (the neutral tone has none): 55, 35, 214, 51. */
export const TONE_SHAPES: Record<number, number[]> = { 1: [5, 5], 2: [3, 5], 3: [2, 1, 4], 4: [5, 1] }

const word = (level: number): string => level >= 3.7 ? 'high' : level <= 2.3 ? 'low' : 'mid-level'

/** "Pitch falls from high to low", "Pitch stays high", ... for a curve, or a note when it has no pitch to describe. */
export function describeCurve(curve: Curve | null | undefined): string {
  const values = (curve ?? []).filter((value): value is number => value !== null).map(value => value / 10)
  if (values.length < 2) return 'No pitch was measured'
  const n = values.length
  const head = values.slice(0, Math.max(1, Math.round(n * 0.15))), tail = values.slice(-Math.max(1, Math.round(n * 0.15)))
  const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length
  const start = mean(head), end = mean(tail), low = Math.min(...values), high = Math.max(...values)
  const lowAt = values.indexOf(low) / (n - 1)
  if (high - low < 0.8) return 'Pitch stays ' + word(mean(values))
  if (lowAt > 0.2 && lowAt < 0.8 && start - low > 0.6 && end - low > 0.6) return 'Pitch dips low, then rises'
  if (end > start) return 'Pitch rises from ' + word(start) + ' to ' + word(end)
  return 'Pitch falls from ' + word(start) + ' to ' + word(end)
}
