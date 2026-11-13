import { describe, expect, it } from 'vitest'
import { classifyTone, contourFeatures } from './classify'
import { evaluateClips } from './clip-eval'
import type { LevelCurve } from './pitch'

/** A 20-point curve through the given levels (1-5), evenly spaced, in tenths. */
const through = (...levels: number[]): LevelCurve => Array.from({ length: 20 }, (_, i) => {
  const at = (i / 19) * (levels.length - 1), a = Math.floor(at), b = Math.min(levels.length - 1, a + 1)
  return Math.round((levels[a] + (levels[b] - levels[a]) * (at - a)) * 10)
})

describe('classifyTone on synthetic contours', () => {
  it('tone 1 is high and level', () => { expect(classifyTone(through(4.5, 4.5))?.tone).toBe(1); expect(classifyTone(through(4.2, 4.6, 4.3))?.tone).toBe(1) })
  it('tone 2 rises clearly from an early minimum', () => {
    expect(classifyTone(through(2.5, 4.5))?.tone).toBe(2)
    expect(classifyTone(through(2.2, 1.9, 4.2))?.tone).toBe(2)
  })
  it('tone 3 is low, with or without the final rise', () => {
    expect(classifyTone(through(2.2, 1, 1.1))?.tone).toBe(3)
    expect(classifyTone(through(2.4, 1, 3.8))?.tone).toBe(3)
    expect(classifyTone(through(1.8, 1.4))?.tone).toBe(3)
  })
  it('a low falling contour is a third tone, said alone or as the first syllable of a word', () => {
    expect(classifyTone(through(2.4, 1), 'first')).toMatchObject({ tone: 3, why: 'low and falling' })
    expect(classifyTone(through(2.4, 1), 'single')?.tone).toBe(3)
    expect(classifyTone(through(3.1, 1.2), 'first')?.tone).toBe(3)
  })
  it('tone 4 falls from high', () => { expect(classifyTone(through(5, 1))?.tone).toBe(4); expect(classifyTone(through(4.6, 2.5))?.tone).toBe(4) })
  it('says nothing for too little pitch', () => {
    expect(classifyTone(null)).toBeUndefined()
    expect(classifyTone(Array(20).fill(null))).toBeUndefined()
    expect(classifyTone([30, 31, null, null])).toBeUndefined()
  })
  it('measures start, end, minimum and where it is', () => {
    const f = contourFeatures(through(3, 1, 4))!
    expect(f.low).toBeCloseTo(1, 0); expect(f.lowAt).toBeGreaterThan(0.4); expect(f.lowAt).toBeLessThan(0.6); expect(f.rise).toBeGreaterThan(0.5)
  })
})

describe('classifyTone on the shipped clips (all voices)', () => {
  const table = evaluateClips()
  const accuracy = (key: string) => table[key].hit / (table[key].total - table[key].unmeasured)
  it('labels the clips with their own tone at 90% or better (clips with a measurable pitch)', () => {
    console.info('tone confusion (rows: tone said in the clip; columns: tone heard, 0 = none):\n' + table.all.said.map((row, i) => (i + 1) + ': ' + row.join('\t')).join('\n'))
    console.info(Object.entries(table).map(([key, t]) => key + ': ' + (100 * t.hit / (t.total - t.unmeasured)).toFixed(1) + '% of ' + (t.total - t.unmeasured) + ' (' + t.unmeasured + ' with no pitch)').join('\n'))
    expect(table.all.total).toBeGreaterThan(900)
    expect(accuracy('all')).toBeGreaterThanOrEqual(0.9)
  })
  it('every tone is recognised on its own, not only the common ones', () => {
    table.all.said.forEach((row, index) => expect(row[index + 1] / row.reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0.8))
  })
})
