import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StableCopyDialog } from './StableCopyDialog'
import { db, initializeWorkspace } from '../core/database'
import { initializeProfiles, resetProfilesForTests } from '../core/profiles/store'
import { addToKnowledge } from '../core/study/knowledge'
import { addPlainLanguageRows } from '../test/language-rows'
import { loadBuild, snapshotStable } from '../test/channels'
import { setBuildChannelForTests, storageNames } from '../core/storage-names'

const caches = new Map<string, unknown>()
async function seedStable() {
  const stable = await loadBuild('stable')
  await stable.store.initializeProfiles()
  await stable.database.initializeWorkspace()
  await stable.knowledge.addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
  await addPlainLanguageRows(stable.database.db, ['ja:w:ja-n5-00679', 'ko:w:ko-nikl-24021'], 1_700_000_000_000)
  await stable.database.db.preferences.update('workspace', { name: 'Stable workspace' })
  const other = await stable.store.createProfile('Reading', false)
  await stable.store.selectProfile(other.id)
  stable.close()
  setBuildChannelForTests(undefined)
}

beforeEach(async () => {
  resetProfilesForTests()
  setBuildChannelForTests(undefined)
  for (const info of await indexedDB.databases()) if (info.name) await Dexie.delete(info.name)
  localStorage.clear()
})
afterEach(() => { setBuildChannelForTests(undefined) })

async function openLab() {
  vi.resetModules()
  await initializeProfiles()
  await initializeWorkspace()
}

describe('Copy profile from Stable', () => {
  it('names what is replaced and what is copied, lets the learner pick a profile, and changes nothing when declined', async () => {
    await seedStable()
    await openLab()
    await addToKnowledge(['vocabulary:cha2--tea'])
    const before = await snapshotStable(caches)
    const labBefore = JSON.stringify(await db.knowledge.toArray())
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<StableCopyDialog mode="menu" onClose={onClose} />)
    const dialog = await screen.findByRole('dialog', { name: 'Copy profile from Stable' })
    await screen.findByRole('radio', { name: /default/ })
    expect(dialog).toHaveTextContent('Which Stable profile?')
    expect(dialog).toHaveTextContent('Reading')
    await user.click(screen.getByRole('radio', { name: /default/ }))
    expect(dialog).toHaveTextContent('Stable profile “default”')
    expect(dialog).toHaveTextContent('Last activity:')
    expect(dialog).toHaveTextContent('4 items in the knowledge set (2 Japanese or Korean), 4 cards')
    expect(dialog).toHaveTextContent('replaces')
    expect(dialog).toHaveTextContent('Lab profile “default” (1 items in the knowledge set')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(JSON.stringify(await db.knowledge.toArray())).toBe(labBefore)
    expect(await snapshotStable(caches)).toEqual(before)
  })

  it('replaces the Lab profile only after the learner confirms', async () => {
    await seedStable()
    await openLab()
    await addToKnowledge(['vocabulary:cha2--tea'])
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
    const user = userEvent.setup()
    render(<StableCopyDialog mode="menu" onClose={() => undefined} />)
    await user.click(await screen.findByRole('radio', { name: /default/ }))
    await user.click(screen.getByRole('button', { name: 'Replace Lab profile' }))
    await waitFor(async () => expect((await db.knowledge.toArray()).map(row => row.ref).sort()).toEqual(['grammar:s-shi4-n--identity', 'ja:w:ja-n5-00679', 'ko:w:ko-nikl-24021', 'vocabulary:cha2--tea']))
    expect(await screen.findByText(/Copied/)).toBeInTheDocument()
  })

  it('offers the copy up front on an empty profile; declining leaves it empty and is remembered', async () => {
    await seedStable()
    await openLab()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<StableCopyDialog mode="offer" onClose={onClose} />)
    expect(await screen.findByRole('heading', { name: 'Start from your Stable profile?' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'No, start empty' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(await db.knowledge.count()).toBe(0)
    expect(localStorage.getItem(storageNames().labOnly.copyOfferDeclined)).toBe('1')
  })

  it('does not bother a learner who has no Stable data', async () => {
    await openLab()
    const onClose = vi.fn()
    render(<StableCopyDialog mode="offer" onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(localStorage.getItem(storageNames().labOnly.copyOfferDeclined)).toBeNull()
  })
})
