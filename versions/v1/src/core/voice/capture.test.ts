import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureOptions } from './contracts'
import { startCapture } from './capture'
import { decodeWav } from './pcm'

const azure = vi.hoisted(() => ({
  create: vi.fn(), identity: vi.fn(),
  write: vi.fn(), finish: vi.fn(), cancel: vi.fn(),
}))
vi.mock('./azure', async importOriginal => {
  const actual = await importOriginal<typeof import('./azure')>()
  return { ...actual, createAzureTranscription: azure.create, speechProviderIdentity: azure.identity }
})

class FakeNode {
  static last: FakeNode
  connect = vi.fn()
  disconnect = vi.fn()
  onprocessorerror: (() => void) | null = null
  port = {
    onmessage: null as ((event: { data: Float32Array | string }) => void) | null,
    close: vi.fn(),
    postMessage: vi.fn(() => queueMicrotask(() => this.port.onmessage?.({ data: 'stopped' }))),
  }
  constructor() { FakeNode.last = this }
  emit(frames: Float32Array) { this.port.onmessage?.({ data: frames }) }
}

class FakeContext {
  static last: FakeContext
  sampleRate = 48000
  state = 'running'
  onstatechange: (() => void) | null = null
  destination = {}
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn(async () => { this.state = 'closed' })
  source = { connect: vi.fn(), disconnect: vi.fn() }
  createMediaStreamSource = vi.fn(() => this.source)
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }))
  constructor() { FakeContext.last = this }
}

