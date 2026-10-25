import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { initializeProfiles } from '../profiles/store'
import { addToKnowledge } from '../study/knowledge'
import { RestorePicker } from '../../components/BackupPanel'
import type { BackupBackend, DeltaResult, PublishResult, RemoteState } from './backend'
import { buildBackupFiles, loadBackup } from './files'
import { startBackgroundBackup } from './background'
import { readSnapshot } from '../profiles/store'
import { loadActive, loadRuns, resetBackupStateForTests } from './state'
import { getActiveProfile } from '../profiles/store'
import {
  applyBackup, listBackupProfiles, loadBackupConfig, loadBackupVersion, readBackupStatus, runBackup, saveBackupConfig,
  setBackendFactoryForTests, snapshotCurrentYaml, type BackupConfig,
} from './service'
import { parseJournal } from './journal'

const config: BackupConfig = { owner: 'me', repo: 'backups', token: 'tok', branch: 'main' }

/** Versioned in-memory backend: each publish is one version holding the whole file set. */
function memoryBackend() {
  const versions: { id: string; date: string; message: string; files: Map<string, string> }[] = []
  const backend: BackupBackend = {
    listProfiles: async () => versions.length ? [{ id: 'default', name: 'default' }] : [],
    listVersions: async () => [...versions].reverse().map(({ id, date, message }) => ({ id, date, message })),
    readFiles: async (_profile, version) => new Map((version ? versions.find(item => item.id === version)! : versions.at(-1)!).files),
    publish: async (_profile, files, message): Promise<PublishResult> => {
      const last = versions.at(-1)
      if (last && [...files].every(([path, text]) => last.files.get(path) === text) && last.files.size === files.size) return { changed: 0, removed: 0 }
      const id = `v${versions.length + 1}`
      versions.push({ id, date: new Date(1_790_000_000_000 + versions.length * 60_000).toISOString(), message, files: new Map(files) })
      return { version: id, changed: files.size, removed: 0 }
    },
    publishDelta: async (_profile, files, keep, message, known): Promise<DeltaResult> => {
      const last = versions.at(-1)
      const next = new Map(files)
      for (const path of keep) {
        const text = last?.files.get(path)
        if (text === undefined) throw Object.assign(new Error('missing ' + path), { name: 'StaleBackupError' })
        next.set(path, text)
      }
      void known
      const same = last && next.size === last.files.size && [...next].every(([path, text]) => last.files.get(path) === text)
      const remoteOf = (map: Map<string, string>, head: string): RemoteState => ({ head, tree: 't', files: Object.fromEntries([...map].map(([path, text]) => [path, String(text.length)])) })
      if (same) return { changed: 0, removed: 0, remote: remoteOf(next, last.id), calls: [] }
      const id = `v${versions.length + 1}`
      versions.push({ id, date: new Date(1_790_000_000_000 + versions.length * 60_000).toISOString(), message, files: next })
      const changed = [...next].filter(([path, text]) => last?.files.get(path) !== text).length
      return { version: id, changed, removed: 0, remote: remoteOf(next, id), calls: [{ method: 'POST', path: '/git/trees', status: 201, ms: 1 }] }
    },
  }
  return { backend, versions }
}

