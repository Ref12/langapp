import { describe, expect, it } from 'vitest'
import { createEndpointer, NO_SPEECH_SECONDS } from './recorder'

const RATE = 16000, CHUNK = 1600   // 0.1 s
const loud = () => new Float32Array(CHUNK).fill(0.3), quiet = () => new Float32Array(CHUNK).fill(0.001)
/** Feeds chunks until the endpointer says stop; returns the seconds recorded (or Infinity). */
const run = (chunks: Float32Array[]): number => { const stop = createEndpointer(RATE); for (const [i, chunk] of chunks.entries()) if (stop(chunk)) return (i + 1) / 10; return Infinity }

describe('the recording endpoint', () => {
  it('stops about 2 s after speech starts', () => {
    const seconds = run([...Array(4).fill(0).map(quiet), ...Array(40).fill(0).map(loud)])
    expect(seconds).toBeGreaterThanOrEqual(2.2); expect(seconds).toBeLessThanOrEqual(2.5)
  })
  it('stops 1 s after speech ends', () => {
    const seconds = run([...Array(4).fill(0).map(quiet), ...Array(8).fill(0).map(loud), ...Array(30).fill(0).map(quiet)])
    expect(seconds).toBeGreaterThanOrEqual(2.1); expect(seconds).toBeLessThanOrEqual(2.4)
  })
  it('waits through a quiet start, and gives up when nothing is said', () => {
    expect(run(Array(100).fill(0).map(quiet))).toBeCloseTo(NO_SPEECH_SECONDS, 0)
  })
  it('does not take a noisy room for speech', () => {
    const noisy = () => new Float32Array(CHUNK).fill(0.05)
    expect(run(Array(100).fill(0).map(noisy))).toBeCloseTo(NO_SPEECH_SECONDS, 0)
  })
})
