import { db } from '../database'
import type {
  AssessmentResult, AssessmentWord, CaptureOptions, ProviderIdentity, SpeechConnection, SpeechLocale,
} from './contracts'
import { decodeWav, PCM_RATE } from './pcm'
import { alignAssessmentWords } from './alignment'

type SDK = typeof import('microsoft-cognitiveservices-speech-sdk')
const locales: SpeechLocale[] = ['en-US', 'zh-CN', 'ja-JP', 'ko-KR']
const SERVICE_ERROR = 'Azure Speech was interrupted. Check your speech settings and connection, then retry.'
const DRAIN_TIMEOUT = 5_000

export function abortError(): DOMException {
  return new DOMException('Voice operation cancelled.', 'AbortError')
}

export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

/** Also bounds SDK startup/network operations which do not accept AbortSignal. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal, milliseconds = 15_000): Promise<T> {
  checkAborted(signal)
  return new Promise((resolve, reject) => {
    const abort = () => settle(() => reject(abortError()))
    const timer = setTimeout(() => settle(() => reject(new Error(SERVICE_ERROR))), milliseconds)
    const settle = (action: () => void) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      action()
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => settle(() => resolve(value)), () => settle(() => reject(new Error(SERVICE_ERROR))))
  })
}

async function connectionSnapshot(signal: AbortSignal): Promise<SpeechConnection> {
  const stored = await abortable(db.speechConnections.get('default'), signal)
  checkAborted(signal)
  if (!stored?.warningAcknowledged || !stored.apiKey.trim() ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(stored.region) ||
    !Number.isSafeInteger(stored.configurationVersion) || stored.configurationVersion < 1) {
    throw new Error('Configure Azure Speech and acknowledge browser credential storage in Settings first.')
  }
  return { ...stored, apiKey: stored.apiKey.trim() }
}

export async function speechProviderIdentity(signal: AbortSignal): Promise<ProviderIdentity> {
  const connection = await connectionSnapshot(signal)
  return { provider: 'azure', configurationVersion: connection.configurationVersion }
}

async function loadSDK(signal: AbortSignal): Promise<SDK> {
  const sdk = await abortable(import('microsoft-cognitiveservices-speech-sdk'), signal)
  checkAborted(signal)
  sdk.Recognizer.enableTelemetry(false)
  return sdk
}

function speechConfig(sdk: SDK, connection: SpeechConnection) {
  try {
    const config = sdk.SpeechConfig.fromSubscription(connection.apiKey, connection.region)
    config.outputFormat = sdk.OutputFormat.Detailed
    return config
  } catch { throw new Error(SERVICE_ERROR) }
}

export interface AzureTranscription {
  provider: ProviderIdentity
  write(bytes: ArrayBuffer): void
  finish(): Promise<string | undefined>
  cancel(): void
}

export async function createAzureTranscription(
  options: Pick<CaptureOptions, 'targetLocale' | 'recognitionLocale' | 'signal' | 'onPartial'> & {
    onSegment: (text: string, locale: SpeechLocale) => void
    onInterrupted: (message: string) => void
  },
): Promise<AzureTranscription> {
  options = { ...options }
  const { signal } = options
  if (!locales.includes(options.targetLocale) ||
    (options.recognitionLocale && !locales.includes(options.recognitionLocale))) {
    throw new Error('This speech locale is not supported.')
  }
  const connection = await connectionSnapshot(signal)
  const sdk = await loadSDK(signal)
  const config = speechConfig(sdk, connection)
  const push = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(PCM_RATE, 16, 1))
  const audioConfig = sdk.AudioConfig.fromStreamInput(push)
  let recognizer: InstanceType<SDK['SpeechRecognizer']> | undefined
  let disposed = false
  let finishing = false
  let interruption: string | undefined
  let resolveEnd!: () => void
  const ended = new Promise<void>(resolve => { resolveEnd = resolve })
  let endObserved = false
  let finishPromise: Promise<string | undefined> | undefined
  const live = () => !disposed && !signal.aborted
  const cleanup = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', cleanup)
    resolveEnd()
    try { push.close() } catch { /* already closed */ }
    try { recognizer?.close() } catch { /* best-effort release */ }
    try { audioConfig.close() } catch { /* best-effort release */ }
    config.close()
  }
  try {
    if (options.recognitionLocale) {
      config.speechRecognitionLanguage = options.recognitionLocale
      recognizer = new sdk.SpeechRecognizer(config, audioConfig)
    } else {
      const candidates = [...new Set(['en-US', options.targetLocale])]
      const detection = sdk.AutoDetectSourceLanguageConfig.fromLanguages(candidates)
      // FromConfig merges this object over SpeechConfig; its default is AtStart.
      // The typed mode setter also selects the required v2 recognition endpoint.
      detection.mode = sdk.LanguageIdMode.Continuous
      recognizer = sdk.SpeechRecognizer.FromConfig(
        config, detection, audioConfig,
      )
    }
    recognizer.recognizing = (_, event) => {
      if (live() && !finishing) options.onPartial?.(event.result.text)
    }
    recognizer.recognized = (_, event) => {
      if (!live() || event.result.reason !== sdk.ResultReason.RecognizedSpeech || !event.result.text.trim()) return
      let detected: string | undefined
      try {
        detected = options.recognitionLocale ?? sdk.AutoDetectSourceLanguageResult.fromResult(event.result).language
      } catch { /* Treat unavailable language metadata as an explicit interruption. */ }
      if (!locales.includes(detected as SpeechLocale) ||
        (detected !== 'en-US' && detected !== options.targetLocale && detected !== options.recognitionLocale)) {
        interruption = 'The detected language is unavailable. Choose an explicit recognition language and retry.'
        if (!finishing) options.onInterrupted(interruption)
        return
      }
      options.onSegment(event.result.text, detected as SpeechLocale)
    }
    recognizer.canceled = (_, event) => {
      if (!live()) return
      if (event.reason === sdk.CancellationReason.Error) interruption = SERVICE_ERROR
      if (!finishing) {
        interruption ??= SERVICE_ERROR
        options.onInterrupted(interruption)
      }
      endObserved = true
      resolveEnd()
    }
    recognizer.sessionStopped = () => {
      if (!live()) return
      endObserved = true
      resolveEnd()
      if (!finishing) {
        interruption = 'Speech recognition ended early. Review the recording before sending.'
        options.onInterrupted(interruption)
      }
    }
    signal.addEventListener('abort', cleanup, { once: true })
    checkAborted(signal)
    await abortable(new Promise<void>((resolve, reject) => {
      recognizer!.startContinuousRecognitionAsync(resolve, reject)
    }), signal)
    checkAborted(signal)
    return {
      provider: { provider: 'azure', configurationVersion: connection.configurationVersion },
      write(bytes) {
        if (live() && !finishing) {
          try { push.write(bytes) } catch {
            interruption = SERVICE_ERROR
            options.onInterrupted(interruption)
          }
        }
      },
      finish() {
        if (finishPromise) return finishPromise
        finishing = true
        finishPromise = (async () => {
          try {
            push.close()
            await abortable(ended, signal, DRAIN_TIMEOUT)
            if (!endObserved) interruption ??= SERVICE_ERROR
          } catch {
            if (!signal.aborted) interruption ??= 'Final transcription timed out. Review and edit the saved recording transcript.'
          } finally { cleanup() }
          checkAborted(signal)
          return interruption
        })()
        return finishPromise
      },
      cancel: cleanup,
    }
  } catch {
    cleanup()
    checkAborted(signal)
    throw new Error(SERVICE_ERROR)
  }
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const score = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
const shortText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined

