import { LOOPBACK_HOSTNAMES, type EdgeVoicePreference, type SpeechLocale } from './contracts'
import {
  edgeVoiceCatalogSchema, localTtsRequestSchema, localTtsResponseSchema,
  LOCAL_TTS_HEADER, LOCAL_TTS_PATH, LOCAL_TTS_VOICES_PATH, LOCAL_TTS_MAX_RESPONSE_BYTES,
} from '../local-tts-contracts'
import type { PlaybackOutcome } from './speech'

export type EdgePlaybackPhase = 'loading-audio' | 'starting' | 'speaking'
export interface EdgeSpeechPlayback {
  cancel: () => string | undefined
  done: Promise<PlaybackOutcome>
}

class EdgeSpeechError extends Error {}

export function edgeTtsAvailable() {
  return import.meta.env.DEV && import.meta.env.DEV_LOCAL_TTS === 'true'
    && typeof location !== 'undefined' && LOOPBACK_HOSTNAMES.includes(location.hostname)
}

async function localJson(path: string, signal: AbortSignal, body?: string): Promise<unknown> {
  if (!edgeTtsAvailable()) throw new EdgeSpeechError('Edge voices require the local development server. Choose a browser voice on this site.')
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new EdgeSpeechError('The local Edge speech request timed out. Try again.')), body ? 50_000 : 20_000)
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path.slice(1)}`, {
      method: body ? 'POST' : 'GET',
      headers: { [LOCAL_TTS_HEADER]: '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body, signal: controller.signal, cache: 'no-store', credentials: 'omit',
      mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
    })
    controller.signal.throwIfAborted()
    if (!response.ok) {
      await response.body?.cancel()
      throw new EdgeSpeechError(`Local Edge TTS failed (HTTP ${response.status}). Check the development server and try again.`)
    }
    if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) {
      await response.body?.cancel()
      throw new EdgeSpeechError('The local Edge speech server returned an invalid response.')
    }
    const limit = body ? LOCAL_TTS_MAX_RESPONSE_BYTES : 1024 * 1024
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let text = ''
    let bytes = 0
    let complete = false
    try {
      while (true) {
        const part = await reader.read()
        controller.signal.throwIfAborted()
        if (part.done) { complete = true; break }
        bytes += part.value.byteLength
        if (bytes > limit) throw new EdgeSpeechError('The local Edge speech response exceeded its size limit.')
        text += decoder.decode(part.value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      if (!complete) await reader.cancel()
      reader.releaseLock()
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new EdgeSpeechError('The local Edge speech server returned invalid JSON.')
    }
  } catch (error) {
    controller.signal.throwIfAborted()
    if (error instanceof EdgeSpeechError) throw error
    throw new EdgeSpeechError('Could not reach the local Edge speech server. Check the server and network connection.')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export async function loadEdgeVoices(signal: AbortSignal) {
  const parsed = edgeVoiceCatalogSchema.safeParse(await localJson(LOCAL_TTS_VOICES_PATH, signal))
  if (!parsed.success) throw new EdgeSpeechError('The Edge voice catalog was invalid. Refresh the voice list to try again.')
  return parsed.data.voices
}

function textChunks(text: string): string[] {
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > 1000) {
    const prefix = remaining.slice(0, 1000)
    const endings = [...prefix.matchAll(/[.!?\u3002\uff01\uff1f\n]\s*/g)]
    const ending = endings[endings.length - 1]
    let split = ending ? ending.index! + ending[0].length : prefix.lastIndexOf(' ')
    if (split <= 0) {
      split = 1000
      const code = remaining.charCodeAt(split - 1)
      if (code >= 0xd800 && code <= 0xdbff) split--
    }
    const chunk = remaining.slice(0, split).trim()
    if (chunk) chunks.push(chunk)
    remaining = remaining.slice(split).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export function startEdgeSpeech(
  text: string, preference: EdgeVoicePreference, locale: SpeechLocale, rate: number,
  phase: (value: EdgePlaybackPhase) => void,
): EdgeSpeechPlayback {
  const controller = new AbortController()
  let element: HTMLAudioElement | undefined
  let objectUrl: string | undefined
  let cleanupError: string | undefined
  const disposeAudio = () => {
    const audio = element
    element = undefined
    if (audio) {
      audio.onplaying = null
      audio.onended = null
      audio.onerror = null
      try { audio.pause() } catch { cleanupError = 'The browser could not stop Edge audio. Close this page before playing more audio.' }
      try { audio.removeAttribute('src'); audio.load() } catch { cleanupError = 'The browser could not release Edge audio. Close this page before playing more audio.' }
    }
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl) } catch { cleanupError = 'The browser could not release the Edge audio URL. Reload before playing more audio.' }
      objectUrl = undefined
    }
    return cleanupError
  }

  const playClip = (blob: Blob) => new Promise<void>((resolve, reject) => {
    let settled = false
    let playPending = true
    let ended = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', abort)
      const cleanup = disposeAudio()
      if (cleanup) reject(new EdgeSpeechError(cleanup))
      else if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(controller.signal.reason)
    if (controller.signal.aborted) { abort(); return }
    controller.signal.addEventListener('abort', abort, { once: true })
    try {
      const audio = new Audio()
      element = audio
      objectUrl = URL.createObjectURL(blob)
      audio.src = objectUrl
      audio.playbackRate = 1
      audio.onplaying = () => {
        if (settled) return
        clearTimeout(timer)
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 + 15_000 : 400_000
        timer = setTimeout(() => finish(new EdgeSpeechError('Edge audio playback timed out. Try a shorter passage.')), Math.min(400_000, duration))
        phase('speaking')
      }
      audio.onended = () => {
        if (settled) return
        if (playPending) ended = true
        else finish()
      }
      audio.onerror = () => finish(new EdgeSpeechError('Edge audio could not be decoded or played. Try again.'))
      timer = setTimeout(() => finish(new EdgeSpeechError('The browser did not start Edge audio in time. Try again.')), 10_000)
      phase('starting')
      if (settled) return
      Promise.resolve(audio.play()).then(() => {
        if (settled) return
        playPending = false
        if (ended) finish()
      }, () => finish(new EdgeSpeechError('The browser blocked Edge audio. Allow sound, then use Test voice or Hear again.')))
    } catch {
      finish(new EdgeSpeechError('The browser could not prepare Edge audio playback.'))
    }
  })

  // Defer work until the caller has installed this handle in the shared audio owner.
  const done: Promise<PlaybackOutcome> = Promise.resolve().then(async () => {
    controller.signal.throwIfAborted()
    if (!text.trim() || text.length > 8000) throw new EdgeSpeechError('Choose a non-empty passage of at most 8,000 characters to hear.')
    if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new EdgeSpeechError('This browser cannot play Edge audio. Choose a browser voice instead.')
    }
    for (const chunk of textChunks(text)) {
      controller.signal.throwIfAborted()
      const input = localTtsRequestSchema.safeParse({ text: chunk, voice: preference.voice, rate: locale === 'en-US' ? 1 : rate })
      if (!input.success) throw new EdgeSpeechError('This text, voice, or speaking speed is not supported by Edge TTS.')
      phase('loading-audio')
      controller.signal.throwIfAborted()
      const parsed = localTtsResponseSchema.safeParse(await localJson(LOCAL_TTS_PATH, controller.signal, JSON.stringify(input.data)))
      if (!parsed.success) throw new EdgeSpeechError('The local Edge speech server returned invalid audio data.')
      controller.signal.throwIfAborted()
      const bytes = Uint8Array.from(atob(parsed.data.audio.base64), character => character.charCodeAt(0))
      if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) throw new EdgeSpeechError('The Edge audio clip exceeded its size limit.')
      await playClip(new Blob([bytes], { type: parsed.data.audio.contentType }))
    }
    controller.signal.throwIfAborted()
    return { status: 'completed' } as const
  }).catch((error: unknown): PlaybackOutcome => {
    const cleanup = disposeAudio()
    if (cleanup) return { status: 'error', error: cleanup }
    if (controller.signal.aborted) return { status: 'cancelled' }
    return { status: 'error', error: error instanceof EdgeSpeechError ? error.message : 'Edge speech could not be played. Check the local server and try again.' }
  })
  return {
    done,
    cancel: () => {
      controller.abort()
      return disposeAudio()
    },
  }
}
