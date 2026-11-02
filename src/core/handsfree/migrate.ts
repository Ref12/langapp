import { drillSetSchema, type DrillSet } from '../drills/contracts'
import { handsfreeRunSchema, type HandsfreeRun } from './contracts'

/**
 * A stored Hands-free run (the old handsfreeRuns table, or a backup from before) as a practice set whose Hands-free activity carries the run's
 * seed, settings and resume position. It keeps the run's id, so #practice/handsfree/<id> still finds it. Pure, so the Dexie upgrade and
 * backup restore share it.
 */
export function handsfreeRunToSet(raw: unknown): DrillSet | undefined {
  const parsed = handsfreeRunSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const run: HandsfreeRun = parsed.data
  const finished = run.status === 'completed'
  // A run stopped part-way was offered for resuming: it is an unfinished set. One set aside stays out of Unfinished but in History as stopped; one that was
  // never started was never in History, and stays out of it.
  const resumable = run.started && !finished && !run.discarded
  const status: DrillSet['status'] = finished ? 'completed' : resumable ? 'active' : 'abandoned'
  const unseen = !run.started && !finished
  const set: DrillSet = {
    id: run.id, source: run.source === 'handsfree' ? 'drill' : run.source, ...(run.originId ? { originId: run.originId } : {}),
    title: run.title, refs: run.refs, status, format: 'single', progress: {},
    content: { state: 'pending', sentences: {}, conversations: [] },
    createdAt: run.createdAt, updatedAt: run.updatedAt, ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : status === 'abandoned' ? { completedAt: run.updatedAt } : {}),
    handsfree: { seed: run.seed, settings: run.settings, started: run.started, position: run.position, done: finished, ...(finished ? { finishedAt: run.completedAt ?? run.updatedAt } : {}), ...(run.practiced ? { practiced: run.practiced } : {}) },
    shortcut: 'handsfree',
    ...(unseen ? { discarded: true } : {}), ...(run.removedAt !== undefined ? { removedAt: run.removedAt } : {}),
    ...(run.addOnComplete ? { addOnFinish: run.addOnComplete } : {}), ...(run.promote ? { promote: run.promote } : {}), ...(run.addedRefs ? { addedRefs: run.addedRefs } : {}),
  }
  return drillSetSchema.parse(set)
}
