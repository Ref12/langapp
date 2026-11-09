import { useMemo } from 'react'
import profileLabels from '../data/v2/profile-word-labels.generated.json'
import { unitRef } from '../core/study/contracts'
import { useCatalog } from './study/useCatalog'
import type { Catalog } from '../core/study/catalog'
import { lessonRows, unreachableItems, type LessonRow, type Track } from '../data/tracks'
import type { Workspace } from '../core/model'

const labelOf = new Map(profileLabels.map(entry => [entry.id, entry.lb]))
export const refOf = (wordId: string) => { const lb = labelOf.get(wordId); return lb ? unitRef('vocabulary', lb) : undefined }

/** Every unit a New items set can introduce. */
export function reachableRefs(catalog: Catalog): Set<string> {
  return new Set(catalog.orderedGroups.flatMap(({ group }) => group.units.map(unit => unitRef(unit.kind, unit.ref))))
}

/** The track's lesson items that no New items set can introduce, per lesson (the study groups can be fixed against this). */
export function unreachableLessonItems(track: Track, catalog: Catalog) {
  return unreachableItems(track, refOf, reachableRefs(catalog))
}

/** Rows for a track from the knowledge set the New items sets use. `nextNew` is what the next New items set would teach. */
export function useLessonRows(track: Track, workspace: Pick<Workspace, 'knowledge' | 'lessons'>, nextNew: Iterable<string> = []): LessonRow[] {
  const { catalog } = useCatalog()
  const next = useMemo(() => new Set(nextNew), [nextNew])
  const reachable = useMemo(() => catalog ? reachableRefs(catalog) : undefined, [catalog])
  return useMemo(() => lessonRows(track, {
    known: new Map(workspace.knowledge.map(entry => [entry.ref, entry.addedAt])), nextNew: next, refOf, reachable, records: workspace.lessons,
  }), [track, workspace.knowledge, workspace.lessons, next, reachable])
}
