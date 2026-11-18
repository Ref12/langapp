import { createContext, useContext, useEffect } from 'react'

/** Focus mode: while a practice run is on screen the app's top bar is hidden. The app shell provides the setter; without it (a page on its own) nothing happens. */
export const FocusModeContext = createContext<((on: boolean) => void) | undefined>(undefined)

export function useFocusMode(on: boolean) {
  const set = useContext(FocusModeContext)
  useEffect(() => {
    if (!set || !on) return
    set(true)
    return () => set(false)
  }, [set, on])
}
