import { backgroundRequest, runInWorker } from './host'
import { loadActive } from './state'

// Imported by the service worker (bundled to backup-sw.js). Background Sync and Periodic Background Sync fire here,
// even when the app is closed. An automatic run never starts while the app is open and in use.

interface SyncEvent extends Event { tag: string; waitUntil(promise: Promise<unknown>): void }
interface WorkerScope {
  clients: { matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<{ visibilityState: string; focused: boolean }[]> }
  addEventListener(type: 'sync' | 'periodicsync', listener: (event: SyncEvent) => void): void
}
const scope = self as unknown as WorkerScope

async function appInUse(): Promise<boolean> {
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.some(client => client.visibilityState === 'visible' || client.focused)
}

async function automatic(trigger: 'sync' | 'periodic'): Promise<void> {
  if (await appInUse()) {
    // Retry later: a one-shot sync that fails is retried by the browser; periodic ones come around again.
    if (trigger === 'sync') throw new Error('The app is in use; backing up later.')
    return
  }
  const active = await loadActive()
  if (!active) return
  if (trigger === 'periodic' && !active.dirtyAt) return
  const request = await backgroundRequest(trigger)
  if (!request) return
  const reply = await runInWorker(request)
  if (!reply.ok && trigger === 'sync') throw new Error(reply.error)
}

scope.addEventListener('sync', event => { if (event.tag === 'backup') event.waitUntil(automatic('sync')) })
scope.addEventListener('periodicsync', event => { if (event.tag === 'backup') event.waitUntil(automatic('periodic')) })
