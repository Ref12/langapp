const drafts = new Map<string, { text: string; failed: boolean }>()
const listeners = new Set<() => void>()
let failures: readonly string[] = []

function publish() {
  failures = [...drafts].filter(([, draft]) => draft.failed).map(([id]) => id)
  listeners.forEach(listener => listener())
}

export function subscribeDraftFailures(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getDraftFailures() { return failures }
export function hasUnsavedDrafts() { return drafts.size > 0 }
export function getUnsavedDraft(threadId: string) { return drafts.get(threadId)?.text }

export function rememberDraft(threadId: string, text: string) {
  drafts.set(threadId, { text, failed: false })
  publish()
}

export function finishDraftSave(threadId: string, text: string, saved: boolean) {
  const current = drafts.get(threadId)
  if (!current || current.text !== text) return
  if (saved) drafts.delete(threadId)
  else current.failed = true
  publish()
}

export function discardUnsavedDraft(threadId: string) {
  drafts.delete(threadId)
  publish()
}

export function clearUnsavedDrafts() {
  drafts.clear()
  publish()
}
