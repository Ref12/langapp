// Reads a small 16-bit PCM WAV (the tests' real-clip fixtures) into the mono samples the pitch tracker takes. Tests only; the app decodes with Web Audio.
export function readWav(bytes: Uint8Array): { pcm: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let at = 12, sampleRate = 0, channels = 1
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true)
    if (tag(at) === 'fmt ') {
      if (view.getUint16(at + 8 + 14, true) !== 16) throw new Error('Only 16-bit WAV is read')
      channels = view.getUint16(at + 10, true); sampleRate = view.getUint32(at + 12, true)
    } else if (tag(at) === 'data') {
      const count = Math.floor(size / (2 * channels)), pcm = new Float32Array(count)
      for (let i = 0; i < count; i++) pcm[i] = view.getInt16(at + 8 + i * 2 * channels, true) / 32768
      return { pcm, sampleRate }
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('No sound data in the WAV file')
}