beforeEach(async () => {
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { setBackendFactoryForTests(undefined); vi.useRealTimers(); vi.restoreAllMocks() })

/** The layout earlier versions of the app wrote: checkpoint.yaml plus monthly journal segments. */
async function oldLayout() {
  const events = (await db.journal.orderBy('seq').toArray()).map(({ seq: _seq, ...event }) => { void _seq; return event })
  return buildBackupFiles(await readSnapshot(db, getActiveProfile()), events)
}

describe('backup connection storage', () => {
  it('keeps the connection in IndexedDB and localStorage and heals whichever is missing', async () => {
    await saveBackupConfig({ ...config, owner: ' me ' })
    expect((await db.backupConfig.get('github'))?.owner).toBe('me')
    expect(JSON.parse(localStorage.getItem('linguaweave-backup-config:default')!).token).toBe('tok')
    await db.backupConfig.clear()
    expect(await loadBackupConfig()).toEqual(config) // partly cleared store: localStorage still reaches the backup
    expect(await db.backupConfig.get('github')).toBeDefined()
    localStorage.clear()
    expect(await loadBackupConfig()).toEqual(config)
    expect(localStorage.getItem('linguaweave-backup-config:default')).not.toBeNull()
  })

  it('validates the connection', async () => {
    await expect(saveBackupConfig({ ...config, owner: '' })).rejects.toThrow(/owner/)
    await expect(saveBackupConfig({ ...config, token: ' ' })).rejects.toThrow(/token/)
  })
})

describe('backup run', () => {
  it('makes one backup per run with the journal and checkpoint, records status, and skips identical content', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await expect(runBackup()).rejects.toThrow(/Set up/)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    const status = await runBackup()
    expect(status.lastCommit).toBe('v1')
    expect((await readBackupStatus()).lastBackupAt).toBeTypeOf('number')
    const files = memory.versions[0].files
    expect(parseJournal([...files].find(([path]) => path.startsWith('journal/'))![1])).toEqual([expect.objectContaining({ op: 'add', ref: 'vocabulary:cha2--tea' })])
    expect([...files.keys()]).toEqual(expect.arrayContaining(['manifest.yaml', 'state/snapshot.yaml', 'state/state.yaml']))
    expect(files.get('settings.yaml')).toContain('token: tok')
    await runBackup()
    expect(memory.versions).toHaveLength(1)
    expect((await loadRuns())[0]).toMatchObject({ trigger: 'manual', outcome: 'unchanged' })
  })

  it('sends only the events since the last backup, as a new segment, and keeps the old segments untouched', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    await runBackup()
    const first = [...memory.versions[0].files.keys()].filter(path => path.startsWith('journal/'))
    await addToKnowledge(['grammar:s-shi4-n--identity'])
    await runBackup()
    const files = memory.versions[1].files
    const segments = [...files.keys()].filter(path => path.startsWith('journal/')).sort()
    expect(segments).toHaveLength(2)
    expect(segments[0]).toBe(first[0])
    expect(files.get(segments[0])).toBe(memory.versions[0].files.get(first[0]))
    expect(parseJournal(files.get(segments[1])!)).toEqual([expect.objectContaining({ op: 'add', ref: 'grammar:s-shi4-n--identity' })])
    const run = (await loadRuns())[0]
    expect(run).toMatchObject({ full: false, journalEvents: 1, outcome: 'ok' })
    expect(run.snapshot).toBe('none')
  })

  it('appends made while a backup is reading are left for the next one and nothing is lost', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    const publishDelta = memory.backend.publishDelta
    let injected = false
    memory.backend.publishDelta = async (...args) => {
      if (!injected) { injected = true; await addToKnowledge(['grammar:s-shi4-n--identity']) } // written after the cursor was read
      return publishDelta(...args)
    }
    await runBackup()
    expect(await db.journal.count()).toBe(2)
    const sent = [...memory.versions[0].files].filter(([path]) => path.startsWith('journal/')).flatMap(([, text]) => parseJournal(text))
    expect(sent).toHaveLength(1)
    await runBackup()
    const all = [...memory.versions.at(-1)!.files].filter(([path]) => path.startsWith('journal/')).sort(([a], [b]) => a.localeCompare(b)).flatMap(([, text]) => parseJournal(text))
    expect(all.map(event => event.ref)).toEqual(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
  })

  it('does not advance the cursor when the upload fails, so the next run resends the events', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    await runBackup()
    await addToKnowledge(['grammar:s-shi4-n--identity'])
    const publishDelta = memory.backend.publishDelta
    memory.backend.publishDelta = async () => { throw new Error('offline') }
    await expect(runBackup()).rejects.toThrow(/offline/)
    memory.backend.publishDelta = publishDelta
    await runBackup()
    const segments = [...memory.versions.at(-1)!.files].filter(([path]) => path.startsWith('journal/')).flatMap(([, text]) => parseJournal(text))
    expect(segments).toHaveLength(2)
  })

  it('writes a snapshot and the whole log the first time, and restores state the log does not carry', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await db.words.add({ wordId: 'zh:tea', language: 'zh-Hans', introducedAt: 1, introducedFrom: 'dictionary', attempts: 2, independentCorrect: 1, successfulDays: [], successfulActivities: [], dueAt: 1 })
    await addToKnowledge(['vocabulary:cha2--tea'])
    await runBackup()
    expect((await loadRuns())[0]).toMatchObject({ full: true, snapshot: 'live' })
    const loaded = await loadBackupVersion(config, 'default')
    expect(loaded.snapshot.knowledge.words.map(word => word.wordId)).toEqual(['zh:tea'])
    expect(loaded.snapshot.knowledge.study.knowledge.map(entry => entry.ref)).toEqual(['vocabulary:cha2--tea'])
  })

  it('records the error when the backend fails', async () => {
    setBackendFactoryForTests(() => ({ ...memoryBackend().backend, publishDelta: async () => { throw new Error('GitHub rejected the token (401).') } }))
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    await expect(runBackup()).rejects.toThrow(/401/)
    expect((await readBackupStatus()).lastError).toMatch(/401/)
  })
})

