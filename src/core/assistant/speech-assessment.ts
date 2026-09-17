import workletUrl from '../../../shared/speech/pcm-worklet.js?worker&url'
import { assessmentTranscript, combineAssessments, parseAssessment } from '../../../shared/speech/assessment'
import { CAPTURE_LIMITS, MonoResampler, pcmBytes, PCM_RATE } from '../../../shared/speech/pcm'
import { MAX_DRAFT_LENGTH } from './contracts'
import {
  speechAssessmentSchema, speechConnectionSchema, type SpeechAssessment, type SpeechConnection,
} from './speech-contracts'

type SDK = typeof import('microsoft-cognitiveservices-speech-sdk')
export interface SpeechAssessmentCaptureState {
  phase: 'starting' | 'listening' | 'stopping' | 'ready' | 'assessing' | 'finished' | 'error'
  transcript: string
  assessment?: SpeechAssessment
  error?: string
  cancelled?: boolean
}
type CaptureHandle = { stop(): void; cancel(): void }
let activeCapture: CaptureHandle | undefined
const LIMIT_BYTES = PCM_RATE * 2 * CAPTURE_LIMITS.practice
const SERVICE_ERROR = 'Azure Speech assessment failed. Check your speech connection and retry.'
const CAPTURE_ERROR = 'Recording was interrupted. Check microphone permission and keep this page visible, then retry.'
const RELEASE_ERROR = 'Speech resource cleanup failed. Close this page to ensure the microphone is released, then retry.'

/** Detection only: neither permission nor the SDK is activated here. */
export function azureSpeechCaptureSupported(): boolean {
  return globalThis.isSecureContext === true && typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined'
}

function bounded<T>(promise: Promise<T>, milliseconds: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      action()
    }
    const abort = () => settle(() => reject(new DOMException('Recording cancelled.', 'AbortError')))
    const timer = setTimeout(() => settle(() => reject(new Error(message))), milliseconds)
    // Attach handlers even to an already-aborted operation, including late rejections.
    promise.then(value => settle(() => resolve(value)), () => settle(() => reject(new Error(message))))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

async function releaseAll(operations: (() => void | Promise<void>)[]): Promise<void> {
  const pending = operations.map(operation => {
    try { return Promise.resolve(operation()) } catch { return Promise.reject(new Error(RELEASE_ERROR)) }
  })
  const results = await bounded(Promise.allSettled(pending), 3_000, RELEASE_ERROR)
  if (results.some(result => result.status === 'rejected')) throw new Error(RELEASE_ERROR)
}

function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try { return operation() } catch (error) { return Promise.reject(error) }
}

