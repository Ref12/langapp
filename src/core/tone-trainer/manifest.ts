// Loads the tone trainer's manifest and clips, only when the trainer (or a Which tones? question) asks.
// The files are plain same-origin GETs, so the app's service worker keeps them in its runtime cache: a second visit works offline.
import type { ToneItem } from './items'


/** t0/t1: a pair's word timings. */
export interface ToneClip { file: string; chars: string; t0?: number; t1?: number; }
export interface ToneManifestItem extends ToneItem { clips: Record<string, ToneClip> }
export interface ToneManifest { version: 1; voices: { id: string; voice: string; gender: string }[]; items: ToneManifestItem[] }

const BASE = './audio/tones/'
let loading: Promise<ToneManifest | undefined> | undefined

/** The manifest, or undefined when it cannot be fetched (offline and never opened). Kept for the page's life; a failure is not kept. */
export function loadToneManifest(): Promise<ToneManifest | undefined> {
  loading ??= fetch(BASE + 'manifest.json').then(async response => {
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const manifest = await response.json() as ToneManifest
    return manifest?.version === 1 && Array.isArray(manifest.items) ? manifest : undefined
  }).catch(() => { loading = undefined; return undefined })
  return loading
}
export function resetToneManifestForTests(): void { loading = undefined }

export const clipUrl = (file: string): string => BASE + file

/** The manifest item for a Chinese word's tone-digit label ("ba1-yue4"), when the trainer has that word. */
export const itemForSyllables = (manifest: ToneManifest, syllables: string[]): ToneManifestItem | undefined => manifest.items.find(item => item.kind === 'pair' && item.id === 'w-' + syllables.join('-'))
export const itemForWord = (manifest: ToneManifest, chars: string): ToneManifestItem | undefined => manifest.items.find(item => item.kind === 'pair' && item.chars === chars)

