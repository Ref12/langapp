import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { CAPTURE_LIMITS, decodeWav, encodeWav, MonoResampler, pcmBytes, PCM_RATE } from './pcm'

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(blob)
  })
}

describe('shared PCM pipeline', () => {
  it.each([8000, 16000, 22050, 44100, 48000, 96000])('resamples %i Hz with no render-quantum drift', rate => {
    const input = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / rate) * 0.75)
    const whole = new MonoResampler(rate).push(input)
    const resampler = new MonoResampler(rate)
    const parts: number[] = []
    for (let i = 0; i < input.length; i += 128) parts.push(...resampler.push(input.subarray(i, i + 128)))
    expect(parts).toHaveLength(PCM_RATE * 2)
    expect(Int16Array.from(parts)).toEqual(whole)
    // The fixture remains a 440 Hz wave after resampling, not a pitch-shifted recording.
    const crossings = parts.reduce((count, value, index) => count + Number(index > 0 && parts[index - 1] < 0 && value >= 0), 0)
    expect(crossings).toBeGreaterThanOrEqual(879)
    expect(crossings).toBeLessThanOrEqual(880)
  })

  it('clamps PCM, rejects invalid rates, and averages downsampled source frames', () => {
    expect([...new MonoResampler(16000).push(new Float32Array([-2, 2, NaN, 0]))]).toEqual([-32768, 32767, 0, 0])
    expect([...new MonoResampler(48000).push(new Float32Array([1, 0, -1]))]).toEqual([0])
    expect(() => new MonoResampler(NaN)).toThrow()
    expect(() => new MonoResampler(1000)).toThrow()
  })

  it('encodes exact little-endian SDK bytes as mono 16k WAV and decodes them', async () => {
    const bytes = pcmBytes(new Int16Array([-32768, -1, 0, 32767]))
    expect([...new Uint8Array(bytes)]).toEqual([0, 128, 255, 255, 0, 0, 255, 127])
    const wav = encodeWav([bytes])
    expect(wav.type).toBe('audio/wav')
    const buffer = await readBlob(wav)
    const view = new DataView(buffer)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(decodeWav(buffer)).toEqual(bytes)
  })

  it('enforces 30 second assessment and 120 second conversation limits', async () => {
    expect(CAPTURE_LIMITS).toEqual({ practice: 30, conversation: 120 })
    const maximum = await readBlob(encodeWav([new ArrayBuffer(30 * PCM_RATE * 2)]))
    expect(decodeWav(maximum).byteLength).toBe(960000)
    const tooLong = await readBlob(encodeWav([new ArrayBuffer(30 * PCM_RATE * 2 + 2)]))
    expect(() => decodeWav(tooLong)).toThrow()
    const wrongRate = maximum.slice(0)
    new DataView(wrongRate).setUint32(24, 48000, true)
    expect(() => decodeWav(wrongRate)).toThrow()
    expect(() => decodeWav(maximum.slice(0, -1))).toThrow()
  })

  it('runs the actual worklet: averages channels, transfers PCM, and acknowledges stop after prior chunks', () => {
    const posted: (Float32Array | string)[] = []
    interface Processor {
      port: { onmessage: (event: { data: string }) => void }
      process(inputs: Float32Array[][]): boolean
    }
    let ProcessorClass!: new () => Processor
    runInNewContext(readFileSync(resolve('src', 'core', 'voice', 'pcm-worklet.js'), 'utf8'), {
      Float32Array,
      AudioWorkletProcessor: class {
        port = { postMessage: (data: Float32Array | string) => posted.push(data), onmessage: undefined }
      },
      registerProcessor: (name: string, processor: new () => Processor) => {
        expect(name).toBe('linguaweave-mono-capture')
        ProcessorClass = processor
      },
    })
    const processor = new ProcessorClass()
    expect(processor.process([[new Float32Array([1, 0.5]), new Float32Array([-1, 0.5])]])).toBe(true)
    expect(posted[0]).toEqual(new Float32Array([0, 0.5]))
    processor.port.onmessage({ data: 'stop' })
    expect(posted[1]).toBe('stopped')
    expect(processor.process([[new Float32Array([1, 1])]])).toBe(false)
    expect(posted).toHaveLength(2)
  })
})
