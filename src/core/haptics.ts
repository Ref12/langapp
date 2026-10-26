export type HapticKind = 'tick' | 'success' | 'error'

const PATTERNS: Record<HapticKind, number> = { tick: 10, success: 20, error: 60 }

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** Short vibration for a gesture result; no-ops without support or when the haptics preference is off (pass preferences.haptics !== false). */
export function haptic(kind: HapticKind, enabled = true): void {
  if (!enabled || !hapticsSupported()) return
  try { navigator.vibrate(PATTERNS[kind]) } catch { /* ignore */ }
}
