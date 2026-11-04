import { useEffect, useState } from 'react'
import { reportLoadFailure } from '../../core/appUpdate'
import { loadComponentData, loadPartGlyphs, type ComponentData, type PartGlyphs } from '../../core/characters/components'

/** The component data and drawn glyphs, fetched on first use (the first screen that mounts this) and cached for the session. */
export function useComponentData(enabled = true): { data?: ComponentData; glyphs?: PartGlyphs; error?: string } {
  const [state, setState] = useState<{ data?: ComponentData; glyphs?: PartGlyphs; error?: string }>({})
  useEffect(() => {
    if (!enabled) return
    let live = true
    Promise.all([loadComponentData(), loadPartGlyphs()]).then(([data, glyphs]) => { if (live) setState({ data, glyphs }) },
      reason => { void reportLoadFailure(reason); if (live) setState({ error: 'Parts unavailable offline' }) })
    return () => { live = false }
  }, [enabled])
  return state
}

/** The existing Dictionary route: it opens the Characters list on that one character. */
export const dictionaryHref = (character: string) => `#dictionary/characters/all?q=${encodeURIComponent(character)}`

