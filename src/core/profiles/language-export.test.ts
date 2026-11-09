import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { formItemId } from '../forms'
import { loadParallel, resetParallel } from '../parallel/data'
import { startTrack, markParallelStudied } from '../parallel/progress'
import { addParallelKnowledge, recordParallelResult } from '../parallel/practice'
import { lessonItems } from '../parallel/session'
import { loadCatalog } from '../study/catalog'
import { addToKnowledge } from '../study/knowledge'
import { trackWord } from '../learning'
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

/** The mixed profile: Chinese lesson, Japanese track (words, grammar, a form item), one Korean item, right and wrong answers. */
async function mixedProfile() {
  await chineseLesson()
  resetParallel()
  await startTrack('ja')
  await markParallelStudied('ja', 1, T0)
  const data = await loadParallel('ja')
  const items = lessonItems(data, 'ja', data.lessons[0]).map(item => item.ref)
  const words = items.filter(ref => ref.includes(':w:'))
  const grammar = items.filter(ref => ref.includes(':g:'))
  expect(words.length).toBeGreaterThan(1)
  expect(grammar.length).toBeGreaterThan(0)
  await addParallelKnowledge([...words, ...grammar], T0)
  await recordParallelResult(words[0], true, false, T0 + 1000)
  await recordParallelResult(words[1], false, false, T0 + 2000)
  await recordParallelResult(words[0], true, true, T0 + 3000)
  await recordParallelResult(grammar[0], false, false, T0 + 4000)
  await recordParallelResult(formItemId('ja', 'くる', 'masu'), true, false, T0 + 5000)
  await recordParallelResult(formItemId('ja', 'くる', 'masu'), false, false, T0 + 6000)
  await recordParallelResult('ko:w:ko-nikl-24021', false, false, T0 + 7000)
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
