import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import { setBuildChannelForTests, storageNames, type BuildChannel } from '../core/storage-names'

/** A fresh copy of the app's modules, built for one channel: its names come from the module, so one process can play Stable and then Lab. */
export async function loadBuild(channel: BuildChannel) {
  setBuildChannelForTests(channel)
  vi.resetModules()
  const [database, store, knowledge, importer, state, run, github, service, daily, copy] = await Promise.all([
    import('../core/database'), import('../core/profiles/store'), import('../core/study/knowledge'),
    import('../core/profiles/stable-import'), import('../core/backup/state'), import('../core/backup/run'), import('../core/backup/github'),
    import('../core/backup/service'), import('../core/study/daily'), import('../core/profiles/stable-copy'),
  ])
  return { channel, names: storageNames(channel), database, store, knowledge, importer, state, run, github, service, daily, copy, close: () => { store.resetProfilesForTests(); state.backupStateDb().close() } }
}
export type Build = Awaited<ReturnType<typeof loadBuild>>

export const isLabName = (name: string) => name.startsWith('lab.')

/** Everything Stable owns in this browser, read raw (no schema, read-only): databases with versions and a hash of every table, storage, caches. */
export async function snapshotStable(fakeCaches: Map<string, unknown>) {
  const out: { databases: Record<string, { version: number; tables: Record<string, string> }>; localStorage: Record<string, string>; sessionStorage: Record<string, string>; caches: string[] } = { databases: {}, localStorage: {}, sessionStorage: {}, caches: [...fakeCaches.keys()].sort() }
  const list = await indexedDB.databases()
  for (const info of list.filter(entry => entry.name && !isLabName(entry.name))) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open(info.name!); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error) })
    const tables: Record<string, string> = {}
    for (const name of database.objectStoreNames) {
      const store = database.transaction(name, 'readonly').objectStore(name)
      const rows = await new Promise<unknown[]>(resolve => { const request = store.getAll(); request.onsuccess = () => resolve(request.result) })
      tables[name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex') + ':' + rows.length
    }
    out.databases[info.name!] = { version: database.version, tables }
    database.close()
  }
  for (const [storage, target] of [[localStorage, out.localStorage], [sessionStorage, out.sessionStorage]] as const) {
    for (let i = 0; i < storage.length; i++) { const key = storage.key(i)!; if (!isLabName(key)) target[key] = storage.getItem(key)! }
  }
  return out
}
