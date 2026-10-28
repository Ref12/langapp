import type { Point } from './geometry'
import { loadRecognitionIndex, recognize, type RecognitionIndex, type RecognitionMatch } from './recognize'

export interface RecognizeRequest { id: number; url: string; drawing: Point[][]; allowed: string }
export type RecognizeReply = { id: number; matches: RecognitionMatch[] } | { id: number; error: string }

export interface HandwritingRecognizer {
  /** Top candidates for strokes drawn in any order, limited to the characters in `allowed`. */
  recognize(drawing: Point[][], allowed: string): Promise<RecognitionMatch[]>
  dispose(): void
}

// Read lazily: this module is reachable from the Vite config bundle (Node), where import.meta.env is undefined.
const indexUrl = () => `${import.meta.env?.BASE_URL ?? '/'}characters/chinese/recognition.generated.json`

/**
 * Recognition runs in a worker so drawing never waits on it; without Worker support (or if it fails to start)
 * the same code runs on the page. Nothing leaves the device: the index is a static file next to the guides.
 */
export function createHandwritingRecognizer(): HandwritingRecognizer {
  let worker: Worker | undefined
  let fallback: Promise<RecognitionIndex> | undefined
  let next = 0
  const pending = new Map<number, { resolve: (matches: RecognitionMatch[]) => void; reject: (error: Error) => void }>()
  const inPage = async (drawing: Point[][], allowed: string) => {
    fallback ??= loadRecognitionIndex(indexUrl())
    const index = await fallback.catch(error => { fallback = undefined; throw error })
    return recognize(index, drawing, { limit: 8, allowed: new Set(Array.from(allowed)) })
  }
  const start = () => {
    if (worker || typeof Worker === 'undefined') return worker
    try {
      const created = new Worker(new URL('./recognize.worker.ts', import.meta.url), { type: 'module' })
      created.onmessage = (event: MessageEvent<RecognizeReply>) => {
        const request = pending.get(event.data.id)
        if (!request) return
        pending.delete(event.data.id)
        if ('error' in event.data) request.reject(new Error(event.data.error))
        else request.resolve(event.data.matches)
      }
      created.onerror = () => {
        created.terminate()
        if (worker === created) worker = undefined
        for (const request of pending.values()) request.reject(new Error('Handwriting recognition stopped.'))
        pending.clear()
        unsupported = true
      }
      worker = created
    } catch { unsupported = true }
    return worker
  }
  let unsupported = false
  return {
    recognize(drawing, allowed) {
      const active = unsupported ? undefined : start()
      if (!active) return inPage(drawing, allowed)
      return new Promise((resolve, reject) => {
        const id = ++next
        pending.set(id, { resolve, reject })
        active.postMessage({ id, url: indexUrl(), drawing, allowed } satisfies RecognizeRequest)
      })
    },
    dispose() {
      worker?.terminate()
      worker = undefined
      for (const request of pending.values()) request.reject(new Error('Handwriting recognition closed.'))
      pending.clear()
    },
  }
}
