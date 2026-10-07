/** Screen Wake Lock wrapper for pocket mode: re-acquires after the page becomes visible again. */
export interface WakeLockController {
  readonly supported: boolean
  /** Starts holding (and re-acquiring) a screen wake lock. */
  start(): void
  /** Releases the lock and stops re-acquiring. */
  stop(): void
  /** True while a lock is currently held. */
  held(): boolean
}

export function wakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && typeof navigator.wakeLock?.request === 'function'
}

export function createWakeLockController(onChange: (held: boolean) => void = () => {}): WakeLockController {
  let wanted = false
  let sentinel: WakeLockSentinel | undefined
  let pending = false
  const supported = wakeLockSupported()

  const acquire = async () => {
    if (!supported || !wanted || sentinel || pending || document.visibilityState !== 'visible') return
    pending = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (!wanted) { await lock.release().catch(() => {}); return }
      sentinel = lock
      lock.addEventListener('release', () => {
        if (sentinel === lock) { sentinel = undefined; onChange(false) }
      })
      onChange(true)
    } catch {
      // Denied (battery saver, permissions policy): degrade silently; the next visibility change retries.
    } finally {
      pending = false
    }
  }
  const visibility = () => { if (document.visibilityState === 'visible') void acquire() }

  return {
    supported,
    start() {
      if (wanted) return
      wanted = true
      document.addEventListener('visibilitychange', visibility)
      void acquire()
    },
    stop() {
      wanted = false
      document.removeEventListener('visibilitychange', visibility)
      const lock = sentinel
      sentinel = undefined
      if (lock) { void lock.release().catch(() => {}); onChange(false) }
    },
    held: () => !!sentinel,
  }
}