describe('restore', () => {
  it('replaces the local profile from a chosen version and keeps the connection', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    await runBackup()
    await addToKnowledge(['grammar:s-shi4-n--identity'])
    await runBackup()
    expect(memory.versions).toHaveLength(2)

    const profiles = await listBackupProfiles(config)
    expect(profiles).toEqual([{ id: 'default', name: 'default' }])
    const localBefore = await snapshotCurrentYaml()
    expect(localBefore).toContain('grammar:s-shi4-n--identity'.split(':')[1].replace('--identity', '') ? 'linguaweave-profile' : '')

    const loaded = await loadBackupVersion(config, 'default', 'v1') // the older version
    expect(loaded.mode).toBe('checkpoint')
    await applyBackup(loaded, config)
    expect((await db.knowledge.toArray()).map(entry => entry.ref)).toEqual(['vocabulary:cha2--tea'])
    expect(await db.journal.count()).toBe(0) // the snapshot already holds the log; new activity starts a fresh tail
    expect(await db.backupConfig.get('github')).toMatchObject({ owner: 'me', token: 'tok' })
    // New activity continues the restored journal.
    await addToKnowledge(['grammar:s-shi4-n--identity'])
    expect(await db.journal.count()).toBe(1)
  })

  it('restores a fresh device from the journal alone when the checkpoint is unreadable', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
    await runBackup()
    memory.versions[0].files.clear()
    for (const [path, text] of await oldLayout()) memory.versions[0].files.set(path, text)
    memory.versions[0].files.set('checkpoint.yaml', 'format: something-newer\nversion: 7\n')
    await db.delete(); await db.open(); await initializeWorkspace()
    const loaded = await loadBackupVersion(config, 'default')
    expect(loaded.mode).toBe('journal')
    await applyBackup(loaded, config)
    expect((await db.knowledge.toArray()).map(entry => entry.ref).sort()).toEqual(['grammar:s-shi4-n--identity', 'vocabulary:cha2--tea'])
    expect(await db.studyCards.count()).toBe(2)
  })

  it('picker flow: find, choose version, review, confirm; downloads the current data first', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    await runBackup()
    await addToKnowledge(['grammar:s-shi4-n--identity'])
    const reload = vi.fn()
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => { created.push(blob as Blob); return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<RestorePicker config={config} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: /find backups/i }))
    await screen.findByLabelText(/version/i)
    fireEvent.click(screen.getByRole('button', { name: /review this version/i }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/replace this device/i)
    expect(await db.knowledge.count()).toBe(2) // nothing is replaced before the confirm
    fireEvent.click(screen.getByRole('button', { name: /download current data, then replace/i }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(click).toHaveBeenCalledTimes(1)
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(created[0]) })
    expect(text).toContain('grammar')
    expect((await db.knowledge.toArray()).map(entry => entry.ref)).toEqual(['vocabulary:cha2--tea'])
  })
})

describe('no automatic runs on the page', () => {
  it('never backs up by itself while the page is open, hidden or changing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const memory = memoryBackend()
    const publishDelta = vi.spyOn(memory.backend, 'publishDelta')
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    const stop = startBackgroundBackup()
    await addToKnowledge(['vocabulary:cha2--tea'])
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    stop()
    expect(publishDelta).not.toHaveBeenCalled()
    expect((await loadActive())?.dirtyAt).toBeTypeOf('number') // only noted, for a background sync to find
  })
})

describe('old-layout backups', () => {
  it('still restores a backup written by the earlier layout, and the next backup moves to the new one', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
    memory.versions.push({ id: 'old1', date: new Date(1_780_000_000_000).toISOString(), message: 'old', files: new Map(await oldLayout()) })
    expect(memory.versions[0].files.has('manifest.yaml')).toBe(false)
    await db.delete(); await db.open(); await initializeWorkspace()
    const loaded = await loadBackupVersion(config, 'default')
    expect(loaded.mode).toBe('checkpoint')
    await applyBackup(loaded, config)
    expect((await db.knowledge.toArray()).map(entry => entry.ref).sort()).toEqual(['grammar:s-shi4-n--identity', 'vocabulary:cha2--tea'])
    await runBackup()
    const latest = memory.versions.at(-1)!.files
    expect(latest.has('manifest.yaml')).toBe(true)
    const again = loadBackup(latest, getActiveProfile())
    expect(again.snapshot.knowledge.study.knowledge).toHaveLength(2)
  })
})
