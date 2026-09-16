import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assessPronunciation, createAzureTranscription, parseAssessment } from './azure'
import { encodeWav, pcmBytes } from './pcm'

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  configs: [] as { key: string; region: string; speechRecognitionLanguage?: string; setProperty: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[],
  instances: [] as FakeRecognizer[],
  writes: [] as ArrayBuffer[],
  languages: vi.fn(), assessment: vi.fn(), telemetry: vi.fn(),
  endOnClose: true, failStart: false, payloads: [] as unknown[], serviceError: false,
}))
vi.mock('../database', () => ({ db: { speechConnections: { get: mock.get } } }))

type RecognitionEvent = { result: {
  text: string; reason: number; language: string;
  properties: { getProperty: () => string };
} }
class FakeRecognizer {
  recognizing: (sender: unknown, event: RecognitionEvent) => void = vi.fn()
  recognized: (sender: unknown, event: RecognitionEvent) => void = vi.fn()
  canceled: (sender: unknown, event: { reason: number; errorDetails?: string }) => void = vi.fn()
  sessionStopped = () => {}
  close = vi.fn()
  startContinuousRecognitionAsync = vi.fn((resolve: () => void, reject: (error: string) => void) => {
    if (mock.failStart) reject('SECRET_KEY private transcript')
    else resolve()
  })
  constructor(public config: unknown, public audio: unknown) { mock.instances.push(this) }
  static FromConfig(config: unknown, _: unknown, audio: unknown) { return new FakeRecognizer(config, audio) }
}
vi.mock('microsoft-cognitiveservices-speech-sdk', () => ({
  Recognizer: { enableTelemetry: mock.telemetry },
  SpeechRecognizer: FakeRecognizer,
  SpeechConfig: {
    fromSubscription: (key: string, region: string) => {
      const config = { key, region, setProperty: vi.fn(), close: vi.fn() }
      mock.configs.push(config)
      return config
    },
  },
  AudioStreamFormat: { getWaveFormatPCM: vi.fn(() => ({})) },
  AudioInputStream: {
    createPushStream: () => {
      let closed = false
      return {
        write: (bytes: ArrayBuffer) => { mock.writes.push(bytes.slice(0)) },
        close: () => {
          if (closed) return
          closed = true
          if (!mock.endOnClose) return
          queueMicrotask(() => {
            const recognizer = mock.instances.at(-1)!
            for (const payload of mock.payloads) recognizer.recognized(null, recognition('reference', 'ja-JP', payload))
            if (mock.serviceError) recognizer.canceled(null, { reason: 1, errorDetails: 'SECRET_KEY private transcript' })
            else recognizer.sessionStopped()
          })
        },
      }
    },
  },
  AudioConfig: { fromStreamInput: () => ({ close: vi.fn() }) },
  AutoDetectSourceLanguageConfig: { fromLanguages: mock.languages },
  LanguageIdMode: { Continuous: 1 },
  AutoDetectSourceLanguageResult: { fromResult: (result: { language: string }) => ({ language: result.language }) },
  PronunciationAssessmentConfig: class {
    applyTo = vi.fn()
    constructor(...args: unknown[]) { mock.assessment(...args) }
  },
  PronunciationAssessmentGradingSystem: { HundredMark: 'hundred' },
  PronunciationAssessmentGranularity: { Phoneme: 'phoneme' },
  OutputFormat: { Detailed: 'detailed' },
  PropertyId: { SpeechServiceConnection_LanguageIdMode: 'language-mode', SpeechServiceResponse_JsonResult: 'json' },
  ResultReason: { RecognizedSpeech: 3, NoMatch: 0 },
  CancellationReason: { Error: 1 },
}))

function recognition(text: string, language = 'ja-JP', payload: unknown = {}): RecognitionEvent {
  return { result: { text, language, reason: 3, properties: { getProperty: () => JSON.stringify(payload) } } }
}
const successful = (assessment: Record<string, unknown> = { AccuracyScore: 90, FluencyScore: 85, CompletenessScore: 95 }) => ({
  RecognitionStatus: 'Success',
  NBest: [{
    PronunciationAssessment: assessment,
    Words: [{
      Word: 'こんにちは', PronunciationAssessment: { AccuracyScore: 89, ErrorType: 'Mispronunciation' },
      Phonemes: [{ Phoneme: 'k', PronunciationAssessment: { AccuracyScore: 84 } }],
    }],
  }],
})
async function wav(samples = new Int16Array([123, -456, 789])): Promise<Blob> {
  const audio = encodeWav([pcmBytes(samples)])
  const buffer = await new Promise<ArrayBuffer>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(audio)
  })
  Object.defineProperty(audio, 'arrayBuffer', { value: async () => buffer })
  return audio
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.configs.length = mock.instances.length = mock.writes.length = 0
  mock.payloads = []
  mock.endOnClose = true
  mock.failStart = mock.serviceError = false
  mock.languages.mockImplementation(() => ({ mode: 0 }))
  mock.get.mockResolvedValue({
    id: 'default', region: 'eastus', apiKey: 'SECRET_KEY', warningAcknowledged: true,
    configurationVersion: 7, updatedAt: '2026-09-09T00:00:00Z',
  })
})
afterEach(() => { vi.useRealTimers() })

