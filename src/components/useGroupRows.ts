import { useEffect, useMemo, useState } from 'react'
import { unitRef, type Band } from '../core/study/contracts'
import type { Catalog } from '../core/study/catalog'
import { bandSummaries, grammarLabel, groupRows, type BandSummary, type GroupRow, type Track } from '../data/tracks'
import type { Workspace } from '../core/model'

const refFor = (kind: string, ref: string) => unitRef(kind as 'vocabulary' | 'grammar', ref)

/** True one tick after mount: lets the panels above paint before the list is built. */
export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => { const id = setTimeout(() => setReady(true), 0); return () => clearTimeout(id) }, [])
  return ready
}

export function useKnownTimes(knowledge: Workspace['knowledge']): Map<string, number> {
  return useMemo(() => new Map(knowledge.map(entry => [entry.ref, entry.addedAt])), [knowledge])
}

/** Per-band done/total counts only. */
export function useBandSummaries(track: Track, catalog: Catalog | undefined, known: Map<string, number>, enabled: boolean): BandSummary[] {
  return useMemo(() => catalog && enabled ? bandSummaries(track, catalog.orderedGroups, known, refFor) : [], [track, catalog, known, enabled])
}

/** The rows of one band, built only while it is open. */
export function useBandRows(track: Track, catalog: Catalog | undefined, known: Map<string, number>, nextId: string | undefined, band: Band, open: boolean): GroupRow[] {
  return useMemo(() => catalog && open ? groupRows(track, {
    orderedGroups: catalog.orderedGroups,
    titleOf: (kind, ref) => {
      const unit = catalog.units.get(refFor(kind, ref))
      if (!unit) return ref
      return unit.kind === 'vocabulary' ? unit.record.ch : grammarLabel(unit.record.pt, unit.record.lb)
    },
  }, known, nextId, refFor, band) : [], [track, catalog, known, nextId, band, open])
}
