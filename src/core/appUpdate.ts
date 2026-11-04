import { useSyncExternalStore } from 'react'

/**
 * Stale-deploy recovery. A tab keeps running the JS it loaded; after a deploy its lazy chunks (hashed names) no longer exist.
 * When a lazy import fails we ask the server which build is live (version.json, written by scripts/pwa.ts); if it is not the one running,
 * the app shows an "App updated - Reload" bar instead of a raw "Failed to fetch". The service worker's takeover (controllerchange) raises the same bar.
 * No automatic reload: it could drop an exercise or typed input. The bar is a user action, so it cannot loop.
 */
declare const __APP_BUILD__: string | undefined
const running = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : undefined

let updateReady = false
const listeners = new Set<() => void>()
const raise = () => { if (!updateReady) { updateReady = true; listeners.forEach(listener => listener()) } }
export const resetAppUpdate = () => { updateReady = false; listeners.forEach(listener => listener()) }
export const isUpdateReady = () => updateReady
export const useUpdateReady = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => updateReady, () => false)

/** True for the errors a missing hashed chunk produces in Chrome, Firefox and Safari. */
export const isChunkLoadError = (reason: unknown) => /dynamically imported module|importing a module script failed|error loading dynamically imported|Unable to preload CSS|Loading chunk|Loading CSS chunk/i.test(reason instanceof Error ? reason.message : String(reason ?? ''))

/** Ask the server whether a newer build is live. Unknown (offline, no version.json) is not "newer". */
export async function newerBuildLive(fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!running) return false
  try {
    const response = await fetcher(`${import.meta.env?.BASE_URL ?? '/'}version.json?${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return false
    const live = (await response.json() as { build?: string }).build
    return !!live && live !== running
  } catch { return false }
}

/** Call when a lazy load failed. Raises the update bar when the cause is a newer deploy; returns whether it did. */
export async function reportLoadFailure(reason: unknown): Promise<boolean> {
  if (!isChunkLoadError(reason) && reason !== undefined) return false
  if (await newerBuildLive()) { raise(); return true }
  return false
}

export function installUpdateGuard() {
  window.addEventListener('vite:preloadError', event => { event.preventDefault(); void reportLoadFailure((event as Event & { payload?: unknown }).payload ?? new Error('Failed to fetch dynamically imported module')) })
  window.addEventListener('unhandledrejection', event => { if (isChunkLoadError(event.reason)) void reportLoadFailure(event.reason) })
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', raise)
}
