import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryBook } from '../library/contracts'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from './codec'
import { LOCAL_PROFILES_HEADER, LOCAL_PROFILES_PATH } from './local-contracts'
import { populatedProfile } from './test-fixtures'

let database: typeof import('../database')
let store: typeof import('./store')
let bootstrap: typeof import('./bootstrap')
const opened: import('dexie').default[] = []
const fetcher = vi.fn<typeof fetch>()
const revision = 'a'.repeat(64)
const book: LibraryBook = {
  id: '77745cb1-f940-48c4-bd1f-3022dcd0d2aa',
  revision: 'a8fc71e1-1c22-4885-9669-6d9f1bebd737',
  title: 'Synthetic book', sourceType: 'paste', chapters: ['Tea'],
  passages: [{
    chapter: 0, source: 'Tea.',
    translation: { blocks: [[{ text: '茶', pinyin: 'chá', meaning: 'tea', trailing: '。' }]], translatedAt: 2 },
  }],
  passage: 0, completed: [0], importedAt: 1, updatedAt: 2,
}
let yaml: string

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function openPage() {
  vi.resetModules()
  database = await import('../database')
  store = await import('./store')
  bootstrap = await import('./bootstrap')
  opened.push(database.db, store.profileRegistry)
  await store.initializeProfiles()
  opened.push(database.db)
  return { database, store, bootstrap }
}

async function rows(target = database.db) {
  return target.transaction('r', target.tables, async () =>
    Object.fromEntries(await Promise.all(target.tables.map(async table => [table.name, await table.toArray()] as const))))
}

beforeEach(async () => {
  vi.resetModules()
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  const Dexie = (await import('dexie')).default
  Dexie.dependencies.indexedDB = factory
  vi.stubEnv('DEV', true)
  vi.stubEnv('DEV_LOCAL_PROFILES', 'true')
  vi.stubEnv('BASE_URL', '/')
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
  localStorage.clear()
  const snapshot = populatedProfile(true)
  snapshot.library = [book]
  yaml = serializeProfileYaml(snapshot)
  await openPage()
})