describe('validated pronunciation results', () => {
  it('returns only actual score/word/phoneme detail', () => {
    expect(parseAssessment(successful())).toEqual({
      status: 'assessed', accuracy: 90, fluency: 85, completeness: 95,
      words: [{ text: 'こんにちは', accuracy: 89, errorType: 'Mispronunciation', phonemes: [{ text: 'k', accuracy: 84 }] }],
    })
  })

  it('does not invent missing scores, accept strings/nonfinite/out-of-range metrics, or return arbitrary error text', () => {
    const parsed = parseAssessment(successful({ AccuracyScore: '99', FluencyScore: Infinity, CompletenessScore: -1 }))
    expect(parsed.status).toBe('incomplete')
    expect(parsed).not.toHaveProperty('accuracy')
    expect(parsed).not.toHaveProperty('fluency')
    expect(parsed).not.toHaveProperty('completeness')
    expect(parseAssessment(successful({ AccuracyScore: 0 })).accuracy).toBe(0)
    expect(parseAssessment({ RecognitionStatus: 'Success', NBest: [{ Words: [{ Word: 'ok', PronunciationAssessment: { ErrorType: 'SECRET_KEY' } }] }] }).words).toEqual([{ text: 'ok' }])
  })

  it('distinguishes no-speech from malformed/incomplete results', () => {
    expect(parseAssessment({ RecognitionStatus: 'NoMatch' })).toEqual({ status: 'no-speech', words: [] })
    expect(parseAssessment({ RecognitionStatus: 'InitialSilenceTimeout' }).status).toBe('no-speech')
    expect(parseAssessment({ RecognitionStatus: 'Success', NBest: [] }).status).toBe('incomplete')
    expect(parseAssessment(undefined).status).toBe('incomplete')
  })
})

describe('Azure transcription transport', () => {
  it('uses continuous English/target language identification, separates partial/final, and snapshots identity', async () => {
    const partial = vi.fn()
    const segment = vi.fn()
    const interrupted = vi.fn()
    const transport = await createAzureTranscription({
      targetLocale: 'ja-JP', signal: new AbortController().signal,
      onPartial: partial, onSegment: segment, onInterrupted: interrupted,
    })
    expect(mock.get).toHaveBeenCalledWith('default')
    expect(mock.languages).toHaveBeenCalledWith(['en-US', 'ja-JP'])
    expect(mock.languages.mock.results[0].value.mode).toBe(1)
    expect(mock.telemetry).toHaveBeenCalledWith(false)
    const recognizer = mock.instances[0]
    recognizer.recognizing(null, recognition('partial'))
    recognizer.recognized(null, recognition('final'))
    expect(partial).toHaveBeenCalledWith('partial')
    expect(segment).toHaveBeenCalledWith('final', 'ja-JP')
    expect(interrupted).not.toHaveBeenCalled()
    mock.get.mockResolvedValue({ configurationVersion: 99 })
    expect(transport.provider).toEqual({ provider: 'azure', configurationVersion: 7 })
    mock.payloads = [successful({ AccuracyScore: 90, FluencyScore: 85 })]
    transport.write(new ArrayBuffer(160))
    await transport.finish()
    expect(segment).toHaveBeenLastCalledWith('reference', 'ja-JP')
    recognizer.recognized(null, recognition('late'))
    expect(segment).toHaveBeenCalledTimes(2)
    expect(recognizer.close).toHaveBeenCalledOnce()
  })

  it('uses explicit locale without automatic language identification', async () => {
    const transport = await createAzureTranscription({
      targetLocale: 'ko-KR', recognitionLocale: 'en-US', signal: new AbortController().signal,
      onSegment: vi.fn(), onInterrupted: vi.fn(),
    })
    expect(mock.configs[0].speechRecognitionLanguage).toBe('en-US')
    expect(mock.languages).not.toHaveBeenCalled()
    transport.cancel()
  })

  it('bounds finalization, preserves interruption status, and disposes after timeout', async () => {
    vi.useFakeTimers()
    mock.endOnClose = false
    const transport = await createAzureTranscription({
      targetLocale: 'ja-JP', signal: new AbortController().signal, onSegment: vi.fn(), onInterrupted: vi.fn(),
    })
    const finished = transport.finish()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await finished).toContain('timed out')
    expect(mock.instances[0].close).toHaveBeenCalledOnce()
  })

  it('suppresses callbacks after cancellation and redacts startup/service failures', async () => {
    const controller = new AbortController()
    const segment = vi.fn()
    const interrupted = vi.fn()
    const transport = await createAzureTranscription({
      targetLocale: 'ja-JP', signal: controller.signal, onSegment: segment, onInterrupted: interrupted,
    })
    mock.instances[0].canceled(null, { reason: 1, errorDetails: 'SECRET_KEY private transcript' })
    expect(interrupted.mock.calls[0][0]).not.toMatch(/SECRET_KEY|private transcript/)
    controller.abort()
    mock.instances[0].recognized(null, recognition('late'))
    expect(segment).not.toHaveBeenCalled()
    transport.cancel()
    mock.failStart = true
    await expect(createAzureTranscription({
      targetLocale: 'ja-JP', signal: new AbortController().signal, onSegment: segment, onInterrupted: interrupted,
    })).rejects.toThrow(/^Azure Speech was interrupted/)
  })
})

