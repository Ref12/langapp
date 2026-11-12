// @vitest-environment jsdom
// Settings offers "Copy profile from Stable…" in the Chinese Lab build and "Copy settings from Stable…" in Lab Japanese and Korean, never in Stable; it opens the same StableCopyDialog the side-panel menu opens.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { learnerFixture, T0 } from '../core/profiles/fixtures/learner'
import { resetBackupStateForTests } from '../core/backup/state'
import { initializeProfiles, restoreActiveSnapshot } from '../core/profiles/store'
import { setBuildChannelForTests, setBuildLanguageForTests } from '../core/storage-names'
import type { LanguageId } from '../core/language/ids'

const FIXED_REVISION = '00000000-0000-4000-8000-000000000102'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(FIXED_REVISION as ReturnType<typeof crypto.randomUUID>)
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
  const fixture = learnerFixture()
  await restoreActiveSnapshot(fixture.snapshot, fixture.journal)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

afterEach(() => { setBuildChannelForTests(undefined); setBuildLanguageForTests(undefined) })

async function openSettings(channel: 'lab' | 'stable', language: LanguageId) {
  setBuildChannelForTests(channel); setBuildLanguageForTests(language)
  window.location.hash = '#settings'
  render(<App />)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Make it yours' })).toBeInTheDocument(), { timeout: 8000 })
}
const PROFILE_BUTTON = 'Copy profile from Stable…'
const SETTINGS_BUTTON = 'Copy settings from Stable…'

describe('Settings: Copy from Stable', () => {
  it('Chinese Lab copies the profile: the section and the button open the dialog', async () => {
    await openSettings('lab', 'zh')
    expect(screen.getByRole('heading', { name: 'Stable' })).toBeInTheDocument()
    expect(screen.getByText(/Copy your profile from Stable into Lab, with its AI, speech and GitHub backup connections\. Stable is not changed\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: PROFILE_BUTTON }))
    expect(await screen.findByRole('dialog', { name: 'Copy profile from Stable' })).toBeInTheDocument()
  })
  for (const [language, name] of [['ja', 'Japanese'], ['ko', 'Korean']] as const) {
    it(`Lab ${name} copies the settings only, and says its learning is not touched`, async () => {
      await openSettings('lab', language)
      expect(screen.getByRole('heading', { name: 'Stable' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: PROFILE_BUTTON })).toBeNull()
      expect(screen.getByText(new RegExp(`Your ${name} learning is not touched`))).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: SETTINGS_BUTTON }))
      expect(await screen.findByRole('dialog', { name: 'Copy settings from Stable' })).toBeInTheDocument()
    })
  }
  it('Stable does not offer it', async () => {
    await openSettings('stable', 'zh')
    expect(screen.queryByRole('button', { name: PROFILE_BUTTON })).toBeNull()
    expect(screen.queryByRole('button', { name: SETTINGS_BUTTON })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Stable' })).toBeNull()
  })
})
