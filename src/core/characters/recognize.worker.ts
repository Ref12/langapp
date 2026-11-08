import { loadRecognitionIndex, recognize, type RecognitionIndex } from './recognize'
import type { RecognizeRequest, RecognizeReply } from './handwriting'

const scope = self as unknown as {
  onmessage: ((event: { data: RecognizeRequest }) => void) | null
  postMessage: (message: RecognizeReply) => void
}
const loading = new Map<string, Promise<RecognitionIndex>>()
let allowedText: string | undefined
let allowedSet: Set<string> | undefined

scope.onmessage = event => {
  const { id, url, drawing, allowed } = event.data
  let request = loading.get(url)
  if (!request) { request = loadRecognitionIndex(url); loading.set(url, request) }
  request.then(index => {
    if (allowedText !== allowed) { allowedText = allowed; allowedSet = new Set(Array.from(allowed)) }
    scope.postMessage({ id, matches: recognize(index, drawing, { limit: 8, allowed: allowedSet }) })
  }, reason => {
    loading.delete(url)
    scope.postMessage({ id, error: reason instanceof Error ? reason.message : String(reason) })
  })
}
