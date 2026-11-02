import { useSyncExternalStore } from 'react'

function path(): string {
  const route = window.location.hash.slice(1).replace(/^\/+/, '') || 'overview'
  // The section was called Drills for a while: old links and the installed app land on Practice.
  if (/^drills(?=$|[/?])/.test(route)) {
    const moved = route.replace(/^drills/, 'practice')
    window.history.replaceState(null, '', `#${moved}`)
    return moved
  }
  return route
}

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, path, () => 'overview')
}

export function navigate(route: string): void {
  window.location.hash = route
}

/** Replaces the current route without leaving the old one in the history, so Back does not return to a redirect. */
export function redirect(route: string): void {
  window.history.replaceState(null, '', `#${route}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
