import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { initializeProfiles } from '../profiles/store'
import { addToKnowledge } from '../study/knowledge'
import { RestorePicker } from '../../components/BackupPanel'
import type { BackupBackend, PublishResult } from './backend'
import {
  applyBackup, listBackupProfiles, loadBackupConfig, loadBackupVersion, readBackupStatus, runBackup, saveBackupConfig,
  setBackendFactoryForTests, snapshotCurrentYaml, startBackupScheduler, type BackupConfig,
} from './service'
import { notifyLocalChange } from './dirty'
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
  }
  return { backend, versions }
}

beforeEach(async () => {
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { setBackendFactoryForTests(undefined); vi.useRealTimers(); vi.restoreAllMocks() })

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
    expect(readBackupStatus().lastBackupAt).toBeTypeOf('number')
    const files = memory.versions[0].files
    expect(parseJournal([...files].find(([path]) => path.startsWith('journal/'))![1])).toEqual([expect.objectContaining({ op: 'add', ref: 'vocabulary:cha2--tea' })])
    expect(files.get('settings.yaml')).toContain('token: tok')
    await runBackup()
    expect(memory.versions).toHaveLength(1)
  })

  it('records the error and keeps the changes marked unsent when the backend fails', async () => {
    setBackendFactoryForTests(() => ({ ...memoryBackend().backend, publish: async () => { throw new Error('GitHub rejected the token (401).') } }))
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea'])
    await expect(runBackup()).rejects.toThrow(/401/)
    expect(readBackupStatus().lastError).toMatch(/401/)
    expect(localStorage.getItem('linguaweave-backup-dirty:default')).toBe('1')
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
    expect(await db.journal.count()).toBe(1)
    expect(await db.backupConfig.get('github')).toMatchObject({ owner: 'me', token: 'tok' })
    // New activity continues the restored journal.
    await addToKnowledge(['grammar:s-shi4-n--identity'])
    expect(await db.journal.count()).toBe(2)
  })

  it('restores a fresh device from the journal alone when the checkpoint is unreadable', async () => {
    const memory = memoryBackend()
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    await addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
    await runBackup()
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
    expect(await created[0].text()).toContain('grammar')
    expect((await db.knowledge.toArray()).map(entry => entry.ref)).toEqual(['vocabulary:cha2--tea'])
  })
})

describe('scheduler', () => {
  it('debounces after changes, backs up on page hide, and at least daily', async () => {
    vi.useFakeTimers()
    const memory = memoryBackend()
    const publish = vi.spyOn(memory.backend, 'publish')
    setBackendFactoryForTests(() => memory.backend)
    await saveBackupConfig(config)
    const stop = startBackupScheduler({ debounceMs: 1000 })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    publish.mockClear()
    await addToKnowledge(['vocabulary:cha2--tea'])
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    notifyLocalChange() // a second change restarts the debounce
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(publish).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(publish).toHaveBeenCalledTimes(1)

    await addToKnowledge(['grammar:s-shi4-n--identity'])
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(publish).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })

    // Nothing unsent and a day passes: the hourly check makes the daily backup (content unchanged, so no new version).
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000) })
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(3)
    stop()
  })
})
