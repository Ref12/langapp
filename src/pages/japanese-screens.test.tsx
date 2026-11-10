// @vitest-environment jsdom
// The visible text of the Overview, the Lessons list, a lesson page and Settings in a Japanese build, for a small seeded Japanese
// learner. Next to chinese-screens.test.tsx; the same walk of the page text, pinned in __screens__/ja-<name>.txt. None of the
// screens may speak of Mandarin, Chinese, pinyin or HSK. To accept a deliberate change, review the diff and run with -u.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../core/study/catalog'
import { resetBackupStateForTests } from '../core/backup/state'
import { savePreferences } from '../core/learning'
import { createDrillSet, setEngineChoice } from '../core/drills/store'
import { whenContent } from '../core/drills/content'
import { saveCustomPreset } from '../core/session/custom-preset'
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
  setBuildLanguageForTests('ja')
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
  // a small learner: the first four lessons' items are known, one of them learned, the rest new
  const units = catalog.orderedGroups.slice(0, 4).flatMap(item => item.group.units.map(unit => catalog.units.get(`${unit.kind === 'vocabulary' ? 'vocabulary' : 'grammar'}:${unit.ref}`)).filter(Boolean))
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

describe('screen text for a small seeded Japanese learner', () => {
  const pin = async (name: string, text: string) => {
    expect(text.split('\n').filter(line => FORBIDDEN.test(line)).map(line => line.slice(0, 160))).toEqual([])
    await expect(text).toMatchFileSnapshot(`./__screens__/ja-${name}.txt`)
  }
  it('Overview', async () => {
    await pin('overview', await screenText('overview', () => expect(screen.getByLabelText('Your actual learning progress')).toBeInTheDocument()))
  })
  it('Lessons list', async () => {
    await pin('lessons-list', await screenText('lessons/list', () => expect(screen.getByText('Level 1')).toBeInTheDocument()))
  })
  it('A lesson page', async () => {
    await pin('lesson', await screenText(`lessons/group/${groupIds()[4]}`, () => expect(document.querySelector('.word-card')).toBeTruthy()))
  })
  it('A lesson page with the dictionary form chosen', async () => {
    await savePreferences({ displayForm: 'dict' })
    await pin('lesson-dictionary-form', await screenText(`lessons/group/${groupIds()[4]}`, () => expect(document.querySelector('.word-card')).toBeTruthy()))
  })
  it('A lesson page with romaji chosen', async () => {
    await savePreferences({ readingStyle: 'romaji' })
    await pin('lesson-romaji', await screenText(`lessons/group/${groupIds()[0]}`, () => expect(document.querySelector('.word-card')).toBeTruthy()))
  })
  it('Practice start, before anything is learned', async () => {
    await db.knowledge.clear(); await db.studyCards.clear()
    await pin('practice-start', await screenText('practice', () => expect(screen.getByText('Learning from')).toBeInTheDocument()))
  })
  it('Practice by skill, for a learner who knows some lessons', async () => {
    const text = await screenText('practice', () => expect(screen.getByText('Practice by skill')).toBeInTheDocument())
    // nothing of the Chinese-only extras: no model notice, no Hands-free or Classic links, no writing backlog
    for (const absent of ['written by your own AI model', 'Hands-free', 'Classic practice', 'Mahjong', 'Characters to write']) expect(text).not.toContain(absent)
    await pin('practice-by-skill', text)
  })
  it('The Ready page of a session, with the Writing preset', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'writing' })
    await pin('practice-ready', await screenText(`practice/set/${id}`, () => expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled()))
  })
  it('Practice: a Word order question', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05)
    saveCustomPreset({ id: 'custom-order', name: 'Word order only', forms: ['tiles'], stages: ['produce'] })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'custom-order' })
    const question = await screenText(`practice/set/${id}/engine`, () => expect(screen.getByText('Tap the tiles in order to build the sentence.')).toBeInTheDocument())
    // The sentence is drawn at random from the lesson's new words: the pin masks its English and its tiles.
    await pin('practice-word-order', question.replace(/(Build the sentence\n)[^\n]+/, '$1<English>').replace(/(Tap the tiles in order to build the sentence\.\n)[\s\S]*?(Check answer)/, '$1<tiles>\n$2'))
    expect(document.querySelectorAll('.tile-bank .tile').length).toBeGreaterThanOrEqual(3)
    vi.restoreAllMocks()
  }, 30000)
  it('Practice: a typed-reading question', async () => {
    saveCustomPreset({ id: 'custom-reading', name: 'Reading only', forms: ['pinyin'], stages: ['recall'] })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'custom-reading' })
    const question = await screenText(`practice/set/${id}/engine`, () => expect(screen.getByPlaceholderText('Type the reading')).toBeInTheDocument())
    // The word is drawn at random from the lesson's new words: the pin masks it.
    await pin('practice-type-reading', question.replace(/(Type the reading\n)[^\n]+/, '$1<word>'))
    expect(document.querySelector('.engine-pinyin-preview')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hear it' })).toBeNull()
    const kana = document.querySelector('.engine-answer + .engine-pinyin-hint, .engine-pinyin-hint')
    expect(kana).toHaveTextContent('Type the reading in kana or romaji.')
    // a wrong answer: marked wrong, the reading shown, then the Hear button
    fireEvent.change(screen.getByPlaceholderText('Type the reading'), { target: { value: 'zzz' } })
    fireEvent.click(document.querySelector('.check-answer-button')!)
    expect(await screen.findByText('Not the reading.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeInTheDocument()
  }, 30000)
  it('Settings', async () => {
    await pin('settings', await screenText('settings', () => expect(document.querySelector('main')?.textContent?.length).toBeGreaterThan(50)))
  })
})
