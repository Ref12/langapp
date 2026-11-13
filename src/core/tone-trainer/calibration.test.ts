import { describe, expect, it } from 'vitest'
import { calibrate, provisionalRange, rangeFromTrack } from './calibration'
import { toLevel, trackPitch } from './pitch'
import { fourTones, RATE, silence, syllable } from './synth'

describe('calibration', () => {
  it('maps the pitch of mā má mǎ mà to a range: its 5th to 95th percentile', () => {
    const range = calibrate(fourTones(110, 220), RATE)!
    expect(range[0]).toBeGreaterThan(105); expect(range[0]).toBeLessThan(135)
    expect(range[1]).toBeGreaterThan(195); expect(range[1]).toBeLessThan(230)
  })
  it('puts the learner on the five-level scale: the range ends are levels 1 and 5, a middle note about 3', () => {
    const range = calibrate(fourTones(180, 360), RATE)!
    expect(toLevel(range[0], range)).toBe(10); expect(toLevel(range[1], range)).toBe(50)
    expect(toLevel(Math.sqrt(range[0] * range[1]), range)).toBe(30)
  })
  it('gives no range for silence or for a single flat syllable (too narrow to be a range)', () => {
    expect(calibrate(silence(2), RATE)).toBeUndefined()
    expect(rangeFromTrack(trackPitch(syllable(200, 200), RATE, { fmin: 60, fmax: 500 }))).toBeUndefined()
  })
  it('a provisional range from one recording is widened to a plausible spread', () => {
    const range = provisionalRange(trackPitch(syllable(200, 200), RATE, { fmin: 60, fmax: 500, threshold: 0.3 }))!
    expect(range[1] / range[0]).toBeGreaterThanOrEqual(1.29)
    expect(range[0]).toBeLessThan(200); expect(range[1]).toBeGreaterThan(200)
  })
})
