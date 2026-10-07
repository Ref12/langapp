import { useCallback, useEffect, useRef, useState } from 'react'
import { createWakeLockController, type WakeLockController } from '../../core/pocket/wake-lock'

/** Pocket mode state: while `active` or a speech session is running holds a screen wake lock, re-acquired when the page is visible again. */
export function usePocketMode(speechSession = false) {
  const [active, setActive] = useState(false)
  const [wakeLockHeld, setHeld] = useState(false)
  const controller = useRef<WakeLockController>()
  if (!controller.current) controller.current = createWakeLockController(setHeld)
  const wake = controller.current

  useEffect(() => {
    if (!active && !speechSession) return
    wake.start()
    return () => wake.stop()
  }, [active, speechSession, wake])

  const enter = useCallback(() => setActive(true), [])
  const exit = useCallback(() => setActive(false), [])
  return { active, enter, exit, wakeLockHeld, wakeLockSupported: wake.supported }
}