/** No provider defaults: absent or invalid acoustic measurements stay absent. */
export function parseAssessment(payload: unknown): AssessmentResult {
  const root = object(payload)
  if (root?.RecognitionStatus === 'NoMatch' || root?.RecognitionStatus === 'InitialSilenceTimeout') {
    return { status: 'no-speech', words: [] }
  }
  if (root?.RecognitionStatus !== 'Success') return { status: 'incomplete', words: [] }
  const best = Array.isArray(root.NBest) ? object(root.NBest[0]) : undefined
  const assessment = object(best?.PronunciationAssessment)
  const words: AssessmentWord[] = []
  if (Array.isArray(best?.Words)) {
    for (const item of best.Words.slice(0, 1000)) {
      const word = object(item)
      const text = shortText(word?.Word)
      if (!text) continue
      const detail = object(word?.PronunciationAssessment)
      const entry: AssessmentWord = { text }
      const accuracy = score(detail?.AccuracyScore)
      if (accuracy !== undefined) entry.accuracy = accuracy
      if (['None', 'Omission', 'Insertion', 'Mispronunciation', 'UnexpectedBreak', 'MissingBreak', 'Monotone'].includes(String(detail?.ErrorType))) {
        entry.errorType = String(detail?.ErrorType)
      }
      if (Array.isArray(word?.Phonemes)) {
        const phonemes = word.Phonemes.slice(0, 256).flatMap(value => {
          const phoneme = object(value)
          const text = shortText(phoneme?.Phoneme)
          if (!text) return []
          const accuracy = score(object(phoneme?.PronunciationAssessment)?.AccuracyScore)
          return [{ text, ...(accuracy === undefined ? {} : { accuracy }) }]
        })
        if (phonemes.length) entry.phonemes = phonemes
      }
      words.push(entry)
    }
  }
  const result: AssessmentResult = { status: 'incomplete', words }
  const accuracy = score(assessment?.AccuracyScore)
  const fluency = score(assessment?.FluencyScore)
  const completeness = score(assessment?.CompletenessScore)
  if (accuracy !== undefined) result.accuracy = accuracy
  if (fluency !== undefined) result.fluency = fluency
  if (completeness !== undefined) result.completeness = completeness
  if (accuracy !== undefined && fluency !== undefined && completeness !== undefined) result.status = 'assessed'
  return result
}

