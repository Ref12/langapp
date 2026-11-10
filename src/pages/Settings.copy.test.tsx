// @vitest-environment jsdom
// Settings offers "Copy profile from Stable…" only in the Chinese Lab build; it opens the same StableCopyDialog the side-panel menu opens.
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
const BUTTON = 'Copy profile from Stable…'

describe('Settings: Copy profile from Stable', () => {
  it('Chinese Lab shows the section and the button opens the dialog', async () => {
    await openSettings('lab', 'zh')
    expect(screen.getByRole('heading', { name: 'Stable' })).toBeInTheDocument()
    expect(screen.getByText('Copy your profile from Stable into Lab. Stable is not changed.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    expect(await screen.findByRole('dialog', { name: 'Copy profile from Stable' })).toBeInTheDocument()
  })
  for (const [channel, language] of [['lab', 'ja'], ['lab', 'ko'], ['stable', 'zh']] as const) {
    it(`${channel} ${language} does not show it`, async () => {
      await openSettings(channel, language)
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Stable' })).toBeNull()
    })
  }
})
