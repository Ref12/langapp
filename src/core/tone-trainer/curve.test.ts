import { describe, expect, it } from 'vitest'
import { describeCurve, type Curve } from './curve'

const ramp = (from: number, to: number): Curve => Array.from({ length: 20 }, (_, i) => Math.round((from + (to - from) * i / 19) * 10))

describe('describeCurve', () => {
  it('says what the line does', () => {
    expect(describeCurve(ramp(5, 1))).toBe('Pitch falls from high to low')
    expect(describeCurve(ramp(1, 5))).toBe('Pitch rises from low to high')
    expect(describeCurve(ramp(3, 5))).toBe('Pitch rises from mid-level to high')
    expect(describeCurve(ramp(5, 5))).toBe('Pitch stays high')
    expect(describeCurve([...ramp(4, 1).slice(0, 10), ...ramp(1, 4).slice(10)])).toBe('Pitch dips low, then rises')
  })
  it('ignores gaps and admits when there is nothing to describe', () => {
    expect(describeCurve([50, 50, null, null, 12, 11])).toBe('Pitch falls from high to low')
    expect(describeCurve(null)).toBe('No pitch was measured')
    expect(describeCurve([null, null])).toBe('No pitch was measured')
  })
})
