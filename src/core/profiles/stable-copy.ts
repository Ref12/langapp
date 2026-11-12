// Reads Stable's data, and nothing else, straight out of the browser's IndexedDB for the one-way "Copy profile from Stable".
//
// Stable's databases belong to Stable. Lab's schema version will move past Stable's one day, and opening a database with a
// newer schema upgrades it for good and locks the older build out. So this module:
//   - never imports the learning database class or Dexie, and never declares a schema: it calls indexedDB.open(name) with
//     no version, which opens the database as it is;
//   - never opens a database that does not exist (that would create an empty one under Stable's name);
//   - uses read-only transactions only, and has no write call of any kind.
// storage-names.ts is the only other module allowed to spell Stable's names; they are asked for by channel here.

import { storageNames } from '../storage-names'

const stable = () => storageNames('stable')

export interface StableCounts { knowledge: number; japaneseKorean: number; cards: number; answers: number; threads: number; journal: number }
/** The connections a Stable profile holds: AI endpoints, speech connections, and whether a GitHub backup connection is saved (here or in Stable's localStorage copy). */
export interface StableConnections { ai: number; speech: number; backup: boolean }
export interface StableProfile {
  id: string
  /** The name in Stable's profile list. */
  name: string
  /** The workspace name shown in Stable's navigation, when it has one. */
  workspace?: string
  selected: boolean
  /** Epoch milliseconds of the newest answer, journal event or card change; undefined for an unused profile. */
  lastActivity?: number
  counts: StableCounts
  connections: StableConnections
}

export interface RawStore { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[] }
export interface RawDump { name: string; version: number; stores: RawStore[]; rows: Record<string, { key: IDBValidKey; value: unknown }[]> }

const request = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed')) })

async function exists(name: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases
  if (!list) return true // very old engines: open() below still refuses to keep a database it had to create
  return (await list.call(indexedDB)).some(entry => entry.name === name)
}

/** Opens an existing database as it is. Resolves undefined if there is none; never creates one. */
async function openExisting(name: string): Promise<IDBDatabase | undefined> {
  if (!await exists(name)) return undefined
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name) // no version: no upgrade, no schema
    let created = false
    open.onupgradeneeded = () => { created = true; open.transaction?.abort() } // it did not exist after all: leave nothing behind
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => { if (created) { try { indexedDB.deleteDatabase(name) } catch { /* nothing to remove */ } resolve(undefined) } else reject(open.error ?? new Error('Could not open ' + name)) }
    open.onblocked = () => reject(new Error('Stable is busy; close its tabs and try again.'))
  })
}

async function readAll(database: IDBDatabase, store: string): Promise<{ key: IDBValidKey; value: unknown }[]> {
  if (!database.objectStoreNames.contains(store)) return []
  const tx = database.transaction(store, 'readonly')
  const objectStore = tx.objectStore(store)
  const [keys, values] = await Promise.all([request(objectStore.getAllKeys()), request(objectStore.getAll())])
  return keys.map((key, index) => ({ key, value: values[index] }))
}

async function lastRows(database: IDBDatabase, store: string, count: number): Promise<unknown[]> {
  if (!database.objectStoreNames.contains(store)) return []
  const tx = database.transaction(store, 'readonly')
  return new Promise((resolve, reject) => {
    const out: unknown[] = []
    const cursor = tx.objectStore(store).openCursor(null, 'prev')
    cursor.onsuccess = () => { const hit = cursor.result; if (hit && out.length < count) { out.push(hit.value); hit.continue() } else resolve(out) }
    cursor.onerror = () => reject(cursor.error)
  })
}

async function count(database: IDBDatabase, store: string): Promise<number> {
  if (!database.objectStoreNames.contains(store)) return 0
  return request(database.transaction(store, 'readonly').objectStore(store).count())
}

const TIME_FIELDS = ['createdAt', 'updatedAt', 'completedAt', 'addedAt', 'answeredAt', 'reviewedAt', 'lastReview']
const asMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && value > 1e11 && value < 1e14) return value
  if (typeof value === 'string') { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed }
  return undefined
}
const newest = (rows: unknown[], fields: string[]): number | undefined => {
  let best: number | undefined
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    for (const field of fields) { const ms = asMs((row as Record<string, unknown>)[field]); if (ms !== undefined && (best === undefined || ms > best)) best = ms }
  }
  return best
}

