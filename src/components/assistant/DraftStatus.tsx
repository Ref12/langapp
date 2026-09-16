import { useEffect, useSyncExternalStore } from 'react'
import { getDraftFailures, hasUnsavedDrafts, subscribeDraftFailures } from '../../core/assistant/drafts'

export function DraftStatus() {
  const failures = useSyncExternalStore(subscribeDraftFailures, getDraftFailures, getDraftFailures)
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedDrafts()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
  return failures.length ? <div className="draft-save-status" role="alert" data-assistant-exclude>
    An Assistant draft could not be saved and is only in memory. <a href={`#conversation/${failures[0]}`}>Return to the draft</a> before closing or reloading.
  </div> : null
}
