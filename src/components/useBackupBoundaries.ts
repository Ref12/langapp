import { useEffect, useRef } from 'react'
import { atBoundary, setExerciseOpen } from '../core/backup/auto'

/**
 * Natural boundaries for the automatic backup: a practice/lesson session ending while its page stays up, and moving to
 * another page (which also covers leaving a lesson or session part-way). Opening the app is not a boundary.
 */
export function useBackupBoundaries(route: string, exerciseOpen: boolean): void {
  const lastRoute = useRef<string>()
  const wasOpen = useRef(false)
  useEffect(() => {
    setExerciseOpen(exerciseOpen)
    const ended = wasOpen.current && !exerciseOpen
    wasOpen.current = exerciseOpen
    if (ended) void atBoundary()
  }, [exerciseOpen])
  useEffect(() => {
    const path = route.split('?')[0]
    const moved = lastRoute.current !== undefined && lastRoute.current !== path
    lastRoute.current = path
    if (moved) void atBoundary()
  }, [route])
}
