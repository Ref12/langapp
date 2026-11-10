import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { loadCatalog } from '../study/catalog'
import { addToKnowledge } from '../study/knowledge'
import { trackWord } from '../learning'
import { addLanguageRows } from '../../test/language-rows'
import type { BackupBackend, DeltaResult, PublishResult, RemoteState } from '../backup/backend'
import { applyBackup, loadBackupVersion, runBackup, saveBackupConfig, setBackendFactoryForTests, type BackupConfig } from '../backup/service'
import { resetBackupStateForTests } from '../backup/state'
import { getActiveProfile, initializeProfiles, readSnapshot, restoreActiveSnapshot } from './store'
import { parseProfileYaml, serializeProfileYaml } from './codec'

const config: BackupConfig = { owner: 'me', repo: 'backups', token: 'tok', branch: 'main' }
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'chinese-only-export.json')
const T0 = 1_790_000_000_000

/** Versioned in-memory backend: each publish is one version holding the whole file set. */
function memoryBackend() {
  const versions: { id: string; date: string; message: string; files: Map<string, string> }[] = []
  const remoteOf = (map: Map<string, string>, head: string): RemoteState => ({ head, tree: 't', files: Object.fromEntries([...map].map(([path, text]) => [path, String(text.length)])) })
  const backend: BackupBackend = {
    listProfiles: async () => versions.length ? [{ id: 'default', name: 'default' }] : [],
    listVersions: async () => [...versions].reverse().map(({ id, date, message }) => ({ id, date, message })),
    readFiles: async (_profile, version) => new Map((version ? versions.find(item => item.id === version)! : versions.at(-1)!).files),
    publish: async (_profile, files, message): Promise<PublishResult> => {
      const id = 'v' + (versions.length + 1)
      versions.push({ id, date: new Date(T0).toISOString(), message, files: new Map(files) })
      return { version: id, changed: files.size, removed: 0 }
    },
    publishDelta: async (_profile, files, keep, message): Promise<DeltaResult> => {
      const last = versions.at(-1)
      const next = new Map(files)
      for (const path of keep) {
        const text = last?.files.get(path)
        if (text === undefined) throw Object.assign(new Error('missing ' + path), { name: 'StaleBackupError' })
        next.set(path, text)
      }
      const same = last && next.size === last.files.size && [...next].every(([path, text]) => last.files.get(path) === text)
      if (same) return { changed: 0, removed: 0, remote: remoteOf(next, last.id), calls: [] }
      const id = 'v' + (versions.length + 1)
      versions.push({ id, date: new Date(T0 + versions.length * 60_000).toISOString(), message, files: next })
      return { version: id, changed: next.size, removed: 0, remote: remoteOf(next, id), calls: [] }
    },
  }
  return { backend, versions }
}

const rows = async () => ({
  knowledge: (await db.knowledge.toArray()).sort((a, b) => a.ref.localeCompare(b.ref)),
  cards: (await db.studyCards.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
})

async function reset() {
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
}

/** A Chinese lesson's items, built with the app's own functions. */
async function chineseLesson() {
  const catalog = await loadCatalog()
  const refs = catalog.orderedGroups[0].group.units.map(unit => `${unit.kind}:${unit.ref}`)
  await addToKnowledge(refs)
  await trackWord('tea', 'test').catch(() => undefined)
}

/** The mixed profile: Chinese lesson, Japanese track (words, grammar, a form item), Korean items, right and wrong answers: the rows the old screens left, as plain data. */
async function mixedProfile() {
  await chineseLesson()
  await addLanguageRows(db)
}

async function chineseOnly() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  await chineseLesson()
}

beforeEach(reset)
afterEach(() => { setBackendFactoryForTests(undefined); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Japanese and Korean entries in every export form', () => {
  it('has the shapes the bug report names', async () => {
    await mixedProfile()
    const { knowledge, cards } = await rows()
    expect(knowledge.some(entry => entry.ref.startsWith('ja:g:'))).toBe(true)
    expect(knowledge.some(entry => entry.ref.startsWith('ja:f:'))).toBe(true)
    expect(knowledge.some(entry => entry.ref.startsWith('ko:w:'))).toBe(true)
    expect(cards.some(card => card.reps > 0 && card.ref.startsWith('ja:'))).toBe(true)
  })

  it('profile YAML: export then restore into an empty profile gives the same rows', async () => {
    await mixedProfile()
    const before = await rows()
    const text = serializeProfileYaml(await readSnapshot(db, getActiveProfile()))
    await reset()
    expect((await rows()).knowledge).toEqual([])
    await restoreActiveSnapshot(parseProfileYaml(text), [])
    expect(await rows()).toEqual(before)
  })

  it('writes the ref explicitly on language rows only, and the Chinese rows have none', async () => {
    await mixedProfile()
    const study = (parseYaml(serializeProfileYaml(await readSnapshot(db, getActiveProfile())))).knowledge.study as { knowledge: { ref?: string; kind: string; lb: string }[]; cards: { ref?: string; kind?: string }[] }
    for (const row of [...study.knowledge, ...study.cards]) expect(row.ref === undefined).toBe(row.kind !== undefined && !/^[a-z]{2,3}:/.test(row.ref ?? ''))
    expect(study.knowledge.find(row => row.ref === 'ja:f:くる:masu')).toMatchObject({ kind: 'vocabulary', lb: 'くる:masu', band: '1', source: 'new' })
    expect(study.knowledge.filter(row => row.ref).length).toBe(study.cards.filter(row => row.ref).length)
    expect(study.knowledge.some(row => !row.ref)).toBe(true)
  })

  it.each(['manual', 'auto'] as const)('cloud backup (%s) succeeds and restores the same rows', async trigger => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await mixedProfile()
    const before = await rows()
    await runBackup(trigger)
    expect(memory.versions.length).toBeGreaterThan(0)
    await reset()
    await saveBackupConfig(config)
    const loaded = await loadBackupVersion(config, 'default')
    await applyBackup(loaded, config)
    expect(await rows()).toEqual(before)
  })

  it('JSON backup: export then restore gives the same rows', async () => {
    await mixedProfile()
    const before = await rows()
    const text = await exportWorkspaceBackup()
    await reset()
    await restoreBackup(text)
    expect(await rows()).toEqual(before)
  })
})

