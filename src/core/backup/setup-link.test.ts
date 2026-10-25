import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { initializeProfiles } from '../profiles/store'
import { loadBackupConfig, setBackendFactoryForTests } from './service'
import { applySetup, decodeSetupLink, encodeSetupLink, shouldAutoRestore, takeSetupFragment } from './setup-link'

const config = { owner: 'me', repo: 'backups', branch: 'main', token: 'github_pat_ü/+=' }
beforeEach(async () => {
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  setBackendFactoryForTests(undefined)
})

describe('setup link', () => {
  it('round-trips and keeps the token in the fragment only', () => {
    const url = encodeSetupLink(config, 'https://x.test/apps/lang/')
    expect(url.startsWith('https://x.test/apps/lang/#backup=')).toBe(true)
    expect(url).not.toContain('?')
    expect(decodeSetupLink(url)).toEqual(config)
    expect(decodeSetupLink(url.slice(url.indexOf('#')))).toEqual(config)
  })
  it('rejects bad and old payloads with a clear message', () => {
    expect(() => decodeSetupLink('https://x.test/')).toThrow(/not a cloud backup/)
    expect(() => decodeSetupLink('#backup=%%%')).toThrow(/damaged/)
    const old = '#backup=' + btoa(JSON.stringify({ v: 2, owner: 'a', repo: 'b', token: 't' }))
    expect(() => decodeSetupLink(old)).toThrow(/different version/)
    const partial = '#backup=' + btoa(JSON.stringify({ v: 1, owner: 'a' }))
    expect(() => decodeSetupLink(partial)).toThrow(/incomplete/)
  })
  it('strips a #backup= fragment from the address on load', () => {
    history.replaceState(null, '', '/#backup=abc')
    expect(takeSetupFragment()).toBe('#backup=abc')
    expect(location.hash).toBe('')
    expect(takeSetupFragment()).toBeUndefined()
  })
  it('bad payload changes nothing', async () => {
    await expect(applySetup('#backup=zzz')).rejects.toThrow()
    expect(await loadBackupConfig()).toBeUndefined()
  })
  it('decides auto-restore only for an empty profile with a backup', () => {
    expect(shouldAutoRestore(true, 1)).toBe(true)
    expect(shouldAutoRestore(true, 0)).toBe(false)
    expect(shouldAutoRestore(false, 2)).toBe(false)
  })
  it('connects, saves and reports; empty profile restores, profile with data does not', async () => {
    const listProfiles = vi.fn().mockResolvedValue([])
    setBackendFactoryForTests(() => ({ listProfiles, listVersions: async () => [], readFiles: async () => new Map(), publish: vi.fn() }))
    const reload = vi.fn()
    const result = await applySetup(encodeSetupLink(config, 'https://x.test/'), reload)
    expect(result.message).toBe('Cloud backup connected to me/backups')
    expect(await loadBackupConfig()).toEqual(config)
    expect(reload).not.toHaveBeenCalled()
    await db.words.add({ wordId: 'zh:tea', language: 'zh-Hans', introducedAt: 1, introducedFrom: 'dictionary', attempts: 0, independentCorrect: 0, successfulDays: [], successfulActivities: [], dueAt: 1 })
    listProfiles.mockResolvedValue([{ id: 'p' }])
    const second = await applySetup(config, reload)
    expect(second.restored).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
  it('surfaces a GitHub error', async () => {
    setBackendFactoryForTests(() => ({ listProfiles: async () => { throw new Error('GitHub rejected the token (401).') }, listVersions: async () => [], readFiles: async () => new Map(), publish: vi.fn() }))
    await expect(applySetup(config)).rejects.toThrow(/401/)
  })
})