/** Stable's own localStorage copy of a profile's backup connection (JSON text), read only; null when there is none. */
export function stableLocalBackupConfig(profileId: string): string | null {
  try { return localStorage.getItem(stable().local.backupConfigPrefix + profileId) } catch { return null }
}

async function describe(database: IDBDatabase, profile: { id: string; name: string; selected: boolean }): Promise<StableProfile> {
  const knowledge = await readAll(database, 'knowledge')
  const isJaKo = (row: unknown) => typeof row === 'object' && row !== null && /^(ja|ko):/.test(String((row as { ref?: unknown }).ref ?? ''))
  const workspace = (await readAll(database, 'preferences')).map(entry => entry.value as { id?: string; name?: string }).find(row => row?.id === 'workspace')?.name
  const times = [
    newest(await lastRows(database, 'journal', 50), ['t']), newest(await lastRows(database, 'exerciseAttempts', 200), TIME_FIELDS),
    newest(knowledge.map(entry => entry.value), TIME_FIELDS), newest(await lastRows(database, 'exerciseSessions', 50), TIME_FIELDS),
  ].filter((time): time is number => time !== undefined)
  return {
    ...profile, ...(workspace ? { workspace } : {}), ...(times.length ? { lastActivity: Math.max(...times) } : {}),
    connections: {
      ai: await count(database, 'aiEndpoints'), speech: await count(database, 'speechConnections'),
      backup: (await count(database, 'backupConfig')) > 0 || stableLocalBackupConfig(profile.id) !== null,
    },
    counts: {
      knowledge: knowledge.length, japaneseKorean: knowledge.filter(entry => isJaKo(entry.value)).length, cards: await count(database, 'studyCards'),
      answers: await count(database, 'exerciseAttempts'), threads: await count(database, 'assistantThreads'), journal: await count(database, 'journal'),
    },
  }
}

/** Stable's profiles that have data, the selected one first. Empty when Stable has never been opened in this browser. */
export async function readStableProfiles(): Promise<StableProfile[]> {
  const names = stable()
  let selectedId = 'default'
  try { selectedId = localStorage.getItem(names.local.selectedProfile) || 'default' } catch { /* no storage */ }
  const registry = await openExisting(names.db.registry)
  let records: { id: string; name: string; state?: string }[] = []
  try {
    if (registry) records = (await readAll(registry, 'profiles')).map(entry => entry.value as { id: string; name: string; state?: string })
  } finally { registry?.close() }
  if (!records.some(record => record.id === 'default')) records.push({ id: 'default', name: 'default' })
  const out: StableProfile[] = []
  for (const record of records) {
    if (record.state && record.state !== 'ready') continue
    const database = await openExisting(names.db.learning(record.id))
    if (!database) continue
    try { out.push(await describe(database, { id: record.id, name: record.name, selected: record.id === selectedId })) } finally { database.close() }
  }
  return out.sort((a, b) => Number(b.selected) - Number(a.selected) || (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
}

/** Every table of one Stable profile's database, with its schema, exactly as stored. */
export async function dumpStableProfile(profileId: string): Promise<RawDump> {
  const name = stable().db.learning(profileId)
  const database = await openExisting(name)
  if (!database) throw new Error('Stable has no data for that profile.')
  try {
    const stores: RawStore[] = []
    const rows: RawDump['rows'] = {}
    const tx = database.transaction([...database.objectStoreNames], 'readonly')
    for (const storeName of database.objectStoreNames) {
      const store = tx.objectStore(storeName)
      stores.push({
        name: storeName, keyPath: store.keyPath as string | string[] | null, autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map(indexName => { const index = store.index(indexName); return { name: indexName, keyPath: index.keyPath as string | string[], unique: index.unique, multiEntry: index.multiEntry } }),
      })
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())])
      rows[storeName] = keys.map((key, index) => ({ key, value: values[index] }))
    }
    return { name, version: database.version, stores, rows }
  } finally { database.close() }
}

/** Stable's device settings, read only: for every localStorage name of the channel except the selected profile and the backup connection keys, Stable's value or null. */
export function readStableSettings(): Record<string, string | null> {
  const { selectedProfile, backupConfigPrefix, ...names } = stable().local
  void selectedProfile; void backupConfigPrefix
  const out: Record<string, string | null> = {}
  for (const [key, name] of Object.entries(names)) { try { out[key] = localStorage.getItem(name) } catch { out[key] = null } }
  return out
}
