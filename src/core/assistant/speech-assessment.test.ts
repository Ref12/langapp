import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import {
  azureSpeechCaptureSupported, startAzurePracticeCapture, type SpeechAssessmentCaptureState,
} from './speech-assessment'
import { pcmBytes } from '../../../shared/speech/pcm'
import type { SpeechConnection } from './speech-contracts'
import { MAX_DRAFT_LENGTH } from './contracts'

const mock = vi.hoisted(() => ({
  mic: vi.fn(), resume: vi.fn(), addModule: vi.fn(), telemetry: vi.fn(), format: vi.fn(),
  assessment: vi.fn(), apply: vi.fn(), write: vi.fn(), configClose: vi.fn(), audioClose: vi.fn(),
  contexts: [] as FakeContext[], worklets: [] as FakeWorklet[], recognizers: [] as FakeRecognizer[],
  configs: [] as { apiKey: string; region: string; speechRecognitionLanguage?: string; outputFormat?: string }[],
  sampleRate: 48_000, acknowledge: true, endOnClose: true, failStart: false, pendingStart: false,
  synchronousEnd: false, earlyEnd: false, serviceError: false,
  payloads: [] as unknown[], resultText: '', closeError: false, micCloseError: false,
}))

type RecognitionEvent = { result: { reason: number; text: string; properties: { getProperty(): string } } }
class FakeRecognizer {
  recognized: (_: unknown, event: RecognitionEvent) => void = vi.fn()
  canceled: (_: unknown, event: { reason: number }) => void = vi.fn()
  sessionStopped = () => {}
  close = vi.fn((resolve?: () => void, reject?: (error: string) => void) => {
    if (mock.closeError) reject?.('PRIVATE_KEY cleanup detail')
    else resolve?.()
  })
  startSuccess?: () => void
  startFailure?: (error: string) => void
  startContinuousRecognitionAsync = vi.fn((resolve: () => void, reject: (error: string) => void) => {
    this.startSuccess = resolve
    this.startFailure = reject
    if (mock.earlyEnd) this.sessionStopped()
    if (mock.pendingStart) return
    if (mock.failStart) reject('PRIVATE_KEY startup details')
    else resolve()
  })
  constructor() { mock.recognizers.push(this) }
}

vi.mock('microsoft-cognitiveservices-speech-sdk', () => ({
  Recognizer: { enableTelemetry: mock.telemetry },
  SpeechRecognizer: FakeRecognizer,
  SpeechConfig: { fromSubscription: (apiKey: string, region: string) => {
    const config = { apiKey, region, close: mock.configClose }
    mock.configs.push(config)
    return config
  } },
  AudioStreamFormat: { getWaveFormatPCM: mock.format },
  AudioConfig: { fromStreamInput: () => ({ close: mock.audioClose }) },
  AudioInputStream: { createPushStream: () => {
    const recognizerIndex = mock.recognizers.length
    let closed = false
    return {
      write: mock.write,
      close: () => {
        if (closed) throw new Error('Input was closed twice')
        closed = true
        if (!mock.endOnClose) return
        const end = () => {
          const recognizer = mock.recognizers[recognizerIndex]
          if (!recognizer) return
          for (const payload of mock.payloads) recognizer.recognized(null, recognition(payload))
          if (mock.serviceError) recognizer.canceled(null, { reason: 1 })
          else recognizer.sessionStopped()
        }
        if (mock.synchronousEnd) end()
        else queueMicrotask(end)
      },
    }
  } },
  PronunciationAssessmentConfig: class {
    applyTo = mock.apply
    constructor(...args: unknown[]) { mock.assessment(...args) }
  },
  PronunciationAssessmentGradingSystem: { HundredMark: 'hundred' },
  PronunciationAssessmentGranularity: { Phoneme: 'phoneme' },
  OutputFormat: { Detailed: 'detailed' },
  PropertyId: { SpeechServiceResponse_JsonResult: 'json' },
  ResultReason: { RecognizedSpeech: 3, NoMatch: 0 },
  CancellationReason: { Error: 1, EndOfStream: 0 },
}))

