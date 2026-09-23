import { useEffect, useState } from 'react'
import { loadCatalog, type Catalog } from '../../core/study/catalog'

/** Loads the generated v2 curriculum once per app session. */
export function useCatalog(): { catalog?: Catalog; error?: string } {
  const [state, setState] = useState<{ catalog?: Catalog; error?: string }>({})
  useEffect(() => {
    let disposed = false
    loadCatalog().then(
      catalog => { if (!disposed) setState({ catalog }) },
      reason => { if (!disposed) setState({ error: reason instanceof Error ? reason.message : String(reason) }) },
    )
    return () => { disposed = true }
  }, [])
  return state
}
