import { db } from '../database'
import { clipUrl } from './manifest'
import { clipCurves, trackPitch, voiceBounds, type LevelCurve } from './pitch'

/** The default speech rate of Settings (1 when never set): the trainer's clips are pre-made at 1x and played at this rate. */
export async function speechRatePreference(): Promise<number> {
  try { return (await db.preferences.get('workspace'))?.defaultSpeechRate ?? 1 } catch { return 1 }
}

/**
 * Plays at a rate without lowering the pitch: the browser time-stretches (preservesPitch; the webkit- and moz- spellings for older Safari and Firefox).
 * Set after the source, because loading a source puts the rate back to the default.
 */
export function setPlaybackRate(audio: HTMLAudioElement, rate: number): void {
  audio.defaultPlaybackRate = rate
  audio.playbackRate = rate
  audio.preservesPitch = true
  const prefixed = audio as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean }
  if ('webkitPreservesPitch' in audio) prefixed.webkitPreservesPitch = true
  if ('mozPreservesPitch' in audio) prefixed.mozPreservesPitch = true
}

const blobs = new Map<string, Promise<Blob>>()
const urls = new Map<string, string>()
/** The clip's bytes, fetched once (through the service worker's cache) and kept for the page's life; a failure is not kept. */
function clipBlob(file: string): Promise<Blob> {
  let blob = blobs.get(file)
  if (!blob) {
    blob = fetch(clipUrl(file)).then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.blob() })
    blobs.set(file, blob); blob.catch(() => blobs.delete(file))
  }
  return blob
}

/** Plays a clip: fetched as a blob, then played at rate (default 1) with the pitch kept. Resolves when it ends; rejects when it cannot load. */
export async function playClip(file: string, signal?: AbortSignal, rate = 1): Promise<void> {
  const blob = await clipBlob(file)
  let url = urls.get(file)
  if (!url) { url = URL.createObjectURL(blob); urls.set(file, url) }
  if (signal?.aborted) return
  const audio = new Audio(url)
  setPlaybackRate(audio, rate)
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('The clip could not be played.'))
    signal?.addEventListener('abort', () => { audio.pause(); resolve() })
    void audio.play().catch(reject)
  })
}

/** Decodes a clip to mono PCM with Web Audio (a throwaway context: it plays nothing). */
async function decodeMono(blob: Blob): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const Context = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const context = new Context()
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    return { pcm: buffer.getChannelData(0), sampleRate: buffer.sampleRate }
  } finally { void context.close?.() }
}

const curves = new Map<string, Promise<(LevelCurve | null)[]>>()
/**
 * The pitch curves of a clip, one per syllable, tracked in the browser (pitch.ts) and kept per clip. It reuses the bytes playback fetched, never blocks playback
 * (the trainer asks after the answer is checked), and resolves to nulls when the sound cannot be decoded: the chart is then left out.
 */
export function clipPitchCurves(file: string, voice: string, syllables: 1 | 2): Promise<(LevelCurve | null)[]> {
  const key = file + '|' + voice + '|' + syllables
  let found = curves.get(key)
  if (!found) {
    found = clipBlob(file).then(decodeMono).then(({ pcm, sampleRate }) => clipCurves(trackPitch(pcm, sampleRate, voiceBounds(voice)), voice, syllables))
      .catch(() => { curves.delete(key); return Array<null>(syllables).fill(null) })
    curves.set(key, found)
  }
  return found
}
export function resetPlayCachesForTests(): void { blobs.clear(); urls.clear(); curves.clear() }