export async function assessPronunciation(
  audio: Blob, referenceText: string, locale: SpeechLocale, signal: AbortSignal,
): Promise<{ result: AssessmentResult; provider: ProviderIdentity }> {
  checkAborted(signal)
  if (!locales.includes(locale)) throw new Error('This pronunciation locale is not supported.')
  if (!referenceText.trim() || referenceText.length > 5000) throw new Error('Choose a reference phrase of at most 5,000 characters.')
  if (audio.size > PCM_RATE * 2 * 30 + 65_536) throw new Error('Pronunciation recordings must be at most 30 seconds.')
  const connection = await connectionSnapshot(signal)
  const provider: ProviderIdentity = { provider: 'azure', configurationVersion: connection.configurationVersion }
  const bytes = decodeWav(await abortable(audio.arrayBuffer(), signal))
  if (!bytes.byteLength) return { result: { status: 'no-speech', words: [] }, provider }
  const sdk = await loadSDK(signal)
  const config = speechConfig(sdk, connection)
  config.speechRecognitionLanguage = locale
  const push = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(PCM_RATE, 16, 1))
  const audioConfig = sdk.AudioConfig.fromStreamInput(push)
  let recognizer: InstanceType<SDK['SpeechRecognizer']> | undefined
  let assessment: InstanceType<SDK['PronunciationAssessmentConfig']> | undefined
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', cleanup)
    try { push.close() } catch { /* already closed */ }
    try { recognizer?.close() } catch { /* best-effort release */ }
    try { audioConfig.close() } catch { /* best-effort release */ }
    config.close()
  }
  try {
    recognizer = new sdk.SpeechRecognizer(config, audioConfig)
    assessment = new sdk.PronunciationAssessmentConfig(
      referenceText, sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme, false,
    )
    assessment.applyTo(recognizer)
    const results: AssessmentResult[] = []
    let error = false
    let resolveEnd!: () => void
    const ended = new Promise<void>(resolve => { resolveEnd = resolve })
    recognizer.recognized = (_, event) => {
      if (disposed || signal.aborted) return
      if (event.result.reason === sdk.ResultReason.NoMatch) return
      if (event.result.reason !== sdk.ResultReason.RecognizedSpeech) { error = true; return }
      try {
        results.push(parseAssessment(JSON.parse(
          event.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult),
        )))
      } catch { results.push({ status: 'incomplete', words: [] }) }
    }
    recognizer.canceled = (_, event) => {
      if (disposed || signal.aborted) return
      if (event.reason === sdk.CancellationReason.Error) error = true
      resolveEnd()
    }
    recognizer.sessionStopped = () => resolveEnd()
    signal.addEventListener('abort', cleanup, { once: true })
    checkAborted(signal)
    await abortable(new Promise<void>((resolve, reject) => recognizer!.startContinuousRecognitionAsync(resolve, reject)), signal)
    checkAborted(signal)
    push.write(bytes)
    push.close()
    await abortable(ended, signal, 45_000)
    checkAborted(signal)
    if (error) throw new Error(SERVICE_ERROR)
    // Phrase-level metrics cannot be honestly averaged into whole-reference scores.
    let result: AssessmentResult = results.length === 0 ? { status: 'no-speech', words: [] }
      : results.length === 1 ? results[0]
        : { status: 'incomplete', words: results.flatMap(result => result.words) }
    // Continuous assessment does not support EnableMiscue. Align all phrases
    // after EOF, rather than truncating the recording at the first silence.
    if (results.length && results.every(result => result.words.length > 0)) {
      const words = alignAssessmentWords(referenceText, result.words, locale)
      result = words ? { ...result, words } : { ...result, status: 'incomplete' }
    }
    return { result, provider }
  } catch {
    checkAborted(signal)
    throw new Error(SERVICE_ERROR)
  } finally { cleanup() }
}