class FakeContext {
  state = 'suspended'
  sampleRate = mock.sampleRate
  onstatechange: (() => void) | null = null
  audioWorklet = { addModule: mock.addModule }
  destination = {}
  source = { connect: vi.fn(), disconnect: vi.fn() }
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  resume = vi.fn(() => { this.state = 'running'; return mock.resume() as Promise<void> })
  close = vi.fn(() => {
    this.state = 'closed'
    return mock.micCloseError ? Promise.reject(new Error('private device')) : Promise.resolve()
  })
  createMediaStreamSource = vi.fn(() => this.source)
  createGain = vi.fn(() => this.gain)
  constructor() { mock.contexts.push(this) }
}
class FakeWorklet {
  onprocessorerror: (() => void) | null = null
  port = {
    onmessage: null as ((event: { data: Float32Array | string }) => void) | null,
    postMessage: vi.fn((value: string) => {
      if (value === 'stop' && mock.acknowledge) this.port.onmessage?.({ data: 'stopped' })
    }),
    close: vi.fn(),
  }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() { mock.worklets.push(this) }
}

function microphone() {
  const track = { readyState: 'live', stop: vi.fn(), onended: null, onmute: null }
  return { track, getTracks: () => [track], getAudioTracks: () => [track] }
}
const connection: SpeechConnection = {
  provider: 'azure', region: 'eastus', apiKey: 'PRIVATE_KEY', storageAcknowledged: true,
  id: 'assistant-speech', revision: 'test-revision', updatedAt: 1,
}
const successful = (
  text = '你好', scores: Record<string, unknown> = { AccuracyScore: 93, FluencyScore: 81, CompletenessScore: 98 },
) => ({
  RecognitionStatus: 'Success', DisplayText: `${text}。`,
  NBest: [{
    Lexical: text, PronunciationAssessment: scores,
    Words: [{
      Word: text, PronunciationAssessment: { AccuracyScore: 89, ErrorType: 'Mispronunciation' },
      Phonemes: [{ Phoneme: 'n', PronunciationAssessment: { AccuracyScore: 72 } }],
    }],
  }],
})
function recognition(payload: unknown): RecognitionEvent {
  return { result: {
    reason: 3, text: mock.resultText,
    properties: { getProperty: () => typeof payload === 'string' ? payload : JSON.stringify(payload) },
  } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const handles: ReturnType<typeof startAzurePracticeCapture>[] = []
function start(reference = '你好', supplied = connection) {
  const states: SpeechAssessmentCaptureState[] = []
  const listener = vi.fn((state: SpeechAssessmentCaptureState) => states.push(state))
  const handle = startAzurePracticeCapture(supplied, reference, listener)
  handles.push(handle)
  return { handle, listener, states }
}
async function flush() { await vi.advanceTimersByTimeAsync(0) }
async function listening(reference = '你好', supplied = connection) {
  const capture = start(reference, supplied)
  await vi.waitFor(() => expect(capture.states.at(-1)?.phase).toBe('listening'))
  return capture
}
function samples(values = new Float32Array([0.5, 0.5, 0.5, -0.5, -0.5, -0.5])) {
  mock.worklets.at(-1)!.port.onmessage?.({ data: values })
}
async function terminal(capture: ReturnType<typeof start>) {
  await vi.waitFor(() => expect(['finished', 'error']).toContain(capture.states.at(-1)?.phase))
  return capture.states.at(-1)!
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mock.contexts.length = mock.worklets.length = mock.recognizers.length = mock.configs.length = 0
  mock.sampleRate = 48_000
  mock.acknowledge = mock.endOnClose = true
  mock.failStart = mock.pendingStart = mock.synchronousEnd = mock.earlyEnd = mock.serviceError = false
  mock.closeError = mock.micCloseError = false
  mock.resultText = ''
  mock.payloads = [successful()]
  mock.mic.mockResolvedValue(microphone())
  mock.resume.mockResolvedValue(undefined)
  mock.addModule.mockResolvedValue(undefined)
  mock.write.mockImplementation(() => {})
  mock.configClose.mockImplementation(() => {})
  mock.audioClose.mockImplementation(() => {})
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorklet)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mock.mic } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.cancel()
  await flush()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('local microphone assessment lifecycle', () => {
  it('runs the actual shared worklet, mixing microphone channels and acknowledging the final PCM queue', () => {
    interface Processor {
      port: { onmessage(event: { data: string }): void }
      process(inputs: Float32Array[][]): boolean
    }
    let ProcessorClass!: new () => Processor
    const posted: (Float32Array | string)[] = []
    runInNewContext(readFileSync(resolve('shared', 'speech', 'pcm-worklet.js'), 'utf8'), {
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
    expect(processor.process([[new Float32Array([1])]])).toBe(false)
    expect(posted).toHaveLength(2)
    expect(mock.mic).not.toHaveBeenCalled()
  })

  it('does no activation during support detection and reports unavailable prerequisites', () => {
    expect(azureSpeechCaptureSupported()).toBe(true)
    expect(mock.mic).not.toHaveBeenCalled()
    expect(mock.contexts).toHaveLength(0)
    expect(mock.telemetry).not.toHaveBeenCalled()
    vi.stubGlobal('isSecureContext', false)
    expect(azureSpeechCaptureSupported()).toBe(false)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('AudioWorkletNode', undefined)
    expect(azureSpeechCaptureSupported()).toBe(false)
  })

  it('records real PCM locally, then automatically assesses the exact reference with snapshotted credentials', async () => {
    const supplied = { ...connection }
    const capture = await listening(' 你好！ ', supplied)
    supplied.apiKey = 'CHANGED'
    supplied.region = 'westus'
    expect(mock.mic).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    })
    expect(mock.addModule).toHaveBeenCalledOnce()
    expect(mock.contexts[0].gain.gain.value).toBe(0)
    samples()
    expect(mock.recognizers).toHaveLength(0)
    expect(mock.telemetry).not.toHaveBeenCalled()
    expect(mock.write).not.toHaveBeenCalled()
    capture.handle.stop()
    capture.handle.stop()
    const result = await terminal(capture)
    expect(capture.states.map(state => state.phase)).toEqual(['starting', 'listening', 'stopping', 'assessing', 'finished'])
    expect(mock.telemetry).toHaveBeenCalledWith(false)
    expect(mock.format).toHaveBeenCalledWith(16_000, 16, 1)
    expect(mock.assessment).toHaveBeenCalledWith(' 你好！ ', 'hundred', 'phoneme', false)
    expect(mock.apply).toHaveBeenCalledWith(mock.recognizers[0])
    expect(mock.configs[0]).toMatchObject({
      apiKey: 'PRIVATE_KEY', region: 'eastus', speechRecognitionLanguage: 'zh-CN', outputFormat: 'detailed',
    })
    expect(mock.write).toHaveBeenCalledExactlyOnceWith(pcmBytes(new Int16Array([16384, -16384])))
    expect(result.transcript).toBe('你好。')
    expect(result.assessment).toEqual({
      status: 'assessed', accuracy: 93, fluency: 81, completeness: 98,
      words: [{ text: '你好', accuracy: 89, errorType: 'Mispronunciation', phonemes: [{ text: 'n', accuracy: 72 }] }],
    })
    expect(mock.contexts[0].close).toHaveBeenCalledOnce()
    expect(mock.recognizers[0].close).toHaveBeenCalledOnce()
    expect(mock.configClose).toHaveBeenCalledOnce()
    expect(mock.audioClose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('automatically assesses on the 30-second wall clock cap', async () => {
    const capture = await listening()
    samples()
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await terminal(capture)).assessment?.accuracy).toBe(93)
    expect(mock.write).toHaveBeenCalledOnce()
  })

  it.each(['submit', 'cancel'])('stops recording at the cap but waits for inline %s before any upload', async action => {
    const states: SpeechAssessmentCaptureState[] = []
    const handle = startAzurePracticeCapture(connection, '你好', state => states.push(state), { automaticAssessment: false })
    handles.push(handle)
    await flush()
    samples()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(states.at(-1)?.phase).toBe('ready')
    expect(mock.contexts[0].close).toHaveBeenCalledOnce()
    expect(mock.recognizers).toHaveLength(0)
    expect(mock.write).not.toHaveBeenCalled()
    if (action === 'submit') handle.stop()
    else handle.cancel()
    await flush()
    if (action === 'submit') {
      expect(states.at(-1)?.assessment?.accuracy).toBe(93)
      expect(mock.write).toHaveBeenCalledOnce()
    } else {
      expect(states.at(-1)?.cancelled).toBe(true)
      expect(mock.write).not.toHaveBeenCalled()
    }
  })

  it('caps the actual PCM byte count even if worklet audio outruns the wall clock', async () => {
    mock.sampleRate = 16_000
    const capture = await listening()
    for (let index = 0; index < 16; index++) samples(new Float32Array(32_768).fill(0.25))
    await terminal(capture)
    expect(mock.write).toHaveBeenCalledOnce()
    expect(mock.write.mock.calls[0][0].byteLength).toBe(16_000 * 2 * 30)
    expect(capture.states.filter(state => state.phase === 'finished')).toHaveLength(1)
  })

  it('drains queued worklet frames before uploading and tolerates synchronous SDK completion', async () => {
    mock.synchronousEnd = true
    const capture = await listening()
    samples()
    mock.worklets[0].port.postMessage.mockImplementation(() => {
      samples()
      mock.worklets[0].port.onmessage?.({ data: 'stopped' })
    })
    capture.handle.stop()
    await terminal(capture)
    expect(mock.write.mock.calls[0][0].byteLength).toBe(8)
  })

  it('returns no speech for empty PCM without loading a provider', async () => {
    const capture = await listening()
    capture.handle.stop()
    expect((await terminal(capture)).assessment).toEqual({ status: 'no-speech', words: [] })
    expect(mock.recognizers).toHaveLength(0)
  })

  it('can Stop while permission is pending, with late tracks stopped and no provider request', async () => {
    const permission = deferred<ReturnType<typeof microphone>>()
    mock.mic.mockReturnValue(permission.promise)
    const capture = start()
    capture.handle.stop()
    expect((await terminal(capture)).assessment?.status).toBe('no-speech')
    const late = microphone()
    permission.resolve(late)
    await flush()
    expect(late.track.stop).toHaveBeenCalledOnce()
    expect(mock.recognizers).toHaveLength(0)
  })
})

describe('actual Azure result semantics', () => {
  it.each([MAX_DRAFT_LENGTH, MAX_DRAFT_LENGTH + 1])('keeps the provider transcript within the %i-character persistence boundary', async length => {
    mock.payloads = [{ RecognitionStatus: 'Success', DisplayText: 'x'.repeat(length) }]
    const capture = await listening()
    samples()
    capture.handle.stop()
    const result = await terminal(capture)
    expect(result.phase).toBe(length === MAX_DRAFT_LENGTH ? 'finished' : 'error')
    if (length === MAX_DRAFT_LENGTH) expect(result.transcript).toHaveLength(length)
    else expect(result.assessment).toBeUndefined()
  })

  it('counts separators between recognized segments toward the transcript bound', async () => {
    mock.payloads = [
      { RecognitionStatus: 'Success', DisplayText: 'x'.repeat(MAX_DRAFT_LENGTH - 1) },
      { RecognitionStatus: 'Success', DisplayText: 'y' },
    ]
    const capture = await listening()
    samples()
    capture.handle.stop()
    expect((await terminal(capture)).phase).toBe('error')
  })

  it('does not average multiple utterances into fabricated reference accuracy', async () => {
    mock.payloads = [successful('你'), successful('好')]
    const capture = await listening()
    samples()
    capture.handle.stop()
    const result = await terminal(capture)
    expect(result.transcript).toBe('你。 好。')
    expect(result.assessment).toMatchObject({ status: 'incomplete', words: [{ text: '你', accuracy: 89 }, { text: '好', accuracy: 89 }] })
    expect(result.assessment).not.toHaveProperty('accuracy')
    expect(result.assessment).not.toHaveProperty('fluency')
    expect(result.assessment).not.toHaveProperty('completeness')
  })

  it('aligns omissions without assigning invented acoustic zero scores', async () => {
    mock.payloads = [successful('你')]
    const capture = await listening()
    samples()
    capture.handle.stop()
    const assessment = (await terminal(capture)).assessment!
    expect(assessment.words).toEqual([
      { text: '你', accuracy: 89, errorType: 'Mispronunciation', phonemes: [{ text: 'n', accuracy: 72 }] },
      { text: '好', errorType: 'Omission' },
    ])
    expect(assessment.accuracy).toBe(93)
  })

  it('builds fallback transcript from raw provider words, never reference-aligned omissions', async () => {
    mock.payloads = [{
      RecognitionStatus: 'Success',
      NBest: [{
        PronunciationAssessment: { AccuracyScore: 0 },
        Words: [{ Word: '你', PronunciationAssessment: { AccuracyScore: 73 } }],
      }],
    }]
    const capture = await listening('你好')
    samples()
    capture.handle.stop()
    const result = await terminal(capture)
    expect(result.transcript).toBe('你')
    expect(result.assessment).toEqual({
      status: 'incomplete', accuracy: 0,
      words: [{ text: '你', accuracy: 73 }, { text: '好', errorType: 'Omission' }],
    })
    expect(result.assessment).not.toHaveProperty('fluency')
    expect(result.assessment).not.toHaveProperty('completeness')
  })

  it.each([[], [{ RecognitionStatus: 'NoMatch' }], [{ RecognitionStatus: 'InitialSilenceTimeout' }]])(
    'returns explicit no-speech for %j', async (...payloads) => {
      mock.payloads = payloads
      const capture = await listening()
      samples()
      capture.handle.stop()
      const result = await terminal(capture)
      expect(result.assessment).toEqual({ status: 'no-speech', words: [] })
      expect(result.transcript).toBe('')
    },
  )

  it('ignores malformed/missing/nonfinite acoustic scores rather than fabricating defaults', async () => {
    mock.payloads = [successful('你好', { AccuracyScore: '99', FluencyScore: Infinity, CompletenessScore: -1 })]
    const capture = await listening()
    samples()
    capture.handle.stop()
    const result = (await terminal(capture)).assessment!
    expect(result.status).toBe('incomplete')
    expect(result).not.toHaveProperty('accuracy')
    expect(result).not.toHaveProperty('fluency')
    expect(result).not.toHaveProperty('completeness')
    expect(result.words[0].accuracy).toBe(89)
  })

  it('ignores malformed word error types without throwing from asynchronous provider callbacks', async () => {
    const payload = successful()
    const word = payload.NBest[0].Words[0]
    Object.assign(word.PronunciationAssessment, { ErrorType: { toString: null }, AccuracyScore: '100' })
    mock.payloads = [payload]
    const capture = await listening()
    samples()
    capture.handle.stop()
    expect((await terminal(capture)).assessment?.words[0]).toEqual({
      text: '你好', phonemes: [{ text: 'n', accuracy: 72 }],
    })
  })

  it.each([
    { payload: { RecognitionStatus: 'Success', NBest: [{ Lexical: '你好' }] }, expected: '你好' },
    { payload: { RecognitionStatus: 'Success', NBest: [{ Words: [{ Word: '你' }, { Word: '好' }] }] }, expected: '你好' },
    { payload: '{broken json', expected: '' },
  ])('extracts honest transcript fallback: $expected', async ({ payload, expected }) => {
    mock.payloads = [payload]
    const capture = await listening()
    samples()
    capture.handle.stop()
    const result = await terminal(capture)
    expect(result.transcript).toBe(expected)
    expect(result.assessment?.status).toBe('incomplete')
  })
})

describe('cancellation and stale resources', () => {
  it('never requests permission if the page is already hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const capture = start()
    expect((await terminal(capture)).cancelled).toBe(true)
    expect(mock.mic).not.toHaveBeenCalled()
  })

  it.each(['Escape', 'pagehide', 'visibility'])('cancels on %s without uploading or publishing a result', async event => {
    const capture = await listening()
    samples()
    const stream = await mock.mic.mock.results[0].value
    if (event === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    if (event === 'pagehide') window.dispatchEvent(new Event('pagehide'))
    if (event === 'visibility') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    const result = await terminal(capture)
    expect(result.cancelled).toBe(true)
    expect(result.assessment).toBeUndefined()
    expect(stream.track.stop).toHaveBeenCalledOnce()
    expect(mock.recognizers).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops permission tracks that arrive after cancellation', async () => {
    const permission = deferred<ReturnType<typeof microphone>>()
    mock.mic.mockReturnValue(permission.promise)
    const capture = start()
    capture.handle.cancel()
    await terminal(capture)
    const late = microphone()
    permission.resolve(late)
    await flush()
    expect(late.track.stop).toHaveBeenCalledOnce()
    expect(mock.worklets).toHaveLength(0)
    expect(mock.recognizers).toHaveLength(0)
    expect(capture.states.at(-1)?.cancelled).toBe(true)
  })

  it('surfaces late track-release failures through sanitized logging without stale UI callbacks', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {})
    const permission = deferred<ReturnType<typeof microphone>>()
    mock.mic.mockReturnValue(permission.promise)
    const capture = start()
    capture.handle.cancel()
    await terminal(capture)
    const count = capture.listener.mock.calls.length
    const late = microphone()
    late.track.stop.mockImplementation(() => { throw new Error('private device label') })
    permission.resolve(late)
    await flush()
    expect(logging).toHaveBeenCalledWith(expect.stringContaining('cleanup failed'))
    expect(logging.mock.calls.flat().join('')).not.toContain('private device label')
    expect(capture.listener).toHaveBeenCalledTimes(count)
    logging.mockRestore()
  })

  it('cancels the previous capture on replacement and suppresses old worklet callbacks', async () => {
    const first = await listening()
    samples()
    const oldMessage = mock.worklets[0].port.onmessage!
    const count = first.listener.mock.calls.length
    const second = await listening()
    oldMessage({ data: new Float32Array(128) })
    first.handle.stop()
    await flush()
    expect(first.listener).toHaveBeenCalledTimes(count)
    expect(mock.contexts[0].close).toHaveBeenCalledOnce()
    expect(mock.contexts[1].close).not.toHaveBeenCalled()
    expect(mock.recognizers).toHaveLength(0)
    second.handle.cancel()
    expect((await terminal(second)).cancelled).toBe(true)
  })

  it('cancels pending SDK startup and ignores late success/failure/result callbacks', async () => {
    mock.pendingStart = true
    const capture = await listening()
    samples()
    capture.handle.stop()
    await vi.waitFor(() => expect(mock.recognizers).toHaveLength(1))
    const sdk = mock.recognizers[0]
    const recognized = sdk.recognized
    capture.handle.cancel()
    const result = await terminal(capture)
    expect(result.cancelled).toBe(true)
    expect(result.assessment).toBeUndefined()
    expect(mock.write).not.toHaveBeenCalled()
    expect(sdk.close).toHaveBeenCalledOnce()
    const count = capture.listener.mock.calls.length
    sdk.startSuccess?.()
    sdk.startFailure?.('PRIVATE_KEY')
    recognized(null, recognition(successful()))
    await flush()
    expect(capture.listener).toHaveBeenCalledTimes(count)
    expect(mock.write).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels assessment after upload and closes the SDK, suppressing late service results', async () => {
    mock.endOnClose = false
    const capture = await listening()
    samples()
    capture.handle.stop()
    await vi.waitFor(() => expect(mock.write).toHaveBeenCalledOnce())
    const recognized = mock.recognizers[0].recognized
    const end = mock.recognizers[0].sessionStopped
    capture.handle.cancel()
    const result = await terminal(capture)
    expect(result.cancelled).toBe(true)
    recognized(null, recognition(successful()))
    end()
    await flush()
    expect(capture.states.filter(state => state.assessment)).toHaveLength(0)
    expect(mock.recognizers[0].close).toHaveBeenCalledOnce()
  })

  it('does not call Azure if the listener cancels on assessing', async () => {
    const listener = vi.fn((state: SpeechAssessmentCaptureState) => {
      if (state.phase === 'assessing') handle.cancel()
    })
    const handle = startAzurePracticeCapture(connection, '你好', listener)
    handles.push(handle)
    await flush()
    samples()
    handle.stop()
    await flush()
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'finished', cancelled: true }))
    expect(mock.recognizers).toHaveLength(0)
  })
})

