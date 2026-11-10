import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { loadWorkspace } from '../database'
import { dueCards } from '../study/knowledge'
import { loadBackupVersion, applyBackup } from '../backup/service'
import { getActiveProfile, initializeProfiles, exportActiveProfile, restoreActiveProfile } from './store'
import { resetBackupStateForTests, saveCache } from '../backup/state'
import { runBackup, saveBackupConfig, setBackendFactoryForTests, readBackupStatus, type BackupConfig } from '../backup/service'
import type { BackupBackend, DeltaResult, RemoteState } from '../backup/backend'

const config: BackupConfig = { owner: 'me', repo: 'backups', token: 'tok', branch: 'main' }
const T0 = 1_790_000_000_000

function memoryBackend() {
  const versions: Map<string, string>[] = []
  const backend: BackupBackend = {
    listProfiles: async () => [], listVersions: async () => [],
    readFiles: async () => new Map(versions.at(-1)!),
    publish: async () => { throw new Error('unused') },
    publishDelta: async (_profile, files, keep): Promise<DeltaResult> => {
      const last = versions.at(-1)
      const next = new Map(files)
      for (const path of keep) { const text = last?.get(path); if (text === undefined) throw Object.assign(new Error('missing ' + path), { name: 'StaleBackupError' }); next.set(path, text) }
      versions.push(next)
      const remote: RemoteState = { head: 'v' + versions.length, tree: 't', files: Object.fromEntries([...next].map(([path, text]) => [path, String(text.length)])) }
      return { version: 'v' + versions.length, changed: next.size, removed: 0, remote, calls: [] }
    },
  }
  return { backend, versions }
}

const entry = (ref: string, kind: 'vocabulary' | 'grammar', lb: string, at: number) => ({ ref, kind, lb, band: '1' as const, addedAt: at, source: 'new' as const })
const card = (ref: string, at: number) => ({ id: ref + ':reading', ref, domain: 'reading' as const, due: at, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new' as const, updatedAt: at })

export const languageRefs = ['ja:w:taberu--eat', 'ko:g:ko-g-001', 'ja:f:くる:masu']
export const languageRows = () => languageRefs.map((ref, index) => entry(ref, ref.includes(':g:') ? 'grammar' : 'vocabulary', ref.split(':').slice(2).join(':'), T0 + index))

/** What the tracks left in storage next to one Chinese word: knowledge rows, cards and journal events, written as main wrote them. */
export async function seedMixed() {
  const zh = entry('vocabulary:wo3--me', 'vocabulary', 'wo3--me', T0)
  await db.knowledge.bulkPut([zh, ...languageRows()])
  await db.studyCards.bulkPut([card(zh.ref, T0), ...languageRefs.map((ref, index) => card(ref, T0 + index))])
  let seq = 0
  await db.journal.bulkAdd([zh, ...languageRows()].map(row => ({ seq: ++seq, t: new Date(row.addedAt).toISOString(), op: 'add' as const, ref: row.ref, band: 1, source: 'new' })) as never)
}

beforeEach(async () => {
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
})
afterEach(() => setBackendFactoryForTests(undefined))

describe('reproduction: Back up now with Japanese and Korean rows in storage', () => {
  it('makes a backup on top of a cache main left (its state holds the language rows)', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await seedMixed()
    await runBackup()
    const { getActiveProfile } = await import('./store')
    const { loadCache } = await import('../backup/state')
    const cache = (await loadCache(getActiveProfile().id))!
    await saveCache(getActiveProfile().id, { ...cache, state: { ...cache.state, knowledge: [...cache.state.knowledge, ...languageRows()], cards: [...cache.state.cards, ...languageRefs.map(ref => card(ref, T0))] } })
    await db.journal.add({ t: new Date(T0 + 9).toISOString(), op: 'add', ref: 'vocabulary:shi4--identity', band: 1, source: 'new' } as never)
    await runBackup()
    expect((await readBackupStatus()).lastError).toBeUndefined()
  })

  it('makes a backup', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await seedMixed()
    await runBackup()
    // the second press, with the cache the first one saved
    await db.knowledge.put({ ref: 'vocabulary:shi4--identity', kind: 'vocabulary', lb: 'shi4--identity', band: '1', addedAt: T0 + 9, source: 'new' })
    await db.journal.add({ t: new Date(T0 + 9).toISOString(), op: 'add', ref: 'vocabulary:shi4--identity', band: 1, source: 'new' } as never)
    await runBackup()
    expect((await readBackupStatus()).lastError).toBeUndefined()
    expect(memory.versions.length).toBe(2)
  })
})

