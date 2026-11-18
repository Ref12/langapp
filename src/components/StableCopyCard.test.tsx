import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StableCopyCard } from './StableCopyCard'
import { db, initializeWorkspace } from '../core/database'
import { initializeProfiles, resetProfilesForTests } from '../core/profiles/store'
import { addToKnowledge } from '../core/study/knowledge'
import { loadBuild } from '../test/channels'
import { setBuildChannelForTests, setBuildLanguageForTests, storageNames } from '../core/storage-names'

async function seedStable() {
  const stable = await loadBuild('stable')
  await stable.store.initializeProfiles()
  await stable.database.initializeWorkspace()
  await stable.knowledge.addToKnowledge(['vocabulary:cha2--tea'])
  stable.close()
  setBuildChannelForTests(undefined)
}
async function openMain() {
  vi.resetModules()
  await initializeProfiles()
  await initializeWorkspace()
}
const heading = 'Your progress from the old version can be copied in'

beforeEach(async () => {
  resetProfilesForTests()
  setBuildChannelForTests(undefined)
  for (const info of await indexedDB.databases()) if (info.name) await Dexie.delete(info.name)
  localStorage.clear()
})
afterEach(() => { vi.restoreAllMocks(); setBuildChannelForTests(undefined); setBuildLanguageForTests(undefined) })

describe('the first-run copy card', () => {
  it('shows when the profile is empty and Stable has data, with Copy and Not now', async () => {
    await seedStable()
    await openMain()
    render(<StableCopyCard />)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })
  it('Not now hides it, remembers it under a lab. key and leaves the profile empty', async () => {
    await seedStable()
    await openMain()
    const user = userEvent.setup()
    const first = render(<StableCopyCard />)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('heading', { name: heading })).toBeNull()
    expect(storageNames().labOnly.copyOfferDeclined.startsWith('lab.')).toBe(true)
    expect(localStorage.getItem(storageNames().labOnly.copyOfferDeclined)).toBe('1')
    expect(await db.knowledge.count()).toBe(0)
    first.unmount()
    render(<StableCopyCard />)
    await new Promise(done => setTimeout(done, 100))
    expect(screen.queryByRole('heading', { name: heading })).toBeNull()
  })
  it('Copy opens the existing copy flow, which brings the Stable data in', async () => {
    await seedStable()
    await openMain()
    const user = userEvent.setup()
    render(<StableCopyCard />)
    await user.click(await screen.findByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('dialog', { name: 'Copy profile from Stable' })).toBeInTheDocument()
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await user.click(await screen.findByRole('button', { name: 'Copy from Stable' }))
    await waitFor(() => expect(screen.getByText(/Copied/)).toBeInTheDocument())
    expect(await db.knowledge.count()).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })
  it('does not show when Stable has no data', async () => {
    await openMain()
    render(<StableCopyCard />)
    await new Promise(done => setTimeout(done, 150))
    expect(screen.queryByRole('heading', { name: heading })).toBeNull()
    expect(localStorage.getItem(storageNames().labOnly.copyOfferDeclined)).toBeNull()
  })
  it('does not show when the profile already has learning data', async () => {
    await seedStable()
    await openMain()
    await addToKnowledge(['vocabulary:cha2--tea'])
    render(<StableCopyCard />)
    await new Promise(done => setTimeout(done, 150))
    expect(screen.queryByRole('heading', { name: heading })).toBeNull()
  })
  it('does not show in a language build, which only copies settings', async () => {
    await seedStable()
    setBuildLanguageForTests('ja')
    await openMain()
    render(<StableCopyCard />)
    await new Promise(done => setTimeout(done, 150))
    expect(screen.queryByRole('heading', { name: heading })).toBeNull()
  })
})
