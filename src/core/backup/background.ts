import { getActiveProfile } from '../profiles/store'
import { setDirtyHandler } from './dirty'
import { loadActive, markDirtyForBackground, saveActive } from './state'

// Page side of automatic backups. The page never runs a backup by itself: it only notes that something changed (a tiny
// write to the backup state database, throttled) and, when the app goes to the background, asks the browser to wake the
// service worker with Background Sync. Where Background Sync does not exist (Safari, Firefox) there is no automatic backup.

const PERIODIC_MS = 12 * 60 * 60 * 1000
const THROTTLE_MS = 5_000

interface SyncRegistration extends ServiceWorkerRegistration {
  sync?: { register(tag: string): Promise<void> }
  periodicSync?: { register(tag: string, options: { minInterval: number }): Promise<void> }
}

export async function registerBackgroundSync(): Promise<'sync' | 'none'> {
  if (!('serviceWorker' in navigator)) return 'none'
  try {
    const registration = await navigator.serviceWorker.getRegistration() as SyncRegistration | undefined
    if (!registration) return 'none'
    let result: 'sync' | 'none' = 'none'
    if (registration.sync) { await registration.sync.register('backup'); result = 'sync' }
    return result
  } catch { return 'none' }
}

async function registerPeriodic(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration() as SyncRegistration | undefined
    await registration?.periodicSync?.register('backup', { minInterval: PERIODIC_MS })
  } catch { /* not allowed for this browser or install state */ }
}

/** Starts noting changes and registering background syncs; returns a stop function. Nothing here runs a backup. */
export function startBackgroundBackup(): () => void {
  const profile = getActiveProfile()
  void loadActive().then(active => saveActive({ profile, ...(active?.dirtyAt ? { dirtyAt: active.dirtyAt } : {}) }))
  let last = 0
  let pending: ReturnType<typeof setTimeout> | undefined
  const note = () => { void markDirtyForBackground(profile).catch(() => undefined) }
  setDirtyHandler(() => {
    const elapsed = Date.now() - last
    if (elapsed >= THROTTLE_MS) { last = Date.now(); note() } else if (!pending) pending = setTimeout(() => { pending = undefined; last = Date.now(); note() }, THROTTLE_MS - elapsed)
  })
  const hide = () => {
    if (document.visibilityState !== 'hidden') return
    void loadActive().then(active => { if (active?.dirtyAt) return registerBackgroundSync() }).catch(() => undefined)
  }
  document.addEventListener('visibilitychange', hide)
  void registerPeriodic()
  return () => { setDirtyHandler(undefined); clearTimeout(pending); document.removeEventListener('visibilitychange', hide) }
}