const rows = async () => ({
  knowledge: (await db.knowledge.toArray()).sort((a, b) => a.ref.localeCompare(b.ref)),
  cards: (await db.studyCards.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
  lessons: (await db.lessons.toArray()).sort((a, b) => a.lessonId.localeCompare(b.lessonId)),
  preferences: await db.preferences.get('workspace'),
})
async function seedAll() {
  await seedMixed()
  await db.lessons.bulkPut([{ lessonId: 'ja:lesson:1', startedAt: 5, completedAt: 6 }, { lessonId: 'ko:lesson:2', startedAt: 7 }])
  await db.preferences.update('workspace', { currentLanguage: 'ja', startedTracks: ['ja', 'ko'], otherLanguageCards: 'ja', japaneseReading: 'kana' } as never)
}
async function wipe() {
  await resetBackupStateForTests(); localStorage.clear()
  await initializeProfiles(); await db.delete(); await db.open(); await initializeWorkspace()
}

describe('every export form carries the language rows and restores them exactly', () => {
  it('profile YAML: writes the ref explicitly on language rows only', async () => {
    await seedAll()
    const text = await exportActiveProfile()
    for (const ref of languageRefs) expect(text).toContain('ref: ' + ref)
    expect(text).not.toMatch(/ref: (vocabulary|grammar):/)
    const before = await rows()
    await wipe()
    await restoreActiveProfile(text)
    expect(await rows()).toEqual(before)
  })

  it('JSON backup: export then restore gives the same rows', async () => {
    await seedAll()
    const before = await rows()
    const text = await exportWorkspaceBackup()
    await wipe()
    await restoreBackup(text)
    expect(await rows()).toEqual(before)
  })

  it('cloud backup: Back up now succeeds twice and restores the same rows', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await seedAll()
    const before = await rows()
    await runBackup()
    await db.knowledge.put({ ref: 'vocabulary:shi4--identity', kind: 'vocabulary', lb: 'shi4--identity', band: '1', addedAt: T0 + 9, source: 'new' })
    await db.studyCards.put(card('vocabulary:shi4--identity', T0 + 9))
    await db.journal.add({ t: new Date(T0 + 9).toISOString(), op: 'add', ref: 'vocabulary:shi4--identity', band: 1, source: 'new' } as never)
    await runBackup()
    expect(memory.versions.length).toBe(2)
    await wipe()
    await saveBackupConfig(config)
    await applyBackup(await loadBackupVersion(config, getActiveProfile().id), config)
    const after = await rows()
    expect(after.knowledge.filter(row => languageRefs.includes(row.ref))).toEqual(before.knowledge.filter(row => languageRefs.includes(row.ref)))
    expect(after.cards.filter(row => languageRefs.includes(row.ref))).toEqual(before.cards.filter(row => languageRefs.includes(row.ref)))
    expect(after.lessons).toEqual(before.lessons)
    expect(after.preferences).toMatchObject({ startedTracks: ['ja', 'ko'], japaneseReading: 'kana' })
    expect(after.knowledge.some(row => row.ref === 'vocabulary:shi4--identity')).toBe(true)
  })
})

describe('the rows are carried but never shown', () => {
  it('the workspace view and the due queue hold only Chinese items', async () => {
    await seedAll()
    const workspace = await loadWorkspace()
    expect(workspace.knowledge.map(row => row.ref)).toEqual(['vocabulary:wo3--me'])
    expect(workspace.studyCards.map(row => row.ref)).toEqual(['vocabulary:wo3--me'])
    expect(workspace.lessons).toEqual([])
    expect(workspace.preferences).not.toHaveProperty('startedTracks')
    expect((await dueCards(Date.now() + 1e12)).every(due => !/^[a-z]{2,3}:/.test(due.ref))).toBe(true)
  })

  it('a Chinese-only profile exports without a single ref field', async () => {
    await db.knowledge.put({ ref: 'vocabulary:wo3--me', kind: 'vocabulary', lb: 'wo3--me', band: '1', addedAt: T0, source: 'new' })
    await db.studyCards.put(card('vocabulary:wo3--me', T0))
    const text = await exportActiveProfile()
    expect(text).not.toMatch(/\n\s+ref:/)
    expect(text).toMatch(/kind: vocabulary\n\s+lb: wo3--me/)
  })
})
