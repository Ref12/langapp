// Records the learner's voice as raw PCM in memory (nothing is stored or uploaded) and stops by itself.
// Tap to start, then it stops after about 2 s of speech or 1 s of silence after speech, or when the learner taps Stop: tap-to-start is used rather than hold-to-talk
// because a long press on Android Chrome opens the context menu and cancels the touch.
// The microphone is asked with echo cancellation, noise suppression and automatic gain off, which would bend the pitch.

export type MicProblem = 'denied' | 'missing'
export class MicError extends Error { constructor(public kind: MicProblem) { super(kind === 'denied' ? 'The microphone was refused.' : 'No microphone was found.') } }

export interface Recording { pcm: Float32Array; sampleRate: number }
export interface RecordOptions {
  /** 'speech': stop after SPEECH_SECONDS of speech or SILENCE_SECONDS of quiet after speech. 'fixed': record exactly this many seconds (the calibration). */
  mode: 'speech' | 'fixed'
  seconds?: number
  /** Called about ten times a second with the current loudness (0-1), for a level meter. */
  onLevel?: (level: number) => void
}
export interface Recorder { done: Promise<Recording>; stop: () => void }

export const SPEECH_SECONDS = 2
export const SILENCE_SECONDS = 1
/** With no speech at all, give up after this long. */
export const NO_SPEECH_SECONDS = 6
export const MIC_CONSTRAINTS: MediaStreamConstraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }

/** Decides when to stop, from the loudness of consecutive chunks. A pure state machine, so it is tested without a microphone. */
export function createEndpointer(sampleRate: number) {
  let noise = 0, seen = 0, speech = 0, silence = 0, started = false, elapsed = 0
  return (chunk: Float32Array): boolean => {
    let sum = 0
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
    const rms = Math.sqrt(sum / Math.max(1, chunk.length)), seconds = chunk.length / sampleRate
    elapsed += seconds
    // The first 0.3 s is the room: its loudness sets how loud speech has to be.
    if (seen < 0.3) { noise = Math.max(noise, rms); seen += seconds; return false }
    const loud = rms > Math.max(0.02, noise * 3)
    if (loud) { started = true; speech += seconds; silence = 0 } else if (started) silence += seconds
    if (started && (speech >= SPEECH_SECONDS || silence >= SILENCE_SECONDS)) return true
    return !started && elapsed >= NO_SPEECH_SECONDS
  }
}

export async function recordSpeech(options: RecordOptions): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('missing')
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS) } catch (error) {
    throw new MicError((error as DOMException)?.name === 'NotFoundError' || (error as DOMException)?.name === 'OverconstrainedError' ? 'missing' : 'denied')
  }
  const Context = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const context = new Context()
  const source = context.createMediaStreamSource(stream)
  const node = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  const endpoint = createEndpointer(context.sampleRate)
  let finish: () => void = () => {}
  let finished = false
  const done = new Promise<Recording>(resolve => {
    finish = () => {
      if (finished) return
      finished = true
      node.onaudioprocess = null
      try { source.disconnect(); node.disconnect() } catch { /* already closed */ }
      stream.getTracks().forEach(track => track.stop())
      void context.close?.()
      const pcm = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
      let at = 0
      for (const chunk of chunks) { pcm.set(chunk, at); at += chunk.length }
      resolve({ pcm, sampleRate: context.sampleRate })
    }
  })
  let recorded = 0
  node.onaudioprocess = event => {
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0))
    chunks.push(chunk); recorded += chunk.length / context.sampleRate
    let sum = 0
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
    options.onLevel?.(Math.min(1, Math.sqrt(sum / chunk.length) * 6))
    if (options.mode === 'fixed' ? recorded >= (options.seconds ?? 8) : endpoint(chunk)) finish()
  }
  source.connect(node); node.connect(context.destination)
  return { done, stop: finish }
}
