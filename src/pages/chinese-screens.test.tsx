// @vitest-environment jsdom
// The visible text of four screens for the seeded Chinese learner (src/core/profiles/fixtures/learner.ts): Overview, the Lessons list,
// Practice start and Settings. Text only (no markup), one line per text node, so a later label change shows as a changed line in
// __screens__/<name>.txt. The clock is fixed (Date only) so "due" and "ago" wording cannot drift.
// To accept a deliberate change, review the diff and run:  npx vitest run src/pages/chinese-screens.test.tsx -u
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { settledText } from './screen-settle'
import { db, initializeWorkspace } from '../core/database'
import { learnerFixture, T0 } from '../core/profiles/fixtures/learner'
import { resetBackupStateForTests } from '../core/backup/state'
import { initializeProfiles, restoreActiveSnapshot } from '../core/profiles/store'

const FIXED_REVISION = '00000000-0000-4000-8000-000000000102'


// the build's commit hash changes with every commit, so it is not part of the pinned text
function maskBuild(text: string): string {
  return text.replace(/(· commit\n)[0-9a-f]{7,40}/, '$1<commit>')
}

async function screenText(route: string, ready: () => unknown): Promise<string> {
  window.location.hash = '#' + route
  render(<App />)
  await waitFor(ready)
  return maskBuild(await settledText())
}

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

describe('screen text for the seeded Chinese learner', () => {
  it('Overview', async () => {
    await expect(await screenText('overview', () => expect(screen.getByLabelText('Your actual learning progress')).toBeInTheDocument())).toMatchFileSnapshot('./__screens__/overview.txt')
  })
  it('Lessons list', async () => {
    await expect(await screenText('lessons/list', () => expect(document.querySelector('main')?.textContent?.length).toBeGreaterThan(50))).toMatchFileSnapshot('./__screens__/lessons-list.txt')
  })
  it('Practice start', async () => {
    await expect(await screenText('practice', () => expect(document.querySelector('main')?.textContent?.length).toBeGreaterThan(50))).toMatchFileSnapshot('./__screens__/practice-start.txt')
  })
  it('Settings', async () => {
    await expect(await screenText('settings', () => expect(document.querySelector('main')?.textContent?.length).toBeGreaterThan(50))).toMatchFileSnapshot('./__screens__/settings.txt')
  })
})
