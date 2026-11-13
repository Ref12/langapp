import { clipUrl } from './manifest'

const decoded = new Map<string, Promise<string>>()
/** Plays a clip: fetched as a blob (through the service worker's cache), then played. Resolves when it ends; rejects when it cannot load. */
export async function playClip(file: string, signal?: AbortSignal): Promise<void> {
  let url = decoded.get(file)
  if (!url) { url = fetch(clipUrl(file)).then(async response => { if (!response.ok) throw new Error('HTTP ' + response.status); return URL.createObjectURL(await response.blob()) }); decoded.set(file, url); url.catch(() => decoded.delete(file)) }
  const audio = new Audio(await url)
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('The clip could not be played.'))
    signal?.addEventListener('abort', () => { audio.pause(); resolve() })
    void audio.play().catch(reject)
  })
}
