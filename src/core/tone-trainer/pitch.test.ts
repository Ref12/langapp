import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clipCurves, splitFrame, toLevel, trackPitch, voiceBounds } from './pitch'
import { readWav } from './wav-fixture'

const RATE = 16000
const tone = (seconds: number, hz: (t: number) => number): Float32Array => {
  const out = new Float32Array(Math.round(seconds * RATE)); let phase = 0
  for (let i = 0; i < out.length; i++) { phase += 2 * Math.PI * hz(i / RATE) / RATE; out[i] = 0.5 * Math.sin(phase) }
  return out
}
const voiced = (f0: Float32Array): number[] => Array.from(f0).filter(Boolean)
const clip = (name: string) => readWav(new Uint8Array(fs.readFileSync(fileURLToPath(new URL('./fixtures/' + name + '.wav', import.meta.url)))))

describe('trackPitch on synthetic sound', () => {
  it('finds 220 Hz in a steady 220 Hz sine, about every 10 ms', () => {
    const track = trackPitch(tone(1, () => 220), RATE)
    expect(track.f0.length).toBeGreaterThanOrEqual(100)
    const found = voiced(track.f0)
    expect(found.length).toBeGreaterThan(track.f0.length * 0.9)
    for (const hz of found) expect(Math.abs(hz - 220)).toBeLessThan(2)
  })
  it('follows a rising sweep upwards', () => {
    const f0 = voiced(trackPitch(tone(1, t => 120 + 120 * t), RATE).f0)
    expect(f0.length).toBeGreaterThan(80)
    expect(f0[f0.length - 1]).toBeGreaterThan(f0[0] * 1.6)
    for (let i = 1; i < f0.length; i++) expect(f0[i]).toBeGreaterThan(f0[i - 1] * 0.97)
  })
  it('hears nothing in silence or very faint noise', () => {
    expect(voiced(trackPitch(new Float32Array(RATE), RATE).f0)).toHaveLength(0)
    const noise = Float32Array.from({ length: RATE }, (_, i) => 1e-6 * Math.sin(i * i))
    expect(voiced(trackPitch(noise, RATE).f0)).toHaveLength(0)
  })
  it('works at 44.1 kHz and stays inside the asked range', () => {
    const pcm = Float32Array.from({ length: 44100 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 200 * i / 44100))
    expect(voiced(trackPitch(pcm, 44100).f0).every(hz => Math.abs(hz - 200) < 2)).toBe(true)
    expect(voiced(trackPitch(pcm, 44100, { fmin: 300, fmax: 500 }).f0).every(hz => hz >= 300)).toBe(true)
  })
})

describe('trackPitch on real clips (PCM fixtures cut from public/audio/tones, 8 kHz)', () => {
  const curve = (name: string, voice: string, syllables: 1 | 2) => { const { pcm, sampleRate } = clip(name); return clipCurves(trackPitch(pcm, sampleRate, voiceBounds(voice)), voice, syllables) }
  const levels = (c: (number | null)[] | null) => (c ?? []).filter((v): v is number => v !== null)
  it('ma1 (tone 1, Yunxi) stays high', () => {
    const l = levels(curve('s-ma1__yunxi', 'yunxi', 1)[0])
    expect(l.length).toBeGreaterThan(12)
    expect(Math.min(...l.slice(0, 12))).toBeGreaterThan(40)
  })
  it('yang2 (tone 2, Yunxi) rises from low to high', () => {
    const l = levels(curve('s-yang2__yunxi', 'yunxi', 1)[0])
    expect(l.slice(-4).reduce((a, b) => a + b) / 4).toBeGreaterThan(l.slice(0, 4).reduce((a, b) => a + b) / 4 + 10)
  })
  it('yan4 (tone 4, Yunxi) falls from high to low', () => {
    const l = levels(curve('s-yan4__yunxi', 'yunxi', 1)[0])
    expect(l[0] - l[l.length - 1]).toBeGreaterThan(15)
  })
  it('kai1-shi3 (a pair, Xiaoxiao) is cut at the unvoiced gap (Praat: 0.46 s) into two syllables', () => {
    const { pcm, sampleRate } = clip('w-kai1-shi3__xiaoxiao')
    const track = trackPitch(pcm, sampleRate, voiceBounds('xiaoxiao'))
    expect(splitFrame(track)! * track.hop).toBeGreaterThan(0.41)
    expect(splitFrame(track)! * track.hop).toBeLessThan(0.51)
    const [first, second] = clipCurves(track, 'xiaoxiao', 2)
    expect(levels(first).every(v => v > 40)).toBe(true)
    expect(second).not.toBeNull()
  })
})

describe('the five-level scale', () => {
  it('puts a voice\'s range on levels 1 to 5, and clamps beyond it', () => {
    expect(toLevel(110, [110, 248])).toBe(10)
    expect(toLevel(248, [110, 248])).toBe(50)
    expect(toLevel(50, [110, 248])).toBe(5)
    expect(toLevel(2000, [110, 248])).toBe(55)
  })
  it('gives a wide default search for an unknown voice and a narrower one for a known voice', () => {
    expect(voiceBounds('nobody')).toEqual({ fmin: 60, fmax: 500 })
    expect(voiceBounds('yunjian').fmax).toBeLessThan(200)
  })
  it('splits a track with no voice into no syllables', () => {
    expect(clipCurves(trackPitch(new Float32Array(RATE), RATE), 'yunxi', 2)).toEqual([null, null])
  })
})
