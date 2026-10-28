import { loadRecognitionIndex, recognize, type RecognitionIndex } from './recognize'
import type { RecognizeRequest, RecognizeReply } from './handwriting'

const scope = self as unknown as {
  onmessage: ((event: { data: RecognizeRequest }) => void) | null
  postMessage: (message: RecognizeReply) => void
}
let loading: Promise<RecognitionIndex> | undefined
let allowedText: string | undefined
let allowedSet: Set<string> | undefined

scope.onmessage = event => {
  const { id, url, drawing, allowed } = event.data
  loading ??= loadRecognitionIndex(url)
  loading.then(index => {
    if (allowedText !== allowed) { allowedText = allowed; allowedSet = new Set(Array.from(allowed)) }
    scope.postMessage({ id, matches: recognize(index, drawing, { limit: 8, allowed: allowedSet }) })
  }, reason => {
    loading = undefined
    scope.postMessage({ id, error: reason instanceof Error ? reason.message : String(reason) })
  })
}
