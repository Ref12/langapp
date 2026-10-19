// Change signalling for cloud backup. Kept free of imports so the database layer can use it.
const listeners = new Set<() => void>()
export const DIRTY_KEY_PREFIX = 'linguaweave-backup-dirty:'
let profileKey: string | undefined

export function setDirtyProfile(id: string | undefined): void { profileKey = id }

export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Called after a local write that a backup should capture. */
export function notifyLocalChange(): void {
  try { if (profileKey && typeof localStorage !== 'undefined') localStorage.setItem(DIRTY_KEY_PREFIX + profileKey, '1') } catch { /* storage unavailable */ }
  for (const listener of [...listeners]) listener()
}

export function isDirty(id: string): boolean {
  try { return localStorage.getItem(DIRTY_KEY_PREFIX + id) === '1' } catch { return false }
}

export function clearDirty(id: string): void {
  try { localStorage.removeItem(DIRTY_KEY_PREFIX + id) } catch { /* storage unavailable */ }
}

export function markDirty(id: string): void {
  try { localStorage.setItem(DIRTY_KEY_PREFIX + id, '1') } catch { /* storage unavailable */ }
}