describe('scripted assessment transport', () => {
  it('assesses saved PCM against the exact supplied reference and explicit locale', async () => {
    mock.payloads = [successful({ AccuracyScore: 90, FluencyScore: 85 })]
    const audio = await wav()
    const outcome = await assessPronunciation(audio, 'こんにちは', 'ja-JP', new AbortController().signal)
    expect(mock.writes).toEqual([pcmBytes(new Int16Array([123, -456, 789]))])
    expect(mock.assessment).toHaveBeenCalledWith('こんにちは', 'hundred', 'phoneme', false)
    expect(mock.configs[0].speechRecognitionLanguage).toBe('ja-JP')
    expect(mock.languages).not.toHaveBeenCalled()
    expect(outcome.result.status).toBe('incomplete')
    expect(outcome.result).not.toHaveProperty('completeness')
    expect(outcome.result.words[0].accuracy).toBe(89)
    expect(outcome.provider.configurationVersion).toBe(7)
    expect(mock.instances[0].close).toHaveBeenCalledOnce()
  })

  it('reports no speech and multi-phrase incomplete rather than fabricating an aggregate', async () => {
    const audio = await wav()
    expect((await assessPronunciation(audio, 'test', 'en-US', new AbortController().signal)).result.status).toBe('no-speech')
    mock.payloads = [successful(), successful()]
    const result = (await assessPronunciation(audio, 'こんにちはこんにちは', 'ja-JP', new AbortController().signal)).result
    expect(result.status).toBe('incomplete')
    expect(result).not.toHaveProperty('accuracy')
    expect(result.words).toHaveLength(2)
  })

  it('aligns all continuous phrases after EOF and submits the full 30 seconds of PCM', async () => {
    const phrase = (text: string) => ({
      RecognitionStatus: 'Success', NBest: [{
        PronunciationAssessment: { AccuracyScore: 90, FluencyScore: 85 },
        Words: text.split(' ').map(Word => ({
          Word, PronunciationAssessment: { AccuracyScore: 89, ErrorType: 'None' },
        })),
      }],
    })
    mock.payloads = [phrase('please'), phrase('hello today')]
    const samples = new Int16Array(16_000 * 30)
    samples[samples.length - 1] = 1234
    const { result } = await assessPronunciation(
      await wav(samples), 'Please say hello now', 'en-US', new AbortController().signal,
    )
    expect(mock.writes).toEqual([pcmBytes(samples)])
    expect(mock.instances[0].startContinuousRecognitionAsync).toHaveBeenCalledOnce()
    expect(mock.assessment).toHaveBeenCalledWith('Please say hello now', 'hundred', 'phoneme', false)
    expect(result).toEqual({
      status: 'incomplete', words: [
        { text: 'please', accuracy: 89, errorType: 'None' },
        { text: 'say', errorType: 'Omission' },
        { text: 'hello', accuracy: 89, errorType: 'None' },
        { text: 'now', errorType: 'Omission' },
        { text: 'today', accuracy: 89, errorType: 'Insertion' },
      ],
    })
  })

  it('does not infer omissions from a malformed phrase response', async () => {
    mock.payloads = [successful(), {}]
    const { result } = await assessPronunciation(await wav(), 'こんにちは世界', 'ja-JP', new AbortController().signal)
    expect(result.status).toBe('incomplete')
    expect(result.words).toHaveLength(1)
    expect(result.words[0].errorType).toBe('Mispronunciation')
  })

  it('rejects already-cancelled requests before credentials or network access', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(assessPronunciation(await wav(), 'test', 'en-US', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.get).not.toHaveBeenCalled()
    expect(mock.instances).toHaveLength(0)
  })

  it('releases recognizer on mid-assessment cancellation and suppresses late results', async () => {
    mock.endOnClose = false
    const controller = new AbortController()
    const pending = assessPronunciation(await wav(), 'test', 'en-US', controller.signal)
    // Flush the credential, lazy import, and SDK-start microtasks.
    await vi.waitFor(() => expect(mock.writes).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.instances[0].close).toHaveBeenCalledOnce()
    mock.instances[0].recognized(null, recognition('late', 'en-US', successful()))
  })

  it('redacts provider errors and rejects unsupported encoding', async () => {
    mock.serviceError = true
    await expect(assessPronunciation(await wav(), 'test', 'en-US', new AbortController().signal)).rejects.toThrow(/^Azure Speech was interrupted/)
    const invalid = new Blob(['not wave'])
    Object.defineProperty(invalid, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
    await expect(assessPronunciation(invalid, 'test', 'en-US', new AbortController().signal)).rejects.toThrow('PCM WAV')
  })
})
