import { db } from '../database'
import type { ExerciseSession, KnowledgeEntry } from './contracts'
import type { DrillSet } from '../drills/contracts'
import { runAddedRefs } from './knowledge'

/** What added a knowledge entry. No label: nothing is known to say; no href: nothing to open. */
export interface AddedBy { at: number; label?: string; href?: string }
interface Candidate { time: number; label: string; href: string }
/** ref -> the runs that still own that item. Built once for all cards, not per card. */
export type AddedByIndex = Map<string, Candidate[]>

/** "Nov 2, 2026". */
export const addedDate = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** One pass over the lessons and practice sets: each run is checked once (runAddedRefs) and its still-owned refs are indexed. */
export async function buildAddedByIndex(): Promise<AddedByIndex> {
  const [sessions, sets] = await Promise.all([db.exerciseSessions.toArray(), db.drillSets.toArray()])
  const index: AddedByIndex = new Map()
  const put = (ref: string, candidate: Candidate) => { const list = index.get(ref); if (list) list.push(candidate); else index.set(ref, [candidate]) }
  for (const session of sessions as ExerciseSession[]) {
    const time = session.addOnFinish ? session.completedAt : session.createdAt
    if (time === undefined) continue
    for (const ref of await runAddedRefs('lesson', session.id)) put(ref, { time, label: 'a lesson', href: `#lessons/session/${session.id}` })
  }
  for (const set of sets as DrillSet[]) {
    const time = set.addedRefs ? set.completedAt : set.createdAt
    if (set.removedAt || time === undefined) continue
    for (const ref of await runAddedRefs('drill', set.id)) put(ref, { time, label: `${set.collectionId ? 'study' : 'practice'} set: ${set.title}`, href: `#practice/set/${set.id}` })
  }
  return index
}

/**
 * What added the entry as it stands now (the latest addition: a revoked entry is gone and a re-added one has a new addedAt). Nothing is stored,
 * so old entries and backups work, and a revoked or deleted run yields no link. With no run to name, only a 'dictionary' entry says where it came from.
 */
export function addedByFrom(entry: KnowledgeEntry, index: AddedByIndex): AddedBy {
  const at = entry.addedAt
  if (entry.kind === 'source') return { at, label: 'from Media' }
  const best = [...(index.get(entry.ref) ?? [])].sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at))[0]
  if (best) return { at, label: best.label, href: best.href }
  return entry.source === 'dictionary' ? { at, label: 'from the Dictionary' } : { at }
}

export async function addedBy(entry: KnowledgeEntry): Promise<AddedBy> { return addedByFrom(entry, await buildAddedByIndex()) }
