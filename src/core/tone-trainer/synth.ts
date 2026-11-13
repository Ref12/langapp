// Synthetic voice for the tests: a sine whose pitch follows a function of time, with a pause between syllables. Tests only.
export const RATE = 16000
export function voice(seconds: number, hz: (t: number) => number, amplitude = 0.5, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate)); let phase = 0
  for (let i = 0; i < out.length; i++) { phase += 2 * Math.PI * hz(i / rate) / rate; out[i] = amplitude * Math.sin(phase) }
  return out
}
export const silence = (seconds: number, rate = RATE): Float32Array => new Float32Array(Math.round(seconds * rate))
export function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}
/** A syllable of 0.4 s whose pitch goes through the given Hz values (spread evenly), with 0.15 s of silence before it. */
export function syllable(...hz: number[]): Float32Array {
  const at = (t: number) => { const p = (t / 0.4) * (hz.length - 1), a = Math.min(hz.length - 2, Math.floor(p)); return hz.length === 1 ? hz[0] : hz[a] + (hz[a + 1] - hz[a]) * (p - a) }
  return join(silence(0.15), voice(0.4, at))
}
/** Mā, má, mǎ, mà said in a range from low to high Hz: the calibration. */
export function fourTones(low: number, high: number): Float32Array {
  const mid = Math.sqrt(low * high)
  return join(syllable(high, high), syllable(mid, high), syllable(mid, low, mid), syllable(high, low), silence(0.2))
}
