import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from './database'
import { initializeProfiles, getActiveProfile } from './profiles/store'
import { resetBackupStateForTests, backupStateDb, loadCache, loadStatus } from './backup/state'
import { loadBackupConfig, readBackupStatus, runBackup, saveBackupConfig, setBackendFactoryForTests } from './backup/service'
import { loadBackup } from './backup/files'
import { savePreferences } from './learning'
import { addToKnowledge, advanceExercise, dueCards, startNewSession, startReviewSession, submitExerciseAnswer } from './study/knowledge'
import { whenGenerated } from './study/generation'
import { readBackup, exportWorkspaceBackup } from './backup'
import { exportActiveProfile } from './profiles/store'
import { parseProfileYaml } from './profiles/codec'
import { allRows, cloudFiles, fixtureJson, isOtherLanguage } from './main-made-profile.helpers'
import type { BackupBackend, DeltaResult, RemoteState } from './backup/backend'

vi.mock('./study/local-exercises', async importOriginal => ({ ...await importOriginal<typeof import('./study/local-exercises')>(), localVocabularyExercises: () => [], fillLocalExercises: () => [] }))
const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('./ai/structured', () => structured)

const connection = { id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const, baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const }
type Rows = Record<string, Record<string, unknown>[]>

const proposal = (targets: string[]) => ({ exercises: [
  { id: 'c1', type: 'choice', targets: targets.slice(0, 1), direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' },
  { id: 'c2', type: 'choice', targets: targets.slice(0, 2), direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是学生。'], answer: 0, explanation: 'x' },
  { id: 't1', type: 'tiles', targets, translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: ['学习'], explanation: 'x' },
  { id: 't2', type: 'tiles', targets: targets.slice(-1), translation: 'I study.', tiles: ['我', '学习'], distractors: [], explanation: 'x' },
] })

/** In-memory backup destination: keeps every version, applies the incremental publish like a real repository. */
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

/** The rows of other languages in every table, keyed by table and primary key, as they are right now. */
async function foreignRows(): Promise<Map<string, unknown>> {
  const rows = new Map<string, unknown>()
  const all = await allRows()
  for (const [table, list] of Object.entries(all)) {
    const key = db.table(table).schema.primKey.keyPath as string | undefined
    for (const row of list as Record<string, unknown>[]) {
      const id = key ? String(row[key]) : JSON.stringify(row)
      const foreign = isOtherLanguage(row.ref) || isOtherLanguage(row.lessonId) || isOtherLanguage(row.id) || (Array.isArray(row.refs) && row.refs.some(isOtherLanguage)) || (Array.isArray(row.targetRefs) && row.targetRefs.some(isOtherLanguage))
      if (foreign) rows.set(table + '/' + id, structuredClone(row))
    }
  }
  return rows
}

async function seed() {
  const tables = fixtureJson<Rows>('idb-rows.json')
  for (const [name, rows] of Object.entries(tables)) {
    if (name === 'aiConnections' || name === 'backupConfig') continue
    await (db as unknown as Record<string, { bulkPut(rows: unknown[]): Promise<unknown> }>)[name].bulkPut(rows)
  }
  await db.aiConnections.put(connection)
  await db.lessons.put({ lessonId: 'ko:lesson:2', startedAt: 5, completedAt: 6 })
  // Fields Stable has no schema for, on records it does know.
  await db.exerciseSessions.toCollection().modify((session: Record<string, unknown>) => { session.newerField = { a: 1 } })
  await db.preferences.update('workspace', { aSettingFromTheFuture: 'x' } as never)
}

beforeEach(async () => {
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  structured.requestStructuredJSON.mockReset()
})

describe('normal Stable use leaves every row of another language as it was', () => {
  it('a lesson, a review, a settings change and Back up now', async () => {
    await seed()
    const before = await foreignRows()
    expect(before.size).toBeGreaterThan(20)
    const rows = fixtureJson<Rows>('idb-rows.json')
    const known = new Set(rows.knowledge.map(row => String(row.ref)))
    const groupRefs = [...known].filter(ref => !isOtherLanguage(ref))
    structured.requestStructuredJSON.mockImplementation(async () => proposal(groupRefs.slice(0, 4)))
    // A review (cards due), played through.
    const review = await startReviewSession(Date.now() + 1000, true); await whenGenerated(review)
    const session = (await db.exerciseSessions.get(review))!
    for (let index = 0; index < session.exercises.length; index++) {
      const exercise = session.exercises[index]
      await submitExerciseAnswer(review, index, exercise.type === 'choice' ? exercise.answer : exercise.type === 'tiles' ? exercise.tiles : [])
      await advanceExercise(review, index)
    }
    // A lesson started, an item added from the dictionary, a settings change.
    await addToKnowledge(['vocabulary:ni3--you'])
    await savePreferences({ theme: 'light', pinyin: false })
    // Back up now to a fake destination, and a second time after more activity.
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig({ owner: 'me', repo: 'backups', token: 'tok', branch: 'main' })
    await runBackup()
    await addToKnowledge(['vocabulary:cha2--tea'])
    await runBackup()
    expect(memory.versions).toHaveLength(2)
    expect((await readBackupStatus()).lastError).toBeUndefined()
    // The backup holds no other-language record, and restores.
    const text = [...memory.versions[1]].filter(([path]) => !path.startsWith('journal/')).map(([, body]) => body).join('\n')
    expect(text).not.toMatch(/\b(ja|ko):[wgf]:|ja:lesson|kana|japaneseReading|startedTracks/)
    expect(() => loadBackup(memory.versions[1], getActiveProfile())).not.toThrow()
    await exportActiveProfile(); await exportWorkspaceBackup()
    // Every foreign row is still there, field for field.
    const after = await foreignRows()
    for (const [key, row] of before) expect(after.get(key), key).toEqual(row)
    expect(after.size).toBe(before.size)
  })

  it('a record of Stable that carries a field it does not know still reads, exports and restores', async () => {
    await seed()
    const workspace = await loadWorkspace()
    expect(workspace.preferences).not.toHaveProperty('aSettingFromTheFuture')
    expect(workspace.exerciseSessions.length).toBe(2)
    expect(workspace.exerciseSessions[0]).not.toHaveProperty('newerField')
    expect(parseProfileYaml(await exportActiveProfile()).knowledge.study.sessions).toHaveLength(2)
    const backupText = await exportWorkspaceBackup()
    expect(() => readBackup(backupText)).not.toThrow()
    // The stored preference and session keep the field: Stable ignores it, it does not remove it.
    expect(await db.preferences.get('workspace')).toMatchObject({ aSettingFromTheFuture: 'x', currentLanguage: 'ja' })
    expect(await db.exerciseSessions.toCollection().first()).toHaveProperty('newerField')
  })
})

describe('the backup state main wrote', () => {
  it('reads the status, the cache and the auto-backup keys without error', async () => {
    const state = fixtureJson<{ kv: { key: string; value: unknown }[]; runs: { id: number }[]; config: { owner: string } }>('backup-state.json')
    await backupStateDb().kv.bulkPut(state.kv)
    await backupStateDb().runs.bulkPut(state.runs as never)
    await db.backupConfig.put(state.config as never)
    localStorage.setItem('linguaweave-backup-config:default', JSON.stringify(state.config))
    const profile = getActiveProfile().id
    expect(state.kv.map(row => row.key).sort()).toEqual(['auto:default', 'cache:default', 'sent:default', 'status:default', 'window:default'])
    expect((await loadStatus(profile)).lastBackupAt).toBeTypeOf('number')
    expect(await loadCache(profile)).toMatchObject({ lastSeq: state.kv.find(row => row.key === 'cache:default')!.value ? (state.kv.find(row => row.key === 'cache:default')!.value as { lastSeq: number }).lastSeq : -1 })
    expect(await loadBackupConfig()).toMatchObject({ owner: 'me', repo: 'backups' })
    expect((await readBackupStatus()).lastCommit).toBeDefined()
  })

  it('runs Back up now on top of a state main left: the stale cache is replaced, nothing throws', async () => {
    const state = fixtureJson<{ kv: { key: string; value: unknown }[]; config: object }>('backup-state.json')
    await backupStateDb().kv.bulkPut(state.kv)
    await saveBackupConfig({ owner: 'me', repo: 'backups', token: 'tok', branch: 'main' })
    await seed()
    const memory = memoryBackend()
    memory.versions.push(cloudFiles()) // the repository main published to still holds what main's cache says it does
    setBackendFactoryForTests(() => memory.backend)
    await runBackup()
    expect((await readBackupStatus()).lastError).toBeUndefined()
    expect(memory.versions.length).toBe(2)
    expect((await dueCards(Date.now() + 1000)).every(card => !isOtherLanguage(card.ref))).toBe(true)
  })
})