describe('Chinese-only profiles are unchanged', () => {
  async function outputs() {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await runBackup('manual')
    return {
      yaml: serializeProfileYaml(await readSnapshot(db, getActiveProfile())),
      cloud: Object.fromEntries([...memory.versions.at(-1)!.files].sort(([a], [b]) => a.localeCompare(b))),
    }
  }

  it('exports byte for byte what it exported before the fix, and that file still restores', async () => {
    await chineseOnly()
    const now = await outputs()
    if (process.env.WRITE_FIXTURE) { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, JSON.stringify(now, null, 1) + '\n') }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as typeof now & { rows: unknown }
    expect(now.yaml).toBe(fixture.yaml)
    expect(now.cloud).toEqual(fixture.cloud)
    // an export made before this change restores
    const before = await rows()
    await reset()
    await restoreActiveSnapshot(parseProfileYaml(fixture.yaml), [])
    expect(await rows()).toEqual(before)
    await reset()
    const memory = memoryBackend()
    memory.versions.push({ id: 'v1', date: new Date(T0).toISOString(), message: 'old', files: new Map(Object.entries(fixture.cloud)) })
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await applyBackup(await loadBackupVersion(config, 'default'), config)
    expect(await rows()).toEqual(before)
  })
})

describe('an old backup with Japanese and Korean rows (frozen fixture)', () => {
  const OLD = JSON.parse(readFileSync(join(here, 'fixtures', 'old-language-backup.json'), 'utf8')) as { backup: string; yaml: string; cloud: Record<string, string> }
  const withoutTime = (text: string) => { const { exportedAt, ...rest } = JSON.parse(text) as { exportedAt: string }; void exportedAt; return rest }

  it('holds the rows the plan names', () => {
    const backup = JSON.parse(OLD.backup) as { study: { knowledge: { ref: string }[]; cards: { ref: string }[]; sessions: { targetRefs: string[] }[] }; workspace: { lessons: { lessonId: string }[]; preferences: Record<string, unknown> } }
    for (const prefix of ['ja:w:', 'ja:g:', 'ja:f:', 'ko:w:', 'ko:g:']) expect(backup.study.knowledge.some(row => row.ref.startsWith(prefix))).toBe(true)
    expect(backup.study.cards.some(row => row.ref.startsWith('ko:'))).toBe(true)
    expect(backup.workspace.lessons.map(row => row.lessonId)).toEqual(expect.arrayContaining(['ja:lesson:1', 'ko:lesson:1']))
    expect(backup.workspace.preferences).toMatchObject({ currentLanguage: 'ko', startedTracks: ['ja', 'ko'], otherLanguageCards: 'both' })
    expect(backup.study.sessions[0].targetRefs.every(ref => /^(ja|ko):/.test(ref))).toBe(true)
    expect(OLD.cloud['journal/000000001-000000024.yaml']).toMatch(/ja:w:/)
  })

  it('the JSON backup restores in the Chinese build and exports the same content again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await restoreBackup(OLD.backup)
    expect(withoutTime(await exportWorkspaceBackup())).toEqual(withoutTime(OLD.backup))
    expect((await db.knowledge.toArray()).filter(entry => /^(ja|ko):/.test(entry.ref)).length).toBeGreaterThan(0)
  })

  it('the cloud backup restores and the profile exports the same YAML again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const memory = memoryBackend()
    memory.versions.push({ id: 'v1', date: new Date(T0).toISOString(), message: 'old', files: new Map(Object.entries(OLD.cloud)) })
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await applyBackup(await loadBackupVersion(config, 'default'), config)
    expect(serializeProfileYaml(await readSnapshot(db, getActiveProfile()))).toBe(OLD.yaml)
  })

  it('the profile YAML restores into an empty profile with the same rows', async () => {
    await restoreActiveSnapshot(parseProfileYaml(OLD.yaml), [])
    const restored = await rows()
    await reset()
    await restoreBackup(OLD.backup)
    expect(restored).toEqual(await rows())
  })
})
