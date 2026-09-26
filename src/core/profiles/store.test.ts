import { IDBFactory } from 'fake-indexeddb'
import { stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from './codec'
import { populatedProfile } from './test-fixtures'

let database: typeof import('../database')
let store: typeof import('./store')
let Dexie: typeof import('dexie').default
const opened: import('../database').LearningDatabase[] = []

async function boot() {
  database = await import('../database')
  store = await import('./store')
  Dexie = (await import('dexie')).default
  opened.push(database.db)
  await store.initializeProfiles()
  opened.push(database.db)
  await database.initializeWorkspace()
}

async function reopenPage() {
  vi.resetModules()
  await boot()
}

async function readDatabase(id: string) {
  const other = new database.LearningDatabase(database.profileDatabaseName(id))
  opened.push(other)
  await other.open()
  return other
}

async function allRows(target = database.db) {
  return target.transaction('r', target.tables, async () =>
    Object.fromEntries(await Promise.all(target.tables.map(async table => [table.name, await table.toArray()]))))
}

beforeEach(async () => {
  vi.resetModules()
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  Dexie = (await import('dexie')).default
  Dexie.dependencies.indexedDB = factory
  localStorage.clear()
  await boot()
})

afterEach(() => {
  for (const connection of opened.splice(0)) connection.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isolated named browser profiles', () => {
  it.each([4, 6])('upgrades a v%s workspace in place without changing any learning or credentials', async version => {
    const legacyFactory = new IDBFactory()
    vi.stubGlobal('indexedDB', legacyFactory)
    Dexie.dependencies.indexedDB = legacyFactory
    const legacy = new Dexie('linguaweave-next')
    const newTables = version === 4 ? ['profileState', 'mahjongGames', 'characterStates', 'libraryBooks'] : ['characterStates', 'libraryBooks']
    legacy.version(version).stores(Object.fromEntries(database.db.tables.filter(table => !newTables.includes(table.name)).map(table =>
      [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(', ')])))
    const snapshot = populatedProfile(true)
    const data: Record<string, unknown[]> = {
      preferences: [snapshot.settings.preferences],
      words: snapshot.knowledge.words, readings: snapshot.knowledge.readings, lessons: snapshot.knowledge.lessons,
      sessions: snapshot.knowledge.sessions, attempts: snapshot.knowledge.attempts,
      knowledge: snapshot.knowledge.study.knowledge, studyCards: snapshot.knowledge.study.cards,
      exerciseSessions: snapshot.knowledge.study.sessions, exerciseAttempts: snapshot.knowledge.study.attempts,
      assistantThreads: snapshot.conversations.threads, assistantMessages: snapshot.conversations.messages,
      assistantRuns: snapshot.conversations.runs,
      aiConnections: [{ ...snapshot.settings.aiConnection, id: 'assistant', revision: 'keep-ai-revision', updatedAt: 5 }],
      speechConnections: [{ ...snapshot.settings.speechConnection, id: 'assistant-speech', revision: 'keep-speech-revision', updatedAt: 6 }],
    }
    await legacy.transaction('rw', legacy.tables, async () => {
      for (const [name, rows] of Object.entries(data)) await legacy.table(name).bulkAdd(rows)
    })
    legacy.close()
    await reopenPage()
    expect(database.db.name).toBe('linguaweave-next')
    expect(database.db.verno).toBe(8)
    expect(await database.db.libraryBooks.count()).toBe(0)
    expect(await database.db.characterStates.count()).toBe(0)
    expect(database.db.characterStates.schema.primKey.keyPath).toBe('character')
    expect(store.getActiveProfile()).toEqual({ id: 'default', name: 'default' })
    for (const [name, rows] of Object.entries(data)) {
      const actual = await database.db.table(name).toArray()
      expect(actual).toEqual(expect.arrayContaining(rows))
      expect(actual).toHaveLength(rows.length)
    }
    expect(await store.needsLocalSettingsImport()).toBe(true)
    expect((await database.db.assistantRuns.get('run'))?.status).toBe('running')
  })

  it('registers default against the original database, preserving every existing row and key', async () => {
    await store.restoreActiveProfile(serializeProfileYaml(populatedProfile(true)))
    const before = await allRows()
    const original = database.db
    await reopenPage()
    expect(database.db.name).toBe('linguaweave-next')
    expect(store.getActiveProfile()).toEqual({ id: 'default', name: 'default' })
    expect(await store.listProfiles()).toEqual([{ id: 'default', name: 'default' }])
    expect(await allRows()).toEqual(before)
    expect(await original.aiConnections.get('assistant')).toEqual(await database.db.aiConnections.get('assistant'))
  })

  it('supports idempotent initialization and protects active metadata from callers', async () => {
    const first = store.initializeProfiles()
    expect(store.initializeProfiles()).toBe(first)
    await Promise.all([first, store.initializeProfiles()])
    store.getActiveProfile().name = 'Changed outside the store'
    expect(store.getActiveProfile().name).toBe('default')
    expect(await store.listProfiles()).toHaveLength(1)
  })

  it('supports explicit test cleanup without a production database-rebinding escape hatch', async () => {
    await store.markLocalSettingsImported()
    await store.profileRegistry.delete()
    await database.db.delete()
    store.resetSelectedProfile()
    store.resetProfilesForTests()
    expect(() => store.getActiveProfile()).toThrow('not been initialized')
    await store.initializeProfiles()
    await database.initializeWorkspace()
    expect(store.getActiveProfile()).toEqual({ id: 'default', name: 'default' })
    expect(await store.needsLocalSettingsImport()).toBe(true)
    vi.stubEnv('MODE', 'production')
    try {
      expect(() => store.resetProfilesForTests()).toThrow('only available in tests')
      expect(() => database.resetDatabaseForTests()).toThrow('only available in tests')
    } finally { vi.unstubAllEnvs() }
  })

  it('creates fresh profiles without inherited data or keys and selects only on reload', async () => {
    await store.restoreActiveProfile(serializeProfileYaml(populatedProfile()))
    const before = await allRows()
    const activeDb = database.db
    const profile = await store.createProfile('  Fresh  ', false)
    expect(profile.name).toBe('Fresh')
    const fresh = await readDatabase(profile.id)
    expect(await fresh.preferences.get('workspace')).toEqual(createEmptyProfile(profile).settings.preferences)
    for (const table of fresh.tables.filter(table => !['preferences', 'profileState'].includes(table.name))) {
      expect(await table.count()).toBe(0)
    }
    await store.selectProfile(profile.id)
    expect(database.db).toBe(activeDb)
    expect(store.getActiveProfile().id).toBe('default')
    expect(await allRows()).toEqual(before)
    await reopenPage()
    expect(store.getActiveProfile()).toEqual(profile)
    expect(database.db.name).toBe(database.profileDatabaseName(profile.id))
    expect(await database.db.aiConnections.count()).toBe(0)
    expect(await store.needsLocalSettingsImport()).toBe(false)
    expect(() => database.configureDatabaseForProfile('default')).toThrow('Reload')
  })

  it('clones all validated data and credentials but interrupts the clone, never its source', async () => {
    const running = populatedProfile(true)
    await store.restoreActiveProfile(serializeProfileYaml(running))
    await database.db.assistantRuns.put(running.conversations.runs[0])
    await database.db.assistantMessages.put(running.conversations.messages[1])
    const before = await allRows()
    const profile = await store.createProfile('Copy', true)
    const clone = await readDatabase(profile.id)
    expect(await clone.aiConnections.get('assistant')).toMatchObject(running.settings.aiConnection!)
    expect(await clone.speechConnections.get('assistant-speech')).toMatchObject(running.settings.speechConnection!)
    expect((await clone.aiConnections.get('assistant'))?.revision).not.toBe((await database.db.aiConnections.get('assistant'))?.revision)
    for (const name of ['preferences', 'words', 'readings', 'lessons', 'sessions', 'attempts',
      'knowledge', 'studyCards', 'exerciseSessions', 'exerciseAttempts', 'assistantThreads', 'characterStates']) {
      expect(await clone.table(name).toArray()).toEqual(before[name])
    }
    expect((await clone.assistantRuns.get('run'))?.status).toBe('interrupted')
    expect((await clone.assistantMessages.get('reply'))?.status).toBe('failed')
    expect(await allRows()).toEqual(before)
  })

  it('never redirects late writes when this or another tab changes the stored selection', async () => {
    const profile = await store.createProfile('Other tab', false)
    const live = database.db
    const delayedWrite = async () => {
      await Promise.resolve()
      await database.db.preferences.update('workspace', { name: 'Late write to default' })
    }
    localStorage.setItem(store.SELECTED_PROFILE_KEY, profile.id)
    await store.initializeProfiles()
    await delayedWrite()
    await store.selectProfile(profile.id)
    await delayedWrite()
    expect(database.db).toBe(live)
    expect(store.getActiveProfile().id).toBe('default')
    expect((await live.preferences.get('workspace'))?.name).toBe('Late write to default')
    const other = await readDatabase(profile.id)
    expect((await other.preferences.get('workspace'))?.name).toBe('Your workspace')
  })

  it('keeps manual additions and writing history profile-local across selection, reload, and empty restore', async () => {
    let characters = await import('../characters/store')
    await characters.addCharacterToKnowledge('茶')
    await characters.recordCharacterPractice('茶')
    const original = await database.loadWorkspace()
    const profile = await store.createProfile('Writing profile', false)
    await store.selectProfile(profile.id)
    await characters.recordCharacterPractice('茶')
    expect((await database.db.characterStates.get('茶'))?.practiceCompletions).toBe(2)
    await reopenPage()
    characters = await import('../characters/store')
    expect((await database.loadWorkspace()).characterStates).toEqual([])
    await characters.recordCharacterPractice('茶')
    await characters.addCharacterToKnowledge('𠀀')
    const exported = parseProfileYaml(await store.exportActiveProfile())
    expect(exported.knowledge.characterStates).toEqual([
      { character: '茶', practiceCompletions: 1, lastPracticedAt: expect.any(Number) },
      { character: '𠀀', manualAddedAt: expect.any(Number), practiceCompletions: 0 },
    ])
    await store.restoreActiveProfile(serializeProfileYaml(createEmptyProfile(profile)))
    expect((await database.loadWorkspace()).characterStates).toEqual([])
    const source = await readDatabase('default')
    expect(await source.characterStates.get('茶')).toEqual({
      ...original.characterStates[0], practiceCompletions: 2, lastPracticedAt: expect.any(Number),
    })
    expect(await source.characterStates.get('𠀀')).toBeUndefined()
  })

  it('exports all profile domains and credentials in one read transaction', async () => {
    await store.restoreActiveProfile(serializeProfileYaml(populatedProfile()))
    const reads: string[][] = []
    for (const name of ['preferences', 'aiConnections', 'speechConnections']) {
      database.db.table(name).hook('reading', value => {
        reads.push([...Dexie.currentTransaction!.storeNames])
        return value
      })
    }
    const text = await store.exportActiveProfile()
    expect(text).toContain('lb: starter-cha2--tea')
    expect(text).not.toContain('wordId:')
    expect(reads).toHaveLength(3)
    for (const tables of reads) expect(tables).toEqual(database.db.tables.map(table => table.name))
    const exported = parseProfileYaml(text)
    expect(exported.settings.aiConnection?.apiKey).toBe('synthetic-ai-key')
    expect(exported.settings.speechConnection?.apiKey).toBe('synthetic-speech-key')
    expect(exported.knowledge).toEqual(populatedProfile().knowledge)
    expect(exported.conversations).toEqual({
      ...populatedProfile().conversations,
      messages: [...populatedProfile().conversations.messages].sort((a, b) => a.id.localeCompare(b.id)),
    })
  })

  it('restores older ID-based YAML and re-exports labels without migrating database identities', async () => {
    const snapshot = populatedProfile()
    await store.restoreActiveProfile(stringify({ ...snapshot, version: 1 }, { aliasDuplicateObjects: false }))
    const before = await allRows()
    const yaml = await store.exportActiveProfile()
    expect(yaml).toContain('lb: starter-cha2--tea')
    expect(yaml).not.toContain('wordId:')
    expect(await allRows()).toEqual(before)
    await store.restoreActiveProfile(yaml)
    for (const table of ['words', 'sessions', 'attempts', 'knowledge', 'studyCards', 'exerciseSessions', 'exerciseAttempts', 'assistantThreads', 'assistantMessages', 'characterStates']) {
      expect(await database.db.table(table).toArray()).toEqual(before[table])
    }
    expect((await database.db.words.toArray())[0].wordId).toBe('zh:tea')
    expect((await database.db.sessions.toArray())[0].id).toBe('legacy-session')
  })

  it('replaces every section and connection atomically while retaining the active identity', async () => {
    await store.restoreActiveProfile(serializeProfileYaml(populatedProfile()))
    expect(await store.needsLocalSettingsImport()).toBe(false)
    const empty = createEmptyProfile({ id: crypto.randomUUID(), name: 'Other identity' })
    await store.restoreActiveProfile(serializeProfileYaml(empty))
    expect(store.getActiveProfile()).toEqual({ id: 'default', name: 'default' })
    const exported = parseProfileYaml(await store.exportActiveProfile())
    expect(exported).toEqual({ ...empty, profile: store.getActiveProfile(), exportedAt: exported.exportedAt })
    expect(await database.db.aiConnections.count()).toBe(0)
    expect(await database.db.speechConnections.count()).toBe(0)
  })

  it('rolls back every section, credentials, and bootstrap marker on transaction failure', async () => {
    const before = await allRows()
    expect(await store.needsLocalSettingsImport()).toBe(true)
    vi.spyOn(database.db.assistantMessages, 'bulkAdd').mockRejectedValueOnce(new Error('Synthetic failed write'))
    await expect(store.restoreActiveProfile(serializeProfileYaml(populatedProfile()))).rejects.toThrow('Synthetic failed write')
    expect(await allRows()).toEqual(before)
    expect(await store.needsLocalSettingsImport()).toBe(true)
  })

  it('rolls back cleared and rewritten credentials when an existing profile restore fails', async () => {
    await store.restoreActiveProfile(serializeProfileYaml(populatedProfile()))
    const before = await allRows()
    vi.spyOn(database.db.assistantRuns, 'bulkAdd').mockRejectedValueOnce(new Error('Synthetic final write failure'))
    await expect(store.restoreActiveProfile(serializeProfileYaml(createEmptyProfile({ id: 'default', name: 'Empty' }))))
      .rejects.toThrow('Synthetic final write failure')
    expect(await allRows()).toEqual(before)
  })

  it('validates a complete import before performing any writes', async () => {
    await store.restoreActiveProfile(serializeProfileYaml(populatedProfile()))
    const before = await allRows()
    const corrupted = populatedProfile()
    corrupted.conversations.threads = []
    await expect(store.restoreActiveProfile(JSON.stringify(corrupted))).rejects.toThrow('Invalid profile YAML')
    expect(await allRows()).toEqual(before)
  })

  it('aborts an in-flight restore transaction without leaving any partial replacement', async () => {
    const before = await allRows()
    const controller = new AbortController()
    const original = database.db.aiConnections.add.bind(database.db.aiConnections)
    vi.spyOn(database.db.aiConnections, 'add').mockImplementation(connection => original(connection).then(result => {
      controller.abort()
      return result
    }))
    await expect(store.restoreActiveProfile(serializeProfileYaml(populatedProfile()), controller.signal)).rejects.toThrow()
    expect(await allRows()).toEqual(before)
  })

  it('does not persist a cancelled profile selection', async () => {
    const profile = await store.createProfile('Selection', false)
    const controller = new AbortController()
    controller.abort()
    await expect(store.selectProfile(profile.id, controller.signal)).rejects.toThrow()
    expect(localStorage.getItem(store.SELECTED_PROFILE_KEY)).toBeNull()
  })

  it('imports as a new ID/name without modifying the source or selected profile', async () => {
    const before = await allRows()
    const imported = await store.importNewProfile(serializeProfileYaml(populatedProfile()), 'Imported')
    expect(imported.id).not.toBe('default')
    expect(imported.name).toBe('Imported')
    const other = await readDatabase(imported.id)
    expect(await other.words.count()).toBe(1)
    expect(await other.characterStates.toArray()).toEqual(populatedProfile().knowledge.characterStates)
    expect((await other.aiConnections.get('assistant'))?.apiKey).toBe('synthetic-ai-key')
    expect(await allRows()).toEqual(before)
    expect(store.getActiveProfile().id).toBe('default')
  })

  it('enforces normalized case-insensitive uniqueness during concurrent creation', async () => {
    const outcomes = await Promise.allSettled([store.createProfile(' Same ', false), store.createProfile('ＳＡＭＥ', false)])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failure = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason.message).toContain('already exists')
    expect(await store.listProfiles()).toHaveLength(2)
    await expect(store.createProfile('DEFAULT', false)).rejects.toThrow('already exists')
    expect((await Dexie.getDatabaseNames()).filter(name => name.startsWith('linguaweave-next-profile-'))).toHaveLength(1)
  })

  it('cleans only its own newly created database and reservation after a creation failure', async () => {
    const retained = await store.createProfile('Retained', false)
    const before = await allRows()
    const original = database.LearningDatabase.prototype.transaction
    const failure = vi.spyOn(database.LearningDatabase.prototype, 'transaction').mockImplementation(function (this: import('../database').LearningDatabase, ...args: unknown[]) {
      if (this.name.startsWith('linguaweave-next-profile-')) return Promise.reject(new Error('Synthetic storage failure'))
      return original.apply(this, args as Parameters<typeof original>)
    } as typeof original)
    await expect(store.createProfile('Retry', false)).rejects.toThrow('Synthetic storage failure')
    failure.mockRestore()
    expect(await store.listProfiles()).toHaveLength(2)
    expect(await Dexie.exists(database.profileDatabaseName(retained.id))).toBe(true)
    expect(await allRows()).toEqual(before)
    expect((await Dexie.getDatabaseNames()).filter(name => name.startsWith('linguaweave-next-profile-'))).toHaveLength(1)
    await expect(store.createProfile('Retry', false)).resolves.toMatchObject({ name: 'Retry' })
  })

  it('does not overwrite or delete an existing database on a generated-ID collision', async () => {
    const id = 'ed7ecfca-0c3a-46a5-9a23-4ea2344e2680'
    const existing = await readDatabase(id)
    await existing.preferences.add({ ...createEmptyProfile({ id, name: 'Existing' }).settings.preferences, name: 'Do not overwrite' })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(id)
    await expect(store.createProfile('Collision', false)).rejects.toThrow('already exists')
    expect((await existing.preferences.get('workspace'))?.name).toBe('Do not overwrite')
    expect(await store.listProfiles()).toHaveLength(1)
  })

  it('keeps one-time settings bootstrap markers profile-local and persistent', async () => {
    expect(await store.needsLocalSettingsImport()).toBe(true)
    expect((await store.profileRegistry.profiles.get('default'))?.localSettingsImported).toBe(false)
    await store.markLocalSettingsImported()
    expect(await store.needsLocalSettingsImport()).toBe(false)
    expect((await store.profileRegistry.profiles.get('default'))?.localSettingsImported).toBe(true)
    await reopenPage()
    expect(await store.needsLocalSettingsImport()).toBe(false)
    const fresh = await store.createProfile('No bootstrap', false)
    expect((await store.profileRegistry.profiles.get(fresh.id))?.localSettingsImported).toBe(true)
    await store.selectProfile(fresh.id)
    await reopenPage()
    expect(await store.needsLocalSettingsImport()).toBe(false)
  })

  it('leaves a failed bootstrap marker pending so it can be retried on reload', async () => {
    expect(await store.needsLocalSettingsImport()).toBe(true)
    vi.spyOn(store.profileRegistry.profiles, 'update').mockRejectedValueOnce(new Error('Synthetic failed registry write'))
    await expect(store.markLocalSettingsImported()).rejects.toThrow('Synthetic failed registry write')
    expect(await store.needsLocalSettingsImport()).toBe(true)
    await reopenPage()
    expect(await store.needsLocalSettingsImport()).toBe(true)
  })

  it('reports browser storage errors, invalid selections, and allows explicit startup recovery', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic quota failure') })
    await expect(store.selectProfile('default')).rejects.toThrow('could not be saved')
    vi.restoreAllMocks()
    localStorage.setItem(store.SELECTED_PROFILE_KEY, '../bad')
    vi.resetModules()
    store = await import('./store')
    await expect(store.initializeProfiles()).rejects.toThrow('invalid')
    store.resetSelectedProfile()
    await store.initializeProfiles()
    expect(store.getActiveProfile().id).toBe('default')
  })

  it('fails rather than silently falling back when a saved profile is missing', async () => {
    localStorage.setItem(store.SELECTED_PROFILE_KEY, crypto.randomUUID())
    vi.resetModules()
    store = await import('./store')
    await expect(store.initializeProfiles()).rejects.toThrow('unavailable')
  })

  it('rejects a registry entry whose database is missing, rather than recreating empty data', async () => {
    const profile = await store.createProfile('Lost storage', false)
    await store.selectProfile(profile.id)
    await Dexie.delete(database.profileDatabaseName(profile.id))
    vi.resetModules()
    store = await import('./store')
    await expect(store.initializeProfiles()).rejects.toThrow('database is unavailable')
  })

  it('reports unavailable browser or IndexedDB APIs', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.resetModules()
    const unavailable = await import('./store')
    await expect(unavailable.initializeProfiles()).rejects.toThrow('IndexedDB')
  })

  it('reports denied localStorage reads without exposing exception contents', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('synthetic-secret') })
    vi.resetModules()
    const unavailable = await import('./store')
    await expect(unavailable.initializeProfiles()).rejects.toThrow('could not be read')
    await expect(unavailable.initializeProfiles()).rejects.not.toThrow('synthetic-secret')
  })
})
