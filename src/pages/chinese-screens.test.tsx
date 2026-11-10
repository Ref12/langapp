// @vitest-environment jsdom
// The visible text of four screens for the seeded Chinese learner (src/core/profiles/fixtures/learner.ts): Overview, the Lessons list,
// Practice start and Settings. Text only (no markup), one line per text node, so a later label change shows as a changed line in
// __screens__/<name>.txt. The clock is fixed (Date only) so "due" and "ago" wording cannot drift.
// To accept a deliberate change, review the diff and run:  npx vitest run src/pages/chinese-screens.test.tsx -u
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { learnerFixture, T0 } from '../core/profiles/fixtures/learner'
import { resetBackupStateForTests } from '../core/backup/state'
import { initializeProfiles, restoreActiveSnapshot } from '../core/profiles/store'

const FIXED_REVISION = '00000000-0000-4000-8000-000000000102'

function visibleText(root: Element): string {
  const lines: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement
    if (!element || ['SCRIPT', 'STYLE'].includes(element.tagName)) continue
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) lines.push(text)
  }
  return lines.join('\n') + '\n'
}

async function screenText(route: string, ready: () => unknown): Promise<string> {
  window.location.hash = '#' + route
  render(<App />)
  await waitFor(ready)
  const main = () => visibleText(document.querySelector('main') ?? document.body)
  // wait until the page stops changing (live queries settle)
  let last = main()
  for (let n = 0; n < 40; n++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const now = main()
    if (now === last && n > 2) return now
    last = now
  }
  return last
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
