import workletUrl from './pcm-worklet.js?worker&url'
import {
  abortable, abortError, checkAborted, createAzureTranscription, speechProviderIdentity,
  type AzureTranscription,
} from './azure'
import type { CaptureOptions, CaptureResult, CaptureSession, ProviderIdentity, SpeechSegment } from './contracts'
import { CAPTURE_LIMITS, encodeWav, MonoResampler, pcmBytes, PCM_RATE } from './pcm'

let activeCapture: object | undefined
const INTERRUPTED = 'Microphone capture was interrupted. Review your recording before continuing.'

/** Explicit stop resolves for review; only a cap or interruption calls onFinished. */
export async function startCapture(options: CaptureOptions): Promise<CaptureSession> {
  options = { ...options }
  checkAborted(options.signal)
  if (activeCapture) throw new Error('Finish or cancel the current recording before starting another.')
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone recording requires HTTPS or localhost and microphone support.')
  }
  if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
    throw new Error('This browser does not support AudioWorklet recording. Use a current browser or text chat.')
  }
  if (document.visibilityState === 'hidden') throw new Error('Keep this page visible while recording.')

  const token = {}
  activeCapture = token
  const controller = new AbortController()
  const { signal } = controller
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let silence: GainNode | undefined
  let transcription: AzureTranscription | undefined
  let provider: ProviderIdentity
  let state: 'starting' | 'recording' | 'stopping' | 'done' | 'cancelled' = 'starting'
  let interruption: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let finishPromise: Promise<CaptureResult> | undefined
  let workletStopped: (() => void) | undefined
  const segments: SpeechSegment[] = []
  const chunks: ArrayBuffer[] = []
  let sampleCount = 0
  const limitSeconds = CAPTURE_LIMITS[options.mode]
  const limitSamples = PCM_RATE * limitSeconds
  const live = () => !signal.aborted && state !== 'done' && state !== 'cancelled'
  const releaseLock = () => { if (activeCapture === token) activeCapture = undefined }
  const notify = (callback: (() => void) | undefined) => {
    if (live()) {
      try { callback?.() } catch { /* UI callbacks must not leak microphone resources. */ }
    }
  }
  const removeListeners = () => {
    clearInterval(timer)
    clearTimeout(capTimer)
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('pagehide', pageHidden)
    if (context) context.onstatechange = null
    stream?.getTracks().forEach(track => { track.onended = null; track.onmute = null })
  }
  const releaseAudio = () => {
    removeListeners()
    if (node) { node.port.onmessage = null; node.port.close(); node.disconnect() }
    source?.disconnect()
    silence?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }
  const cancel = () => {
    if (state === 'done' || state === 'cancelled') return
    state = 'cancelled'
    controller.abort()
    transcription?.cancel()
    workletStopped?.()
    releaseAudio()
    releaseLock()
    options.signal.removeEventListener('abort', cancel)
  }
  options.signal.addEventListener('abort', cancel, { once: true })

  const finish = (automatic: boolean, message?: string): Promise<CaptureResult> => {
    if (state === 'cancelled' || signal.aborted) return Promise.reject(abortError())
    if (finishPromise) return finishPromise
    interruption ??= message
    state = 'stopping'
    removeListeners()
    finishPromise = (async () => {
      try {
        // The port acknowledgement is ordered after all previously posted PCM quanta.
        // Disconnect the source first, then drain that queue before closing SDK input.
        source?.disconnect()
        if (node && context?.state === 'running') {
          await new Promise<void>(resolve => {
            const timeout = setTimeout(() => { workletStopped = undefined; resolve() }, 250)
            workletStopped = () => { clearTimeout(timeout); workletStopped = undefined; resolve() }
            node!.port.postMessage('stop')
          })
        }
        releaseAudio()
        checkAborted(signal)
        try {
          const finalInterruption = await transcription?.finish()
          interruption ??= finalInterruption
        } catch {
          checkAborted(signal)
          interruption ??= 'Final transcription was interrupted. Review and edit your transcript.'
        }
        checkAborted(signal)
        const result: CaptureResult = {
          audio: encodeWav(chunks), durationMs: sampleCount / PCM_RATE * 1000,
          recognizedTranscript: segments.map(segment => segment.text).join(' '),
          segments: segments.map(segment => ({ ...segment })), provider, ...(interruption ? { interruption } : {}),
        }
        if (automatic) notify(() => options.onFinished?.(result))
        state = 'done'
        return result
      } finally {
        releaseAudio()
        transcription?.cancel()
        releaseLock()
        options.signal.removeEventListener('abort', cancel)
      }
    })()
    return finishPromise
  }
  const interrupt = (message = INTERRUPTED) => {
    interruption ??= message
    if (state === 'recording') void finish(true, message).catch(() => undefined)
  }
  function visibilityChanged() {
    if (document.visibilityState === 'hidden') interrupt()
  }
  function pageHidden() { interrupt() }

  try {
    context = new AudioContext()
    if (!context.audioWorklet) throw new Error('This browser does not support AudioWorklet recording. Use a current browser or text chat.')
    const resampler = new MonoResampler(context.sampleRate)
    // Resume while still in the user's gesture, rather than after SDK/permission awaits.
    const resume = context.resume()
    const permission = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then(value => {
      if (signal.aborted) {
        value.getTracks().forEach(track => track.stop())
        throw abortError()
      }
      stream = value
      return value
    })
    // Snapshot settings at operation start, not after a possibly long permission prompt.
    const prepareProvider = options.mode === 'practice'
      ? speechProviderIdentity(signal).then(identity => { provider = identity })
      : createAzureTranscription({
        targetLocale: options.targetLocale, recognitionLocale: options.recognitionLocale, signal,
        onPartial: text => notify(() => options.onPartial?.(text)),
        onSegment: (text, locale) => {
          if (!live()) return
          segments.push({ text, locale })
          notify(() => options.onTranscript?.(segments.map(segment => ({ ...segment }))))
        },
        onInterrupted: message => interrupt(message),
      }).then(adapter => {
        transcription = adapter
        if (signal.aborted) { adapter.cancel(); throw abortError() }
        provider = adapter.provider
      })
    await Promise.all([
      abortable(resume, signal),
      abortable(context.audioWorklet.addModule(workletUrl), signal),
      abortable(permission, signal, 120_000),
      prepareProvider,
    ])
    checkAborted(signal)
    if (document.hidden || context.state !== 'running' ||
      stream!.getAudioTracks().every(track => track.readyState === 'ended')) throw new Error(INTERRUPTED)
    source = context.createMediaStreamSource(stream!)
    node = new AudioWorkletNode(context, 'linguaweave-mono-capture')
    silence = context.createGain()
    silence.gain.value = 0
    node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
      if (data === 'stopped') { workletStopped?.(); return }
      if (!live() || (state !== 'recording' && state !== 'stopping') || !(data instanceof Float32Array)) return
      const pcm = resampler.push(data).subarray(0, Math.max(0, limitSamples - sampleCount))
      if (pcm.length) {
        const bytes = pcmBytes(pcm)
        chunks.push(bytes)
        sampleCount += pcm.length
        transcription?.write(bytes)
      }
      if (sampleCount >= limitSamples && state === 'recording') void finish(true).catch(() => undefined)
    }
    node.onprocessorerror = () => interrupt()
    source.connect(node)
    node.connect(silence)
    silence.connect(context.destination)
    state = 'recording'
    stream!.getTracks().forEach(track => {
      track.onended = () => interrupt()
      track.onmute = () => interrupt()
    })
    context.onstatechange = () => {
      if (context?.state !== 'running') interrupt()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', pageHidden)
    const started = performance.now()
    notify(() => options.onElapsed?.(0))
    timer = setInterval(() => {
      notify(() => options.onElapsed?.(Math.min(limitSeconds, (performance.now() - started) / 1000)))
    }, 250)
    capTimer = setTimeout(() => {
      notify(() => options.onElapsed?.(limitSeconds))
      void finish(true).catch(() => undefined)
    }, limitSeconds * 1000)
    if (interruption) interrupt(interruption)
    return { stop: () => finish(false), cancel }
  } catch (error) {
    const aborted = options.signal.aborted
    cancel()
    if (aborted) throw abortError()
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('Microphone access was denied. Allow microphone access in browser settings or use text chat.')
    }
    // Do not expose device labels, provider payloads, or user content in errors.
    throw new Error('Recording could not start. Check microphone permission, AudioWorklet support, and Azure Speech settings.')
  }
}
