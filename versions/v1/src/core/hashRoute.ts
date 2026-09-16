import { useSyncExternalStore } from 'react'

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return hash.startsWith('/') ? hash : '/'
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useHashPath(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/')
}
