import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../core/database'
import { initializeProfiles } from '../core/profiles/store'
import { requestPersistence, setBackendFactoryForTests } from '../core/backup/service'
import { resetBackupStateForTests } from '../core/backup/state'
import { BackupPanel, RestoreOffer } from './BackupPanel'

beforeEach(async () => {
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); setBackendFactoryForTests(undefined); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'storage') })

describe('BackupPanel', () => {
  it('saves the connection, backs up now, and shows last backup time or the error', async () => {
    const remote = { head: 'abcdef123', tree: 't', files: {} }
    const publish = vi.fn().mockResolvedValueOnce({ version: 'abcdef123', changed: 3, removed: 0, remote, calls: [] }).mockRejectedValueOnce(new Error('GitHub rejected the token (401).'))
    setBackendFactoryForTests(() => ({ listProfiles: async () => [], listVersions: async () => [], readFiles: async () => new Map(), publish: vi.fn(), publishDelta: publish }))
    render(<BackupPanel busy={false} />)
    expect(screen.getByText(/Last backed up: never/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back up now/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('GitHub owner'), { target: { value: 'me' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'backups' } })
    fireEvent.change(screen.getByLabelText(/Fine-grained token/), { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: /save connection/i }))
    await screen.findByText('Backup connection saved.')
    fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    await screen.findByText(/commit abcdef1/)
    expect(screen.queryByText(/Last backed up: never/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /back up now/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /back up now/i }))
    await screen.findByText(/Last backup error: GitHub rejected the token/)
  })

  it('reports whether the browser granted persistent storage', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(true) } })
    expect(await requestPersistence()).toBe('granted')
    expect(navigator.storage.persist).toHaveBeenCalledTimes(1)
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) } })
    render(<BackupPanel busy={false} />)
    await screen.findByText(/not granted/)
  })

  it('offers restore on an empty profile only', async () => {
    const { unmount } = render(<RestoreOffer />)
    await screen.findByRole('button', { name: 'Restore from GitHub backup' })
    unmount()
    await db.words.add({ wordId: 'zh:tea', language: 'zh-Hans', introducedAt: 1, introducedFrom: 'dictionary', attempts: 0, independentCorrect: 0, successfulDays: [], successfulActivities: [], dueAt: 1 })
    render(<RestoreOffer />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore from GitHub backup' })).not.toBeInTheDocument())
  })
})
