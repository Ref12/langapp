import { useSyncExternalStore } from 'react'

function path(): string {
  return window.location.hash.slice(1).replace(/^\/+/, '') || 'overview'
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
