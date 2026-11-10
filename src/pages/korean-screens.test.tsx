// @vitest-environment jsdom
// The visible text of the Overview, the Lessons page, the Lessons list and a lesson page in a Korean build, for a small seeded learner. Next to japanese-screens.test.tsx; the same walk
// of the page text, pinned in __screens__/ko-<name>.txt. None of the screens may speak of Mandarin, Chinese, pinyin or HSK. To accept a deliberate
// change, review the diff and run with -u.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../core/study/catalog'
import { resetBackupStateForTests } from '../core/backup/state'
import { initializeProfiles } from '../core/profiles/store'
import { T0 } from '../core/profiles/fixtures/learner'
import type { KnowledgeEntry, StudyCard } from '../core/study/contracts'

const DAY = 86_400_000

const FORBIDDEN = /Mandarin|Chinese|pinyin|HSK/i

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
const maskBuild = (text: string) => text.replace(/(· commit\n)[0-9a-f]{7,40}/, '$1<commit>')

async function screenText(route: string, ready: () => unknown): Promise<string> {
  window.location.hash = '#' + route
  render(<App />)
  await waitFor(ready, { timeout: 8000 })
  const main = () => visibleText(document.querySelector('main') ?? document.body)
  let last = main()
  for (let n = 0; n < 60; n++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const now = main()
    if (now === last && n > 4) return maskBuild(now)
    last = now
  }
  return maskBuild(last)
}

let catalog: Catalog
const groupIds = () => catalog.orderedGroups.map(item => item.group.id)

beforeEach(async () => {
  setBuildLanguageForTests('ko')
  resetCatalogCache()
  catalog = await loadCatalog()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
  // a small learner: the first four lessons' items are known, the rest new
  const units = catalog.orderedGroups.slice(0, 4).flatMap(item => item.group.units.map(unit => catalog.units.get(`${unit.kind}:${unit.ref}`)).filter(Boolean))
  const knowledge: KnowledgeEntry[] = []
  const cards: StudyCard[] = []
  for (const [i, unit] of units.entries()) {
    if (!unit) continue
    const addedAt = T0 - (units.length - i) * (DAY / 3)
    knowledge.push({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt, source: 'new' })
    cards.push({ id: unit.ref + ':reading', ref: unit.ref, domain: 'reading', due: T0 + (i % 5 - 2) * DAY, stability: 2 + (i % 4), difficulty: 5, reps: 2, lapses: 0, state: 'review', lastReview: T0 - DAY, updatedAt: T0 - DAY })
  }
  await db.knowledge.bulkPut(knowledge)
  await db.studyCards.bulkPut(cards)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('screen text of the Korean build for a small seeded learner', () => {
  const pin = async (name: string, text: string) => {
    expect(text.split('\n').filter(line => FORBIDDEN.test(line)).map(line => line.slice(0, 160))).toEqual([])
    await expect(text).toMatchFileSnapshot(`./__screens__/ko-${name}.txt`)
  }
  it('Overview shows real counts, not the empty message', async () => {
    const text = await screenText('overview', () => expect(screen.getByLabelText('Your actual learning progress')).toBeInTheDocument())
    expect(text).not.toContain('Lessons are on their way for Korean.')
    expect(text).toContain('87')
    await pin('overview', text)
  })
  it('Lessons shows the next group', async () => {
    const text = await screenText('lessons', () => expect(screen.getByText(/of 87/)).toBeInTheDocument())
    expect(text).not.toContain('Lessons are on their way for Korean.')
    await pin('lessons', text)
  })
  it('Lessons list', async () => {
    await pin('lessons-list', await screenText('lessons/list', () => expect(screen.getByText('Level 1')).toBeInTheDocument()))
  })
  it('A lesson page', async () => {
    await pin('lesson', await screenText(`lessons/group/${groupIds()[4]}`, () => expect(document.querySelector('.word-card')).toBeTruthy()))
  })
})
