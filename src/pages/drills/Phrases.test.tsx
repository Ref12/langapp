// @vitest-environment jsdom
// The Phrases choice on Practice home, in the three builds: the order, the count, what View items shows, and that Start makes exactly the viewed set.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace } from '../../core/database'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { loadCatalog, resetCatalogCache } from '../../core/study/catalog'
import { resetBackupStateForTests } from '../../core/backup/state'
import { initializeProfiles } from '../../core/profiles/store'
import { T0 } from '../../core/profiles/fixtures/learner'
import { whenContent } from '../../core/drills/content'
import { recordSkillPractice } from '../../core/study/skills'
import { loadPhrasePick } from '../../core/session/phrase-pick'
import type { KnowledgeEntry } from '../../core/study/contracts'
import type { LanguageId } from '../../core/language/ids'
import { practisedLine } from './PhraseItems'

vi.mock('../../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

async function learner(language: LanguageId, lessons: number) {
  setBuildLanguageForTests(language)
  resetCatalogCache()
  const catalog = await loadCatalog()
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  const units = catalog.orderedGroups.slice(0, lessons).flatMap(item => item.group.units.map(unit => catalog.units.get(`${unit.kind === 'vocabulary' ? 'vocabulary' : 'grammar'}:${unit.ref}`)).filter(Boolean))
  const knowledge: KnowledgeEntry[] = units.map((unit, i) => ({ ref: unit!.ref, kind: unit!.kind, lb: unit!.record.lb, band: unit!.band, addedAt: T0 - (units.length - i) * 1000, source: 'new' as const }))
  await db.knowledge.bulkPut(knowledge)
  window.location.hash = '#practice'
  return catalog
}
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe.each([['zh', 6], ['ja', 12], ['ko', 12]] as const)('Practice home Phrases (%s)', (language, lessons) => {
  let catalog: Awaited<ReturnType<typeof loadCatalog>>
  beforeEach(async () => { catalog = await learner(language, lessons) })

  it('offers Phrases beside New items and Reviews, with two orders and a count', async () => {
    const user = userEvent.setup()
    render(<App />)
    const choice = await screen.findByRole('group', { name: 'What to practise' }, { timeout: 15000 })
    expect([...choice.querySelectorAll('button')].map(button => button.textContent)).toEqual(['New items', 'Reviews', 'Phrases'])
    await user.click(screen.getByRole('button', { name: 'Phrases' }))
    const order = screen.getByRole('group', { name: 'Phrase order' })
    expect([...order.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Least practised', 'Most recent lessons first'])
    expect(screen.getByRole('button', { name: 'Least practised' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Phrases per set' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('selection-summary').textContent).toMatch(/^10 phrases · 10 never practised/), { timeout: 15000 })
  }, 40000)

  it('Start makes a Phrases set of exactly the picked phrases, which are not added to knowledge', async () => {
    const user = userEvent.setup()
    const before = await db.knowledge.count()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Phrases' }, { timeout: 15000 }))
    await waitFor(() => expect(screen.getByTestId('selection-summary').textContent).toMatch(/10 phrases/), { timeout: 15000 })
    await user.click(screen.getByRole('button', { name: 'Start practice session' }))
    await waitFor(async () => expect(await db.drillSets.count()).toBe(1), { timeout: 15000 })
    const set = (await db.drillSets.toArray())[0]
    await whenContent(set.id)
    expect(set).toMatchObject({ source: 'phrases' })
    expect(set.refs).toHaveLength(10)
    expect(set.addOnFinish).toBeUndefined()
    expect(await db.knowledge.count()).toBe(before)
  }, 40000)

  it('View items lists the phrases with their practice counts and the never-practised total', async () => {
    const first = (await loadPhrasePick(catalog, { order: 'least', count: 10, seed: 1 })).refs
    await recordSkillPractice([first[0]], ['reading'], Date.now(), true)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Phrases' }, { timeout: 15000 }))
    await waitFor(() => expect(screen.getByTestId('selection-summary').textContent).toMatch(/10 phrases/), { timeout: 15000 })
    await user.click(screen.getByRole('button', { name: /View items/ }))
    await waitFor(() => expect(document.querySelectorAll('[data-phrase-ref]').length).toBe(10), { timeout: 15000 })
    expect(screen.getByRole('heading', { name: /10 phrases · \d+ never practised/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.phrase-practised').length).toBe(10)
  }, 40000)
})

describe('practisedLine', () => {
  it('says never, or the count, the wins and the last time', () => {
    expect(practisedLine(undefined)).toBe('Never practised')
    expect(practisedLine({ count: 3, wins: 2, lastAt: new Date(2026, 10, 4).getTime() })).toBe('Practised 3 times · 2 right the first time · last 4 Nov')
    expect(practisedLine({ count: 1, wins: 0, lastAt: new Date(2026, 10, 4).getTime() })).toBe('Practised 1 time · 0 right the first time · last 4 Nov')
  })
})
