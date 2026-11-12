// One-way copy of a Stable profile into Lab's current profile.
//
// The Stable side is read by stable-copy.ts (raw, read-only, no schema). Here the rows are staged into a scratch database of Lab's
// own at Stable's schema version and opened with Lab's schema class, so Lab's migrations run on Lab's copy; then every table is
// copied into the active Lab profile. Nothing in this file touches a Stable-named database.

import { db, LearningDatabase } from '../database'
import { clearUnsavedDrafts } from '../assistant/drafts'
import { clearProfileBackupState } from '../backup/state'
import { getPack } from '../language'
import { storageNames, type StableCopy } from '../storage-names'
import { getActiveProfile, initializeProfiles } from './store'
import { dumpStableProfile, readStableSettings, stableLocalBackupConfig, type RawDump } from './stable-copy'

export interface CopyResult { tables: Record<string, number>; skipped: string[]; settings: number }
export interface CopyDeps {
  /** How the staged copy is opened (and so migrated). Tests pass a class whose schema version is one higher. */
  openMigrated?: (name: string) => LearningDatabase
}

/** What a settings-only copy brings (Lab Japanese and Korean): the AI connections and endpoints, the speech connection and the backup connection. Never a table of learning. */
export const SETTINGS_TABLES: ReadonlySet<string> = new Set(['aiConnections', 'aiEndpoints', 'speechConnections', 'backupConfig'])

/**
 * The device settings (localStorage) a settings-only copy brings, decided key by key. Brought: how many new items and reviews a practice has
 * (newItems, legacyNewItems, reviewCount), listening aloud as soon as an item shows (autoListen), the AI engine presets (customPresets) and the
 * media translation pacing (mediaChunk, mediaConcurrency, mediaPause): none is about one language's learning. Left to the build: unwrittenSize,
 * writeDrill and handwritingEngine (writing Chinese characters), handsfree (which of its skills and which phrases a language has) and mediaGlosses (glosses in the language's own script).
 */
export const SETTINGS_DEVICE_KEYS: readonly string[] = ['newItems', 'legacyNewItems', 'reviewCount', 'autoListen', 'customPresets', 'mediaChunk', 'mediaConcurrency', 'mediaPause']

/** The backup connection is copied, the backup state is not: the build starts fresh and backs up into its own folder. */
const connectionOnly = (row: unknown): unknown => {
  const { lastBackupAt, lastError, lastCommit, ...rest } = row as Record<string, unknown>
  void lastBackupAt; void lastError; void lastCommit
  return rest
}

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
function copyDeviceSettings(mode: StableCopy): number {
  const lab = storageNames().local as unknown as Record<string, string>
  let copied = 0
  for (const [key, value] of Object.entries(readStableSettings())) {
    if (mode === 'settings' && !SETTINGS_DEVICE_KEYS.includes(key)) continue
    if (value === null) localStorage.removeItem(lab[key])
    else { localStorage.setItem(lab[key], value); copied++ }
  }
  return copied
}

/** The backup connection's own copy in localStorage (as loadBackupConfig reads it), written without any backup state. */
async function copyBackupConnectionLocal(stableProfileId: string, copiedRow: Record<string, unknown> | undefined): Promise<void> {
  let plain: Record<string, unknown> | undefined = copiedRow && connectionOnly(copiedRow) as Record<string, unknown>
  if (plain) delete plain.id
  if (!plain) { // Stable kept its connection only in localStorage
    const text = stableLocalBackupConfig(stableProfileId)
    if (text === null) return
    try { plain = connectionOnly(JSON.parse(text)) as Record<string, unknown> } catch { return }
    await db.backupConfig.put({ id: 'github', ...plain } as never)
  }
  try { localStorage.setItem(storageNames().local.backupConfigPrefix + getActiveProfile().id, JSON.stringify(plain)) } catch { /* no storage */ }
}

/**
 * Copies one Stable profile into the active Lab profile, as much as this build copies (storageNames().stableCopy): 'profile' replaces the whole
 * profile (every table, and the device settings); 'settings' replaces only the connections (SETTINGS_TABLES) and the device settings of
 * SETTINGS_DEVICE_KEYS, and leaves every learning row alone. The backup connection (repository, branch, token) comes with either; the backup
 * state never does. Call it only after the learner confirmed.
 */
export async function copyStableProfile(stableProfileId: string, deps: CopyDeps = {}): Promise<CopyResult> {
  const mode = storageNames().stableCopy
  if (!mode) throw new Error('This build does not copy from Stable.')
  await initializeProfiles()
  const dump = await dumpStableProfile(stableProfileId)
  const scratchName = storageNames().labOnly.importScratch(crypto.randomUUID())
  const scratch = (deps.openMigrated ?? (name => new LearningDatabase(name)))(scratchName)
  const copies = (name: string) => mode === 'profile' || SETTINGS_TABLES.has(name)
  try {
    await stage(dump, scratchName)
    await scratch.open() // Lab's own migrations run here, on the copy
    const incoming = new Map<string, { value: unknown; key?: IDBValidKey }[]>()
    for (const table of scratch.tables) {
      if (!copies(table.name)) continue
      const outbound = table.schema.primKey.keyPath === undefined || table.schema.primKey.keyPath === null
      const values = await table.toArray()
      const keys = outbound ? await table.toCollection().primaryKeys() : []
      incoming.set(table.name, values.map((value, index) => ({ value: table.name === 'backupConfig' ? connectionOnly(value) : value, ...(outbound ? { key: keys[index] as IDBValidKey } : {}) })))
    }
    const tables: Record<string, number> = {}
    const skipped = [...incoming.keys()].filter(name => !db.tables.some(table => table.name === name))
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        if (!copies(table.name)) continue
        const rows = incoming.get(table.name) ?? []
        // A Stable with no saved backup connection leaves this build's own connection alone.
        if (table.name === 'backupConfig' && !rows.length) continue
        await table.clear()
        if (rows.length) {
          if (rows[0].key !== undefined) await table.bulkAdd(rows.map(row => row.value), rows.map(row => row.key) as never)
          else await table.bulkAdd(rows.map(row => row.value))
        }
        tables[table.name] = rows.length
      }
    })
    const settings = copyDeviceSettings(mode) // after the table transaction succeeded, before the caller reloads
    await copyBackupConnectionLocal(stableProfileId, incoming.get('backupConfig')?.find(row => (row.value as { id?: string }).id === 'github')?.value as Record<string, unknown> | undefined)
    await clearProfileBackupState(getActiveProfile().id)
    if (mode === 'profile') clearUnsavedDrafts()
    return { tables, skipped, settings }
  } finally {
    scratch.close()
    await LearningDatabase.delete(scratchName).catch(() => undefined)
  }
}

/** What the learner would lose: the active Lab profile's name and counts, for the confirmation. */
export async function describeLabProfile() {
  await initializeProfiles()
  const [knowledge, cards, answers, threads] = await Promise.all([db.knowledge.filter(entry => getPack().ownsRef(entry.ref)).count(), db.studyCards.filter(card => getPack().ownsRef(card.ref)).count(), db.exerciseAttempts.count(), db.assistantThreads.count()])
  return { name: getActiveProfile().name, counts: { knowledge, cards, answers, threads } }
}

/** True when the active Lab profile has nothing the learner did: the moment the first-visit offer makes sense. */
export async function labProfileIsEmpty(): Promise<boolean> {
  const { counts } = await describeLabProfile()
  return counts.knowledge === 0 && counts.answers === 0 && await db.journal.count() === 0
}