const track = { stop: vi.fn(), readyState: 'live', onended: null as (() => void) | null, onmute: null as (() => void) | null }
const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
const getUserMedia = vi.fn()
const options = (overrides: Partial<CaptureOptions> = {}): CaptureOptions => ({
  targetLocale: 'ja-JP', mode: 'conversation', signal: new AbortController().signal, ...overrides,
})
const readBlob = (blob: Blob) => new Promise<ArrayBuffer>(resolve => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as ArrayBuffer)
  reader.readAsArrayBuffer(blob)
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  getUserMedia.mockResolvedValue(stream)
  azure.identity.mockResolvedValue({ provider: 'azure', configurationVersion: 7 })
  azure.create.mockResolvedValue({
    provider: { provider: 'azure', configurationVersion: 7 },
    write: azure.write, finish: azure.finish, cancel: azure.cancel,
  })
  azure.finish.mockResolvedValue(undefined)
  track.onended = track.onmute = null
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('capture lifecycle', () => {
  it('saves exactly the PCM sent to Azure and drains final transcript on explicit stop without onFinished', async () => {
    const finished = vi.fn()
    const transcript = vi.fn()
    const session = await startCapture(options({ onFinished: finished, onTranscript: transcript }))
    FakeNode.last.emit(new Float32Array(480).fill(0.5))
    const callbacks = azure.create.mock.calls[0][0]
    azure.finish.mockImplementation(async () => {
      callbacks.onSegment('こんにちは', 'ja-JP')
      return undefined
    })
    const stopped = session.stop()
    expect(session.stop()).toBe(stopped)
    const result = await stopped
    expect(result.durationMs).toBe(10)
    expect(result.provider.configurationVersion).toBe(7)
    expect(result.recognizedTranscript).toBe('こんにちは')
    expect(transcript).toHaveBeenCalledOnce()
    expect(finished).not.toHaveBeenCalled()
    const pcm = decodeWav(await readBlob(result.audio))
    expect(pcm).toEqual(azure.write.mock.calls[0][0])
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalled()
    expect(FakeContext.last.close).toHaveBeenCalledOnce()
  })

  it.each(['practice', 'conversation'] as const)('stops %s at the wall-clock cap for review, never submission', async mode => {
    vi.useFakeTimers()
    const finished = vi.fn()
    const elapsed = vi.fn()
    const session = await startCapture(options({ mode, onFinished: finished, onElapsed: elapsed }))
    await vi.advanceTimersByTimeAsync((mode === 'practice' ? 30 : 120) * 1000)
    expect(finished).toHaveBeenCalledOnce()
    expect(elapsed).toHaveBeenLastCalledWith(mode === 'practice' ? 30 : 120)
    if (mode === 'practice') expect(azure.create).not.toHaveBeenCalled()
    const result = await session.stop()
    expect(result).toBe(finished.mock.calls[0][0])
  })

  it('hard-clamps sample count even when a render batch would cross the cap', async () => {
    const finished = vi.fn()
    const session = await startCapture(options({ mode: 'practice', onFinished: finished }))
    FakeNode.last.emit(new Float32Array(48000 * 31))
    const result = await session.stop()
    expect(result.durationMs).toBe(30000)
    expect(result.audio.size).toBe(960044)
    expect(finished).toHaveBeenCalledOnce()
    expect(azure.write).not.toHaveBeenCalled()
  })

  it('rejects simultaneous capture and aborts stale callbacks while releasing resources', async () => {
    const onTranscript = vi.fn()
    const session = await startCapture(options({ onTranscript }))
    await expect(startCapture(options())).rejects.toThrow('current recording')
    const callbacks = azure.create.mock.calls[0][0]
    session.cancel()
    callbacks.onSegment('late', 'en-US')
    expect(onTranscript).not.toHaveBeenCalled()
    await expect(session.stop()).rejects.toMatchObject({ name: 'AbortError' })
    expect(track.stop).toHaveBeenCalled()
    const next = await startCapture(options({ mode: 'practice' }))
    next.cancel()
  })

  it('cancels pending permission promptly and stops a late granted stream', async () => {
    let grant!: (stream: unknown) => void
    getUserMedia.mockReturnValueOnce(new Promise(resolve => { grant = resolve }))
    const controller = new AbortController()
    const pending = startCapture(options({ signal: controller.signal }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    grant(stream)
    await Promise.resolve()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(azure.cancel).toHaveBeenCalled()
    const next = await startCapture(options({ mode: 'practice' }))
    next.cancel()
  })

  it('returns preserved audio on service interruption and drains before automatic review', async () => {
    const finished = vi.fn()
    const session = await startCapture(options({ onFinished: finished }))
    FakeNode.last.emit(new Float32Array(480))
    azure.create.mock.calls[0][0].onInterrupted('Speech connection interrupted.')
    const result = await session.stop()
    expect(result.audio.size).toBeGreaterThan(44)
    expect(result.interruption).toBe('Speech connection interrupted.')
    expect(azure.finish).toHaveBeenCalledOnce()
    expect(finished).toHaveBeenCalledWith(result)
  })

  it('returns review when the page backgrounds or microphone ends', async () => {
    const finished = vi.fn()
    const session = await startCapture(options({ mode: 'practice', onFinished: finished }))
    window.dispatchEvent(new Event('pagehide'))
    const result = await session.stop()
    expect(result.interruption).toContain('interrupted')
    expect(finished).toHaveBeenCalledOnce()
    const next = await startCapture(options({ mode: 'practice', onFinished: finished }))
    track.onended?.()
    await next.stop()
    expect(finished).toHaveBeenCalledTimes(2)
  })

  it('suppresses final callbacks when aborted during finalization', async () => {
    let drain!: () => void
    azure.finish.mockImplementation(() => new Promise<void>(resolve => { drain = resolve }))
    const controller = new AbortController()
    const finished = vi.fn()
    const session = await startCapture(options({ signal: controller.signal, onFinished: finished }))
    const stopping = session.stop()
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    drain()
    await expect(stopping).rejects.toMatchObject({ name: 'AbortError' })
    expect(finished).not.toHaveBeenCalled()
  })

  it('rejects insecure and worklet-incompatible browsers before microphone acquisition', async () => {
    vi.stubGlobal('isSecureContext', false)
    await expect(startCapture(options())).rejects.toThrow('HTTPS')
    expect(getUserMedia).not.toHaveBeenCalled()
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('AudioWorkletNode', undefined)
    await expect(startCapture(options())).rejects.toThrow('AudioWorklet')
    expect(getUserMedia).not.toHaveBeenCalled()
  })
})
