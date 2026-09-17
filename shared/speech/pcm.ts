export const PCM_RATE = 16_000
export const CAPTURE_LIMITS = { practice: 30, conversation: 120 } as const

/** Area resampling keeps fractional source frames across render quanta. */
export class MonoResampler {
  private remaining: number
  private sum = 0
  private readonly ratio: number

  constructor(sourceRate: number) {
    if (!Number.isFinite(sourceRate) || sourceRate < 8_000 || sourceRate > 192_000) {
      throw new Error('This microphone sample rate is not supported.')
    }
    this.ratio = sourceRate / PCM_RATE
    this.remaining = this.ratio
  }

  push(input: Float32Array): Int16Array {
    const output: number[] = []
    for (const raw of input) {
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
      let available = 1
      while (available > 1e-9) {
        const weight = Math.min(available, this.remaining)
        this.sum += sample * weight
        available -= weight
        this.remaining -= weight
        if (this.remaining < 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio))
          output.push(Math.round(value * (value < 0 ? 32768 : 32767)))
          this.remaining = this.ratio
          this.sum = 0
        }
      }
    }
    return Int16Array.from(output)
  }
}

export function pcmBytes(samples: Int16Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2)
  const view = new DataView(bytes)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return bytes
}

export function encodeWav(chunks: ArrayBuffer[]): Blob {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + byteLength, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, PCM_RATE, true)
  view.setUint32(28, PCM_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, byteLength, true)
  return new Blob([header, ...chunks], { type: 'audio/wav' })
}

/** Accept only the saved, bounded PCM WAV format, never reinterpret compressed bytes. */
export function decodeWav(bytes: ArrayBuffer, limitSeconds = 30): ArrayBuffer {
  const invalid = () => new Error('Use a mono 16 kHz PCM WAV recording of at most 30 seconds.')
  if (bytes.byteLength < 44 || bytes.byteLength > PCM_RATE * 2 * limitSeconds + 65_536) throw invalid()
  const view = new DataView(bytes)
  const text = (offset: number, length: number) =>
    String.fromCharCode(...new Uint8Array(bytes, offset, length))
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) throw invalid()
  let format = false
  let data: ArrayBuffer | undefined
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const length = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + length > bytes.byteLength) throw invalid()
    if (text(offset, 4) === 'fmt ') {
      if (format || length < 16 || view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 || view.getUint32(start + 4, true) !== PCM_RATE ||
        view.getUint32(start + 8, true) !== PCM_RATE * 2 ||
        view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== 16) throw invalid()
      format = true
    } else if (text(offset, 4) === 'data') {
      if (data || length % 2 || length > PCM_RATE * 2 * limitSeconds) throw invalid()
      data = bytes.slice(start, start + length)
    }
    offset = start + length + (length % 2)
  }
  if (!format || !data) throw invalid()
  return data
}