describe('bounded failures, never success-shaped fallback', () => {
  it.each(['', 'a'.repeat(3001)])('rejects invalid reference length before requesting permission', async reference => {
    const capture = start(reference)
    expect((await terminal(capture)).phase).toBe('error')
    expect(mock.mic).not.toHaveBeenCalled()
  })

  it('rejects invalid connection snapshots without looking up local credentials', async () => {
    const capture = start('你好', { ...connection, apiKey: '' })
    expect((await terminal(capture)).phase).toBe('error')
    expect(mock.mic).not.toHaveBeenCalled()
  })

  it('bounds pending permission and stops a late successful permission response', async () => {
    const permission = deferred<ReturnType<typeof microphone>>()
    mock.mic.mockReturnValue(permission.promise)
    const capture = start()
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await terminal(capture)).phase).toBe('error')
    const late = microphone()
    permission.resolve(late)
    await flush()
    expect(late.track.stop).toHaveBeenCalledOnce()
    expect(mock.contexts[0].close).toHaveBeenCalledOnce()
  })

  it('bounds worklet setup and consumes late rejected native promises', async () => {
    const module = deferred<void>()
    mock.addModule.mockReturnValue(module.promise)
    const capture = start()
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await terminal(capture)).phase).toBe('error')
    module.reject(new Error('late module failure'))
    await flush()
    expect(mock.recognizers).toHaveLength(0)
  })

  it('handles synchronous native startup errors without leaking context or unhandled rejections', async () => {
    mock.resume.mockRejectedValue(new Error('resume failure'))
    mock.mic.mockImplementation(() => { throw new Error('microphone failure') })
    const capture = start()
    expect((await terminal(capture)).phase).toBe('error')
    expect(mock.contexts[0].close).toHaveBeenCalledOnce()
  })

  it('surfaces worklet drain timeout without sending a partial recording', async () => {
    mock.acknowledge = false
    const capture = await listening()
    samples()
    capture.handle.stop()
    await vi.advanceTimersByTimeAsync(250)
    expect((await terminal(capture)).phase).toBe('error')
    expect(mock.write).not.toHaveBeenCalled()
  })

  it.each(['start', 'service', 'early end', 'invalid status', 'write'])('reports redacted provider %s failures', async mode => {
    if (mode === 'start') mock.failStart = true
    if (mode === 'service') mock.serviceError = true
    if (mode === 'early end') mock.earlyEnd = true
    if (mode === 'invalid status') mock.payloads = [{ RecognitionStatus: 'Error' }]
    if (mode === 'write') mock.write.mockImplementation(() => { throw new Error('PRIVATE_KEY') })
    const capture = await listening()
    samples()
    capture.handle.stop()
    const result = await terminal(capture)
    expect(result.phase).toBe('error')
    expect(result.error).toContain('Azure Speech assessment failed')
    expect(result.error).not.toContain('PRIVATE_KEY')
    expect(result.assessment).toBeUndefined()
    expect(mock.recognizers[0].close).toHaveBeenCalledOnce()
  })

  it.each(['startup', 'final'])('bounds SDK %s and ignores late completions', async mode => {
    mock.pendingStart = mode === 'startup'
    mock.endOnClose = false
    const capture = await listening()
    samples()
    capture.handle.stop()
    await vi.waitFor(() => expect(mock.recognizers).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(mode === 'startup' ? 15_000 : 45_000)
    const result = await terminal(capture)
    expect(result.phase).toBe('error')
    expect(result.assessment).toBeUndefined()
    expect(mock.recognizers[0].close).toHaveBeenCalledOnce()
    const count = capture.listener.mock.calls.length
    mock.recognizers[0].startSuccess?.()
    mock.recognizers[0].sessionStopped()
    await flush()
    expect(capture.listener).toHaveBeenCalledTimes(count)
  })

  it.each(['worklet', 'track', 'context', 'oversized frame'])('fails capture on %s interruption, without provider fallback', async mode => {
    const capture = await listening()
    samples()
    if (mode === 'worklet') mock.worklets[0].onprocessorerror?.()
    if (mode === 'track') (await mock.mic.mock.results[0].value).track.onended()
    if (mode === 'context') {
      mock.contexts[0].state = 'suspended'
      mock.contexts[0].onstatechange?.()
    }
    if (mode === 'oversized frame') samples(new Float32Array(32_769))
    expect((await terminal(capture)).phase).toBe('error')
    expect(mock.write).not.toHaveBeenCalled()
  })

  it.each(['microphone', 'provider'])('surfaces %s release errors instead of an assessment success', async mode => {
    const capture = await listening()
    samples()
    mock.micCloseError = mode === 'microphone'
    mock.closeError = mode === 'provider'
    capture.handle.stop()
    const result = await terminal(capture)
    expect(result.phase).toBe('error')
    expect(result.error).toContain('cleanup failed')
    expect(result.assessment).toBeUndefined()
    if (mode === 'provider') {
      expect(mock.audioClose).toHaveBeenCalledOnce()
      expect(mock.configClose).toHaveBeenCalledOnce()
    } else expect(mock.write).not.toHaveBeenCalled()
  })

  it('marks cancellation even if microphone release fails', async () => {
    const capture = await listening()
    mock.micCloseError = true
    capture.handle.cancel()
    const result = await terminal(capture)
    expect(result).toMatchObject({ phase: 'error', cancelled: true })
    expect(result.error).toContain('cleanup failed')
    expect(result.assessment).toBeUndefined()
  })

  it('bounds a stalled microphone close rather than hanging finalization', async () => {
    const capture = await listening()
    samples()
    mock.contexts[0].close.mockImplementation(() => new Promise(() => {}))
    capture.handle.stop()
    await vi.advanceTimersByTimeAsync(3_000)
    expect((await terminal(capture)).error).toContain('cleanup failed')
    expect(mock.write).not.toHaveBeenCalled()
  })

  it('bounds malformed response size without reporting a fake successful assessment', async () => {
    mock.payloads = ['x'.repeat(1_000_001)]
    const capture = await listening()
    samples()
    capture.handle.stop()
    expect((await terminal(capture)).phase).toBe('error')
    expect(mock.recognizers[0].close).toHaveBeenCalledOnce()
  })

  it('does not leave live audio behind when a UI listener throws', async () => {
    const states: SpeechAssessmentCaptureState[] = []
    const handle = startAzurePracticeCapture(connection, '你好', state => {
      states.push(state)
      if (state.phase === 'listening') throw new Error('private UI data')
    })
    handles.push(handle)
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('error'))
    expect(states.at(-1)?.error).not.toContain('private UI data')
    expect(mock.contexts[0].close).toHaveBeenCalledOnce()
    expect(mock.worklets[0].port.close).toHaveBeenCalledOnce()
    expect(mock.write).not.toHaveBeenCalled()
  })
})
