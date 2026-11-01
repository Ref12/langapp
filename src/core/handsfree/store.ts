import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { chooseRefs, shortDate, type DrillSource } from '../drills/store'
import { catalogSentence, loadItems } from '../drills/items'
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

/** Creates a run from the same sources as a practice set. New items are not added to the knowledge set: listening is not yet learning. */
export async function createHandsfreeRun(source: DrillSource, now = Date.now()): Promise<string> {
  const chosen = await chooseRefs(source, now)
  const id = crypto.randomUUID()
  const run: HandsfreeRun = {
    id, title: `Hands-free · ${shortDate(now)}`, refs: chosen.refs, source: source.kind === 'refs' ? chosen.setSource! : source.kind,
    ...(chosen.originId ? { originId: chosen.originId } : {}), seed: Math.floor(Math.random() * 2 ** 31),
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

export async function updateHandsfreeRun(id: string, change: Partial<Pick<HandsfreeRun, 'status' | 'started' | 'position' | 'settings'>>, now = Date.now()) {
  await db.transaction('rw', db.handsfreeRuns, async () => {
    const run = await db.handsfreeRuns.get(id)
    if (!run) return
    const next = { ...run, ...change, updatedAt: now, ...(change.status === 'completed' ? { completedAt: now } : {}) }
    await db.handsfreeRuns.put(handsfreeRunSchema.parse(next))
  })
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