afterEach(() => {
  for (const connection of opened.splice(0)) connection.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('one-time local default profile bootstrap', () => {
  it('restores an empty default workspace atomically before normal initialization', async () => {
    fetcher.mockResolvedValueOnce(response({ yaml, revision }))
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('imported')
    await database.initializeWorkspace()
    const imported = parseProfileYaml(yaml)
    expect(await database.db.preferences.get('workspace')).toEqual(imported.settings.preferences)
    expect(await database.db.words.toArray()).toEqual(imported.knowledge.words)
    expect(await database.db.characterStates.toArray()).toEqual(imported.knowledge.characterStates)
    const savedBook = await database.db.libraryBooks.get(book.id)
    expect(savedBook).toEqual({ ...book, revision: expect.any(String) })
    expect(savedBook?.revision).not.toBe(book.revision)
    expect(await database.db.assistantThreads.toArray()).toEqual(imported.conversations.threads)
    expect((await database.db.assistantRuns.get('run'))?.status).not.toBe('running')
    expect(await database.db.aiConnections.get('assistant')).toMatchObject(imported.settings.aiConnection!)
    expect(await database.db.speechConnections.get('assistant-speech')).toMatchObject(imported.settings.speechConnection!)
    expect(await database.db.profileState.get('local-settings')).toEqual({ id: 'local-settings', imported: true })
    expect(await store.needsLocalSettingsImport()).toBe(false)
    expect(store.getActiveProfile()).toEqual({ id: 'default', name: 'default' })
    expect(fetcher).toHaveBeenCalledWith(`${LOCAL_PROFILES_PATH}/default`, expect.objectContaining({
      method: 'GET', headers: { [LOCAL_PROFILES_HEADER]: '1' },
      credentials: 'omit', cache: 'no-store', mode: 'same-origin', redirect: 'error',
    }))
  })

  it('allows a missing default file and preserves the subsequently initialized workspace on reload', async () => {
    fetcher.mockResolvedValueOnce(response({ error: 'No local profile file is present.' }, 404))
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('missing')
    expect(Object.values(await rows()).every(value => value.length === 0)).toBe(true)
    await database.initializeWorkspace()
    const before = await rows()
    await openPage()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(await rows()).toEqual(before)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('shares StrictMode reentry and does not repeat a successful import after reload', async () => {
    fetcher.mockResolvedValueOnce(response({ yaml, revision }))
    const first = bootstrap.bootstrapDefaultProfile()
    expect(bootstrap.bootstrapDefaultProfile()).toBe(first)
    await expect(first).resolves.toBe('imported')
    const before = await rows()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('imported')
    await openPage()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(await rows()).toEqual(before)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('never replaces an initialized workspace, even when it only contains untouched preferences', async () => {
    await database.initializeWorkspace()
    const before = await rows()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(await rows()).toEqual(before)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    'words', 'readings', 'lessons', 'sessions', 'attempts',
    'aiConnections', 'speechConnections', 'assistantThreads', 'assistantMessages', 'assistantRuns',
    'knowledge', 'studyCards', 'exerciseSessions', 'exerciseAttempts', 'profileState',
    'mahjongGames', 'characterStates', 'libraryBooks',
  ])('preserves a workspace populated only in %s without fetching private YAML', async tableName => {
    const table = database.db.table(tableName)
    await table.add({ [table.schema.primKey.keyPath as string]: 'existing-browser-record' })
    const before = await rows()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(await rows()).toEqual(before)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves a prior local-settings decision even if the workspace was emptied', async () => {
    await store.markLocalSettingsImported()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('never bootstraps a non-default active profile, even when every table is empty', async () => {
    const other = await store.createProfile('Other learner', false)
    await store.selectProfile(other.id)
    await openPage()
    await database.db.transaction('rw', database.db.tables, async () => {
      for (const table of database.db.tables) await table.clear()
    })
    const before = await rows()
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(store.getActiveProfile().id).toBe(other.id)
    expect(await rows()).toEqual(before)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['production', 'preview', 'remote'])('does not access the local endpoint from %s', async mode => {
    if (mode === 'production') vi.stubEnv('DEV', false)
    if (mode === 'preview') vi.stubEnv('DEV_LOCAL_PROFILES', 'false')
    if (mode === 'remote') vi.stubGlobal('location', new URL('https://example.test/'))
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('skipped')
    expect(fetcher).not.toHaveBeenCalled()
    expect(Object.values(await rows()).every(value => value.length === 0)).toBe(true)
  })

  it.each([
    { yaml: 'invalid: synthetic-private-value', revision },
    { yaml: serializeProfileYaml(createEmptyProfile({ id: '8185cd97-7797-468d-84e2-e4850279bf12', name: 'Other' })), revision },
    { yaml: 'synthetic-private-value', revision: 'invalid' },
  ])('rejects invalid/default-identity-mismatched files without persisting or exposing source (%#)', async value => {
    fetcher.mockResolvedValueOnce(response(value))
    const result = bootstrap.bootstrapDefaultProfile()
    await expect(result).rejects.toThrow('Check that it is valid profile YAML with profile.id: default')
    await expect(result).rejects.not.toThrow('synthetic-private-value')
    expect(Object.values(await rows()).every(value => value.length === 0)).toBe(true)
    fetcher.mockResolvedValueOnce(response({ yaml, revision }))
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('imported')
  })

  it.each([400, 403, 409, 413, 429, 500])('surfaces HTTP %s instead of silently initializing past a failed import', async status => {
    fetcher.mockResolvedValueOnce(response({ error: 'synthetic-private-value' }, status))
    await expect(bootstrap.bootstrapDefaultProfile()).rejects.toThrow('local development server')
    expect(Object.values(await rows()).every(value => value.length === 0)).toBe(true)
  })

  it('surfaces transport failures without exposing their details and allows retry', async () => {
    fetcher.mockRejectedValueOnce(new Error('synthetic-private-transport-value'))
    await expect(bootstrap.bootstrapDefaultProfile()).rejects.toThrow('No browser data was replaced.')
    expect(Object.values(await rows()).every(value => value.length === 0)).toBe(true)
    fetcher.mockResolvedValueOnce(response({ yaml, revision }))
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('imported')
  })

  it('rechecks all tables after fetching so another tab or user action cannot be overwritten', async () => {
    let resolve!: (value: Response) => void
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
    const pending = bootstrap.bootstrapDefaultProfile()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await database.db.characterStates.put({ character: '茶', practiceCompletions: 1, lastPracticedAt: 1 })
    const before = await rows()
    resolve(response({ yaml, revision }))
    await expect(pending).resolves.toBe('skipped')
    expect(await rows()).toEqual(before)
  })

  it('serializes imports from independent pages in one all-table database transaction', async () => {
    const first = { database, store, bootstrap }
    const second = await openPage()
    const resolve: Array<(value: Response) => void> = []
    fetcher.mockImplementation(() => new Promise<Response>(done => { resolve.push(done) }))
    const a = first.bootstrap.bootstrapDefaultProfile()
    const b = second.bootstrap.bootstrapDefaultProfile()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    for (const done of resolve) done(response({ yaml, revision }))
    const results = await Promise.all([a, b])
    expect(results.sort()).toEqual(['imported', 'skipped'])
    expect(await first.database.db.words.toArray()).toEqual(parseProfileYaml(yaml).knowledge.words)
    expect(await rows(first.database.db)).toEqual(await rows(second.database.db))
  })

  it('rolls back every imported table and its marker when persistence fails', async () => {
    fetcher.mockResolvedValueOnce(response({ yaml, revision }))
    const fail = vi.spyOn(database.db.assistantThreads, 'bulkAdd').mockRejectedValueOnce(new Error('synthetic-storage-detail'))
    await expect(bootstrap.bootstrapDefaultProfile()).rejects.toThrow('could not be saved')
    expect(Object.values(await rows()).every(value => value.length === 0)).toBe(true)
    expect(await store.needsLocalSettingsImport()).toBe(true)
    fail.mockRestore()
    fetcher.mockResolvedValueOnce(response({ yaml, revision }))
    await expect(bootstrap.bootstrapDefaultProfile()).resolves.toBe('imported')
  })
})