/** A gesture starts local PCM capture; manual mode waits for Stop even after the cap. */
export function startAzurePracticeCapture(
  connection: SpeechConnection, referenceText: string, listener: (state: SpeechAssessmentCaptureState) => void,
  options: { automaticAssessment?: boolean } = {},
): CaptureHandle {
  activeCapture?.cancel()
  const controller = new AbortController()
  const setupController = new AbortController()
  const { signal } = controller
  let phase: SpeechAssessmentCaptureState['phase'] = 'starting'
  let ending = false
  let published = false
  let cancelled = false
  let transcript = ''
  let assessmentRequested = options.automaticAssessment !== false
  let snapshot: SpeechConnection
  let recording: Uint8Array | undefined
  let byteCount = 0
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let silence: GainNode | undefined
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let stopped: (() => void) | undefined
  let audioRelease: Promise<void> | undefined
  let providerRelease: (() => Promise<void>) | undefined
  const handle: CaptureHandle = { stop, cancel }
  activeCapture = handle
  const live = () => !ending && !cancelled && activeCapture === handle
  const notify = (state: SpeechAssessmentCaptureState) => {
    if (activeCapture !== handle) return
    try { listener(state) } catch {
      if (!ending) complete(undefined, 'The recording listener failed. Retry recording.')
      else console.error('The recording listener failed.')
    }
  }
  const removePageListeners = () => {
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('pagehide', cancel)
    window.removeEventListener('keydown', keyDown, true)
  }
  const muteCaptureListeners = () => {
    if (context) context.onstatechange = null
    stream?.getTracks().forEach(track => { track.onended = null; track.onmute = null })
  }
  const releaseAudio = (): Promise<void> => {
    if (audioRelease) return audioRelease
    clearTimeout(capTimer)
    const old = { stream, context, source, node, silence }
    stream = undefined
    context = undefined
    source = undefined
    node = undefined
    silence = undefined
    audioRelease = releaseAll([
      () => {
        if (old.context) old.context.onstatechange = null
        if (old.node) { old.node.onprocessorerror = null; old.node.port.onmessage = null }
      },
      ...[old.node, old.source, old.silence].map(value => () => value?.disconnect()),
      () => old.node?.port.close(),
      () => {
        if (!old.stream) return
        return releaseAll(old.stream.getTracks().map(track => () => {
          track.onended = null
          track.onmute = null
          track.stop()
        }))
      },
      () => old.context && old.context.state !== 'closed' ? old.context.close() : undefined,
    ])
    return audioRelease
  }
  function complete(assessment?: SpeechAssessment, error?: string) {
    if (ending) return
    ending = true
    setupController.abort()
    controller.abort()
    clearTimeout(capTimer)
    stopped?.()
    stopped = undefined
    recording = undefined
    removePageListeners()
    // Release all independently: one failed close must not leave other resources alive.
    void releaseAll([releaseAudio, () => providerRelease?.()]).then(
      () => publish(error),
      () => publish(RELEASE_ERROR),
    )
    function publish(finalError?: string) {
      published = true
      phase = finalError ? 'error' : 'finished'
      notify({
        phase, transcript, ...(cancelled ? { cancelled: true } : assessment && !finalError ? { assessment } : {}),
        ...(finalError ? { error: finalError } : {}),
      })
      if (activeCapture === handle) activeCapture = undefined
    }
  }
  function cancel() {
    if (published) return
    cancelled = true
    complete()
  }
  function visibilityChanged() { if (document.visibilityState === 'hidden') cancel() }
  function keyDown(event: KeyboardEvent) { if (event.key === 'Escape') cancel() }
  function interrupt() { if (live()) complete(undefined, CAPTURE_ERROR) }

  function stop() {
    if (!live()) return
    assessmentRequested = true
    if (phase === 'ready') { void assessRecording().catch(fail); return }
    stopRecording()
  }
  function fail(error: unknown) {
    if (live()) complete(undefined, error instanceof Error && error.message === RELEASE_ERROR
      ? RELEASE_ERROR : phase === 'assessing' ? SERVICE_ERROR : CAPTURE_ERROR)
  }
  function stopRecording() {
    if (!live() || (phase !== 'starting' && phase !== 'listening')) return
    phase = 'stopping'
    setupController.abort()
    clearTimeout(capTimer)
    notify({ phase, transcript })
    if (!live()) return
    void finish().catch(fail)
  }
  async function finish() {
    muteCaptureListeners()
    source?.disconnect()
    if (node && context?.state === 'running') {
      const port = node.port
      await bounded(new Promise<void>(resolve => {
        stopped = resolve
        port.postMessage('stop')
      }), 250, CAPTURE_ERROR, signal)
      stopped = undefined
    }
    try { await releaseAudio() } catch { if (live()) complete(undefined, RELEASE_ERROR); return }
    if (!live()) return
    if (!assessmentRequested) {
      phase = 'ready'
      notify({ phase, transcript })
      return
    }
    await assessRecording()
  }
  async function assessRecording() {
    phase = 'assessing'
    notify({ phase, transcript })
    if (!live()) return
    const bytes = recording?.buffer.slice(0, byteCount) as ArrayBuffer | undefined
    recording = undefined
    if (!bytes?.byteLength) {
      complete({ status: 'no-speech', words: [] })
      return
    }
    const assessment = await assess(bytes)
    if (live()) complete(assessment)
  }

  async function assess(bytes: ArrayBuffer): Promise<SpeechAssessment> {
    const sdk: SDK = await bounded(import('microsoft-cognitiveservices-speech-sdk'), 15_000, SERVICE_ERROR, signal)
    if (!live()) throw new Error(SERVICE_ERROR)
    sdk.Recognizer.enableTelemetry(false)
    let config: ReturnType<SDK['SpeechConfig']['fromSubscription']> | undefined
    let push: ReturnType<SDK['AudioInputStream']['createPushStream']> | undefined
    let audio: InstanceType<SDK['AudioConfig']> | undefined
    let recognizer: InstanceType<SDK['SpeechRecognizer']> | undefined
    let disposed = false
    let pushClosed = false
    let release: Promise<void> | undefined
    const closeInput = () => {
      if (pushClosed || !push) return
      pushClosed = true
      push.close()
    }
    providerRelease = () => {
      if (release) return release
      disposed = true
      release = releaseAll([
        closeInput,
        () => {
          if (!recognizer) return
          recognizer.recognized = () => {}
          recognizer.canceled = () => {}
          recognizer.sessionStopped = () => {}
          return new Promise<void>((resolve, reject) => recognizer!.close(resolve, reject))
        },
        () => audio?.close(),
        () => config?.close(),
      ])
      return release
    }
    try {
      config = sdk.SpeechConfig.fromSubscription(snapshot.apiKey, snapshot.region)
      config.outputFormat = sdk.OutputFormat.Detailed
      config.speechRecognitionLanguage = 'zh-CN'
      push = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(PCM_RATE, 16, 1))
      audio = sdk.AudioConfig.fromStreamInput(push)
      recognizer = new sdk.SpeechRecognizer(config, audio)
      new sdk.PronunciationAssessmentConfig(
        referenceText, sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdk.PronunciationAssessmentGranularity.Phoneme, false,
      ).applyTo(recognizer)
      const results: SpeechAssessment[] = []
      const texts: string[] = []
      let transcriptLength = 0
      let wordCount = 0
      let serviceFailed = false
      let inputComplete = false
      let endObserved = false
      let resolveEnd!: () => void
      const ended = new Promise<void>(resolve => { resolveEnd = resolve })
      const serviceLive = () => live() && !disposed && !endObserved
      const end = (failed: boolean) => {
        if (!serviceLive()) return
        serviceFailed ||= failed || !inputComplete
        endObserved = true
        resolveEnd()
      }
      recognizer.recognized = (_, event) => {
        if (!serviceLive()) return
        if (event.result.reason === sdk.ResultReason.NoMatch) return
        if (event.result.reason !== sdk.ResultReason.RecognizedSpeech || results.length >= 256) { end(true); return }
        let payload: unknown
        try {
          const json = event.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)
          if (json.length > 1_000_000) { end(true); return }
          payload = JSON.parse(json)
        } catch { /* Missing provider measurements remain explicitly incomplete. */ }
        if (payload && typeof payload === 'object' && 'RecognitionStatus' in payload &&
          (typeof payload.RecognitionStatus !== 'string' ||
            !['Success', 'NoMatch', 'InitialSilenceTimeout'].includes(payload.RecognitionStatus))) {
          end(true)
          return
        }
        const result = parseAssessment(payload)
        wordCount += result.words.length
        if (wordCount > 5000) { end(true); return }
        results.push(result)
        if (result.status === 'no-speech') return
        const sdkText = typeof event.result.text === 'string' ? event.result.text.trim() : ''
        const text = assessmentTranscript(payload) || sdkText ||
          result.words.filter(word => word.errorType !== 'Omission').map(word => word.text).join('')
        const segment = text.trim()
        if (segment) {
          transcriptLength += (texts.length ? 1 : 0) + segment.length
          if (transcriptLength > MAX_DRAFT_LENGTH) { end(true); return }
          texts.push(segment)
        }
      }
      recognizer.canceled = (_, event) => end(event.reason !== sdk.CancellationReason.EndOfStream)
      recognizer.sessionStopped = () => end(false)
      await bounded(new Promise<void>((resolve, reject) => {
        recognizer!.startContinuousRecognitionAsync(resolve, reject)
      }), 15_000, SERVICE_ERROR, signal)
      if (!live() || serviceFailed || endObserved) throw new Error(SERVICE_ERROR)
      push.write(bytes)
      if (!live() || serviceFailed) throw new Error(SERVICE_ERROR)
      inputComplete = true
      closeInput()
      await bounded(ended, 45_000, SERVICE_ERROR, signal)
      if (!live() || serviceFailed) throw new Error(SERVICE_ERROR)
      transcript = texts.join(' ')
      return speechAssessmentSchema.parse(combineAssessments(referenceText, results, 'zh-CN'))
    } finally { await providerRelease() }
  }

  async function setup() {
    try {
      snapshot = speechConnectionSchema.parse(connection)
      if (!referenceText.trim() || referenceText.length > 3000) {
        complete(undefined, 'Choose a reference phrase of 1-3,000 characters.')
        return
      }
      if (!azureSpeechCaptureSupported()) {
        complete(undefined, 'Azure recording requires HTTPS or localhost and an AudioWorklet-capable browser.')
        return
      }
      if (document.visibilityState === 'hidden') { cancel(); return }
      document.addEventListener('visibilitychange', visibilityChanged)
      window.addEventListener('pagehide', cancel)
      window.addEventListener('keydown', keyDown, true)
      notify({ phase, transcript })
      if (!live() || phase !== 'starting') return
      recording = new Uint8Array(LIMIT_BYTES)
      context = new AudioContext()
      if (!context.audioWorklet) throw new Error(CAPTURE_ERROR)
      const resampler = new MonoResampler(context.sampleRate)
      // Start resume/permission synchronously inside the user's activation.
      const resume = invoke(() => context!.resume())
      const permission = invoke(() => navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })).then(value => {
        if (!live() || phase !== 'starting') {
          void releaseAll([() => releaseAll(value.getTracks().map(track => () => track.stop()))])
            .catch(() => console.error(RELEASE_ERROR))
          return
        }
        stream = value
      })
      await bounded(Promise.all([
        resume, permission, invoke(() => context!.audioWorklet.addModule(workletUrl)),
      ]), 20_000, CAPTURE_ERROR, setupController.signal)
      if (!live() || phase !== 'starting') return
      if (document.hidden || context.state !== 'running' || !stream ||
        !stream.getAudioTracks().length || stream.getAudioTracks().some(track => track.readyState === 'ended')) {
        throw new Error(CAPTURE_ERROR)
      }
      source = context.createMediaStreamSource(stream)
      node = new AudioWorkletNode(context, 'linguaweave-mono-capture')
      silence = context.createGain()
      silence.gain.value = 0
      node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
        if (data === 'stopped') { stopped?.(); return }
        if (!live() || (phase !== 'listening' && phase !== 'stopping')) return
        if (!(data instanceof Float32Array) || data.length > 32_768) { interrupt(); return }
        try {
          if (!recording) return
          const samples = resampler.push(data).subarray(0, (LIMIT_BYTES - byteCount) / 2)
          const bytes = new Uint8Array(pcmBytes(samples))
          recording.set(bytes, byteCount)
          byteCount += bytes.byteLength
          if (byteCount === LIMIT_BYTES && phase === 'listening') stopRecording()
        } catch { interrupt() }
      }
      node.onprocessorerror = interrupt
      source.connect(node)
      node.connect(silence)
      silence.connect(context.destination)
      stream.getTracks().forEach(track => { track.onended = interrupt; track.onmute = interrupt })
      context.onstatechange = () => { if (context?.state !== 'running') interrupt() }
      phase = 'listening'
      capTimer = setTimeout(stopRecording, CAPTURE_LIMITS.practice * 1000)
      notify({ phase, transcript })
    } catch {
      if (live() && phase === 'starting') complete(undefined, CAPTURE_ERROR)
    }
  }
  void setup()
  return handle
}
