// One-way copy of a Stable profile into Lab's current profile.
//
// The Stable side is read by stable-copy.ts (raw, read-only, no schema). Here the rows are staged into a scratch database of Lab's
// own at Stable's schema version and opened with Lab's schema class, so Lab's migrations run on Lab's copy; then every table is
// copied into the active Lab profile. Nothing in this file touches a Stable-named database.

import { db, LearningDatabase } from '../database'
import { clearUnsavedDrafts } from '../assistant/drafts'
import { clearProfileBackupState } from '../backup/state'
import { storageNames } from '../storage-names'
import { getActiveProfile, initializeProfiles } from './store'
import { dumpStableProfile, readStableSettings, type RawDump } from './stable-copy'

export interface CopyResult { tables: Record<string, number>; skipped: string[]; settings: number }
export interface CopyDeps {
  /** How the staged copy is opened (and so migrated). Tests pass a class whose schema version is one higher. */
  openMigrated?: (name: string) => LearningDatabase
}

/** Tables that belong to this Lab install, not to the learner's data: the backup connection stays Lab's own. */
const KEEP_LAB_TABLES = new Set(['backupConfig'])

function stage(dump: RawDump, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, dump.version)
    open.onupgradeneeded = () => {
      const database = open.result
      for (const store of dump.stores) {
        const created = database.createObjectStore(store.name, { ...(store.keyPath !== null ? { keyPath: store.keyPath } : {}), autoIncrement: store.autoIncrement })
        for (const index of store.indexes) created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry })
      }
    }
    open.onerror = () => reject(open.error ?? new Error('Could not stage the copy.'))
    open.onsuccess = () => {
      const database = open.result
      const tx = database.transaction(dump.stores.map(store => store.name), 'readwrite')
      for (const store of dump.stores) {
        const target = tx.objectStore(store.name)
        for (const row of dump.rows[store.name] ?? []) { if (store.keyPath === null) target.put(row.value, row.key); else target.put(row.value) }
      }
      tx.oncomplete = () => { database.close(); resolve() }
      tx.onerror = () => { database.close(); reject(tx.error ?? new Error('Could not stage the copy.')) }
      tx.onabort = () => { database.close(); reject(tx.error ?? new Error('Could not stage the copy.')) }
    }
  })
}

/** Lab's localStorage ends up equal to Stable's for the copied names: Stable's value (read by stable-copy.ts) is set; none there means Lab's key is removed. */
function copyDeviceSettings(): number {
  const lab = storageNames().local as unknown as Record<string, string>
  let copied = 0
  for (const [key, value] of Object.entries(readStableSettings())) {
    if (value === null) localStorage.removeItem(lab[key])
    else { localStorage.setItem(lab[key], value); copied++ }
  }
  return copied
}

/** Replaces the active Lab profile's data with a copy of one Stable profile. Call it only after the learner confirmed. */
export async function copyStableProfile(stableProfileId: string, deps: CopyDeps = {}): Promise<CopyResult> {
  await initializeProfiles()
  const dump = await dumpStableProfile(stableProfileId)
  const scratchName = storageNames().labOnly.importScratch(crypto.randomUUID())
  const scratch = (deps.openMigrated ?? (name => new LearningDatabase(name)))(scratchName)
  try {
    await stage(dump, scratchName)
    await scratch.open() // Lab's own migrations run here, on the copy
    const incoming = new Map<string, { value: unknown; key?: IDBValidKey }[]>()
    for (const table of scratch.tables) {
      if (KEEP_LAB_TABLES.has(table.name)) continue
      const outbound = table.schema.primKey.keyPath === undefined || table.schema.primKey.keyPath === null
      const values = await table.toArray()
      const keys = outbound ? await table.toCollection().primaryKeys() : []
      incoming.set(table.name, values.map((value, index) => ({ value, ...(outbound ? { key: keys[index] as IDBValidKey } : {}) })))
    }
    const tables: Record<string, number> = {}
    const skipped = [...incoming.keys()].filter(name => !db.tables.some(table => table.name === name))
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        if (KEEP_LAB_TABLES.has(table.name)) continue
        await table.clear()
        const rows = incoming.get(table.name) ?? []
        if (rows.length) {
          if (rows[0].key !== undefined) await table.bulkAdd(rows.map(row => row.value), rows.map(row => row.key) as never)
          else await table.bulkAdd(rows.map(row => row.value))
        }
        tables[table.name] = rows.length
      }
    })
    const settings = copyDeviceSettings() // after the table transaction succeeded, before the caller reloads
    await clearProfileBackupState(getActiveProfile().id)
    clearUnsavedDrafts()
    return { tables, skipped, settings }
  } finally {
    scratch.close()
    await LearningDatabase.delete(scratchName).catch(() => undefined)
  }
}

/** What the learner would lose: the active Lab profile's name and counts, for the confirmation. */
export async function describeLabProfile() {
  await initializeProfiles()
  const [knowledge, cards, answers, threads] = await Promise.all([db.knowledge.count(), db.studyCards.count(), db.exerciseAttempts.count(), db.assistantThreads.count()])
  return { name: getActiveProfile().name, counts: { knowledge, cards, answers, threads } }
}

/** True when the active Lab profile has nothing the learner did: the moment the first-visit offer makes sense. */
export async function labProfileIsEmpty(): Promise<boolean> {
  const { counts } = await describeLabProfile()
  return counts.knowledge === 0 && counts.answers === 0 && await db.journal.count() === 0
}
