import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { chooseRefs, shortDate, type DrillSource } from '../drills/store'
import { catalogSentence, loadItems } from '../drills/items'
import { promoteItems } from '../collections/store'
import { addUnits } from '../study/knowledge'
import { DEFAULT_HANDSFREE_SETTINGS, handsfreeRunSchema, handsfreeSettingsSchema, type HandsfreeRun, type HandsfreeSettings } from './contracts'
import { generateScript, type Script, type ScriptItem, type ScriptSentence } from './script'

const SETTINGS_KEY = 'handsfree.settings'

/** The settings last used, remembered on this device. */
export function loadHandsfreeSettings(): HandsfreeSettings {
  try {
    const parsed = handsfreeSettingsSchema.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'))
    if (parsed.success) return parsed.data
  } catch { /* unreadable settings fall back to the defaults */ }
  return DEFAULT_HANDSFREE_SETTINGS
}
export function saveHandsfreeSettings(settings: HandsfreeSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage may be unavailable; the run keeps its own copy */ }
}

/** Creates a run from the same sources as a practice set. A New items run adds its items to the knowledge set only when it reaches the end (completeHandsfreeRun). */
export async function createHandsfreeRun(source: DrillSource, now = Date.now()): Promise<string> {
  const chosen = await chooseRefs(source, now)
  const id = crypto.randomUUID()
  const run: HandsfreeRun = {
    id, title: source.kind === 'skill' ? `Hands-free · ${chosen.title}` : `Hands-free · ${shortDate(now)}`, refs: chosen.refs, source: source.kind === 'refs' || source.kind === 'skill' ? chosen.setSource! : source.kind,
    ...(chosen.originId ? { originId: chosen.originId } : {}),
    ...(source.kind === 'new' ? { addOnComplete: chosen.refs, ...(chosen.promote ? { promote: chosen.promote } : {}) } : {}), seed: Math.floor(Math.random() * 2 ** 31),
    settings: loadHandsfreeSettings(), status: 'active', started: false, position: 0, createdAt: now, updatedAt: now,
  }
  await db.handsfreeRuns.add(handsfreeRunSchema.parse(run))
  return id
}

/** A fresh run over the same items, for Again. */
export async function repeatHandsfreeRun(id: string, now = Date.now()): Promise<string> {
  const earlier = await db.handsfreeRuns.get(id)
  if (!earlier) throw new Error('That Hands-free run could not be found.')
  const next: HandsfreeRun = { id: crypto.randomUUID(), title: `Hands-free · ${shortDate(now)}`, refs: earlier.refs, source: 'handsfree', originId: earlier.id,
    seed: Math.floor(Math.random() * 2 ** 31), settings: earlier.settings, status: 'active', started: false, position: 0, createdAt: now, updatedAt: now }
  await db.handsfreeRuns.add(handsfreeRunSchema.parse(next))
  return next.id
}

export const getHandsfreeRun = (id: string) => db.handsfreeRuns.get(id)

export async function updateHandsfreeRun(id: string, change: Partial<Pick<HandsfreeRun, 'status' | 'started' | 'position' | 'settings' | 'discarded'>>, now = Date.now()) {
  await db.transaction('rw', db.handsfreeRuns, async () => {
    const run = await db.handsfreeRuns.get(id)
    if (!run) return
    const next = { ...run, ...change, updatedAt: now, ...(change.status === 'completed' ? { completedAt: now } : {}) }
    await db.handsfreeRuns.put(handsfreeRunSchema.parse(next))
  })
}

/** Runs that were started and not finished, newest first: what Practice home offers to resume. */
export const unfinishedHandsfreeRuns = (runs: readonly HandsfreeRun[]) => runs.filter(run => run.started && run.status !== 'completed' && !run.discarded).sort((a, b) => b.updatedAt - a.updatedAt)

/** Sets a run aside from Practice home. It stays in History as stopped. */
export const discardHandsfreeRun = (id: string) => updateHandsfreeRun(id, { discarded: true, status: 'abandoned' })

/**
 * Marks the run completed and, the first time only, adds its New items to the knowledge set as a lesson does.
 * Returns the refs this completion added; a replayed run, or one with nothing to add, returns an empty list.
 */
export async function completeHandsfreeRun(id: string, position: number, now = Date.now()): Promise<string[]> {
  const claimed = await db.transaction('rw', db.handsfreeRuns, async () => {
    const run = await db.handsfreeRuns.get(id)
    if (!run) return undefined
    const owed = !!run.addOnComplete?.length && run.addedRefs === undefined
    await db.handsfreeRuns.put(handsfreeRunSchema.parse({ ...run, status: 'completed', started: true, position, updatedAt: now, completedAt: run.completedAt ?? now, ...(owed ? { addedRefs: [] } : {}) }))
    return owed ? run : undefined
  })
  if (!claimed) return []
  try {
    const refs = claimed.addOnComplete!
    const before = new Set((await db.knowledge.bulkGet(refs)).flatMap(entry => entry ? [entry.ref] : []))
    if (claimed.promote?.length) await promoteItems(claimed.promote)
    else {
      const catalog = await loadCatalog()
      await db.transaction('rw', [db.knowledge, db.studyCards, db.journal], () => addUnits(refs.flatMap(ref => catalog.units.get(ref) ?? []), 'new', now))
    }
    const added = (await db.knowledge.bulkGet(refs)).flatMap(entry => entry && !before.has(entry.ref) ? [entry.ref] : [])
    await db.handsfreeRuns.update(id, { addedRefs: added })
    return added
  } catch (cause) {
    await db.handsfreeRuns.update(id, { addedRefs: undefined })
    throw cause
  }
}

/** The run's script: its items from the catalog, grammar sentences from the catalog examples. */
export async function buildRunScript(run: HandsfreeRun): Promise<{ script: Script; items: ScriptItem[] }> {
  const catalog = await loadCatalog()
  const found = await loadItems(run.refs, catalog)
  const sentences: Record<string, ScriptSentence | undefined> = {}
  for (const item of found) {
    const sentence = item.kind === 'grammar' ? catalogSentence(catalog, item) : undefined
    if (sentence) sentences[item.ref] = { zh: sentence.zh, en: sentence.en }
  }
  const items: ScriptItem[] = found.map(item => ({ ref: item.ref, kind: item.kind, zh: item.zh, en: item.en }))
  return { script: generateScript(items, sentences, run.settings, run.seed), items }
}
