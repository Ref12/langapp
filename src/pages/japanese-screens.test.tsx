// @vitest-environment jsdom
// The visible text of the Overview, the Lessons list, a lesson page and Settings in a Japanese build, for a small seeded Japanese
// learner. Next to chinese-screens.test.tsx; the same walk of the page text, pinned in __screens__/ja-<name>.txt. None of the
// screens may speak of Mandarin, Chinese, pinyin or HSK. To accept a deliberate change, review the diff and run with -u.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    // nothing of the Chinese-only extras: no model notice, no Hands-free or Classic links (the writing backlog is on: Japanese writes with its own stroke data)
    for (const absent of ['written by your own AI model', 'Hands-free', 'Classic practice', 'Mahjong']) expect(text).not.toContain(absent)
    expect(text).toContain('Characters to write')
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
  it('Practice: a Conjugate question', async () => {
    saveCustomPreset({ id: 'custom-conjugate', name: 'Conjugate only', forms: ['conjugate'], stages: ['produce'] })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'custom-conjugate' })
    const question = await screenText(`practice/set/${id}/engine`, () => expect(screen.getByTestId('conjugate-prompt')).toBeInTheDocument())
    // The word, its form and the meaning are drawn at random from what the lessons so far teach, and the tiles are shuffled: the pin masks them. The word is shown as the learner reads verbs (polite).
    await pin('practice-conjugate', question.replace(/(Conjugate\n)[\s\S]*?(Tap the tiles in order to build the form\.\n)[\s\S]*?(Check answer)/, '$1<word, form, meaning>\n$2<tiles>\n$3'))
    expect(screen.getByTestId('conjugate-prompt')).toHaveTextContent(/ます/)
  }, 30000)
  it('Practice: a Which form is this? question', async () => {
    saveCustomPreset({ id: 'custom-form-pick', name: 'Which form only', forms: ['form-pick'], stages: ['recognise'] })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'custom-form-pick' })
    const question = await screenText(`practice/set/${id}/engine`, () => expect(screen.getByTestId('form-pick-prompt')).toBeInTheDocument())
    // The sentence's word and the options are drawn at random: the pin masks them.
    await pin('practice-form-pick', question.replace(/(Which form is this\?\n)[\s\S]*?(Check answer)/, '$1<inflected word, reading>\nChoose the word and form\n<options>\n$2'))
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(3)
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

describe('the Japanese Dictionary (the own-language branch: the pack catalog, UnitCard and plain refs)', () => {
  const open = async (route = 'dictionary') => {
    window.location.hash = '#' + route
    render(<App />)
    await waitFor(() => expect(document.querySelector('[data-unit]')).toBeTruthy(), { timeout: 8000 })
  }
  const search = async (query: string) => {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search dictionary' }), { target: { value: query } })
    await waitFor(() => expect(document.querySelector('[data-unit="vocabulary:taberu--eat"]')).toBeTruthy())
  }
  const card = () => document.querySelector('[data-unit="vocabulary:taberu--eat"]') as HTMLElement

  it('opens with Vocabulary and Grammar only, scoped to the lessons, in the Japanese app words', async () => {
    await open()
    const sections = within(screen.getByRole('group', { name: 'Dictionary section' })).getAllByRole('button').map(button => button.textContent)
    expect(sections).toEqual(['Vocabulary (292)', 'Grammar (115)'])
    expect(within(screen.getByRole('group', { name: 'Dictionary scope' })).getAllByRole('button').map(button => button.textContent)).toEqual(['Full list', expect.stringMatching(/^My knowledge set/), expect.stringMatching(/^In .*\(\d+\)$/)])
    expect(screen.queryByRole('button', { name: /Draw/ })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('292 items')
    // the page's own words (a word's meaning, such as 中国語 = Chinese language, is lesson content)
    const chrome = document.querySelector('main')!.cloneNode(true) as HTMLElement
    chrome.querySelectorAll('.word-grid').forEach(grid => grid.remove())
    const text = visibleText(chrome)
    expect(text.split('\n').filter(line => FORBIDDEN.test(line) || /tone|JLPT/i.test(line))).toEqual([])
    expect(screen.getByLabelText('Band')).toBeTruthy()
    expect(screen.getByRole('option', { name: /^Level 1 \(292\)$/ })).toBeTruthy()
  })
  it('never reads the old Japanese dictionary file or the old refs', async () => {
    const other = await import('../core/dictionary/other')
    const spy = vi.spyOn(other, 'loadDictionary')
    await open()
    expect(spy).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="dictionary-results"]')).toBeNull()
    expect(document.querySelector('.phrase-word-link')).toBeNull()
  })
  it('lands on Vocabulary from a link to a section that is off', async () => {
    await open('dictionary/characters/all')
    expect(within(screen.getByRole('group', { name: 'Dictionary section' })).getByRole('button', { name: /Vocabulary/ })).toHaveAttribute('aria-pressed', 'true')
    cleanup()
    await open('dictionary/phrases/all')
    expect(screen.getByRole('status')).toHaveTextContent('292 items')
    cleanup()
    await open('dictionary/vocabulary/media')
    expect(screen.queryByText('From your media')).toBeNull()
  })
  it.each([['たべ'], ['食'], ['taberu'], ['eat'], ['食べます'], ['食べる']])('finds 食べる by %s', async query => {
    await open()
    await search(query)
    expect(card()).toBeTruthy()
  })
  it('shows a verb in the polite form, and in the dictionary form once the setting says so', async () => {
    await open()
    await search('taberu')
    expect(within(card()).getByRole('heading', { level: 3 })).toHaveTextContent('食べます')
    expect(card()).toHaveTextContent('たべます')
    cleanup()
    await savePreferences({ displayForm: 'dict' })
    await open()
    await search('taberu')
    expect(within(card()).getByRole('heading', { level: 3 })).toHaveTextContent('食べる')
    expect(within(card()).getByRole('heading', { level: 3 })).not.toHaveTextContent('食べます')
  })
  it('shows kana readings, and romaji once the setting says so', async () => {
    await open()
    await search('taberu')
    expect(card().querySelector('.study-pinyin')).toHaveTextContent('たべます')
    cleanup()
    await savePreferences({ readingStyle: 'romaji' })
    await open()
    await search('taberu')
    expect(card().querySelector('.study-pinyin')).toHaveTextContent('tabemasu')
  })
  it('offers the forms view and links to the lesson that teaches a form', async () => {
    await open()
    await search('taberu')
    const forms = card().querySelector('details.word-forms') as HTMLElement
    expect(forms).toBeTruthy()
    const rows = [...forms.querySelectorAll('tbody tr')]
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(forms.textContent).toContain('食べる')
    expect(forms.textContent).toContain('食べます')
    const links = [...forms.querySelectorAll('a')].map(link => link.getAttribute('href'))
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) expect(href).toMatch(/^#lessons\/group\//)
  })
  it('opens the Grammar section', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Grammar/ }))
    await waitFor(() => expect(document.querySelector('[data-unit^="grammar:"]')).toBeTruthy())
    expect(screen.getByRole('status')).toHaveTextContent('115 items')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search dictionary' }), { target: { value: 'desu' } })
    await waitFor(() => expect(document.querySelector('[data-unit="grammar:n-desu--noun"]')).toBeTruthy())
  })
  it('adds a word to study from the Dictionary: it is learning, in the knowledge set and has a plain knowledge row', async () => {
    const known = new Set((await db.knowledge.toArray()).map(row => row.ref))
    expect(known.has('vocabulary:taberu--eat')).toBe(false)
    await open()
    await search('taberu')
    expect(card()).toHaveTextContent('Not in knowledge set')
    fireEvent.click(within(card()).getByRole('button', { name: 'Add to knowledge set' }))
    await waitFor(async () => expect((await db.knowledge.toArray()).some(row => row.ref === 'vocabulary:taberu--eat' && row.kind === 'vocabulary')).toBe(true))
    await waitFor(() => expect(card()).toHaveTextContent('In your knowledge set'))
    expect(card()).toHaveTextContent('Eligible for review')
    expect((await db.studyCards.toArray()).some(row => row.ref === 'vocabulary:taberu--eat')).toBe(true)
    cleanup()
    await open('dictionary/vocabulary/knowledge')
    await search('taberu')
    expect(screen.getByRole('button', { name: /^My knowledge set/ })).toHaveAttribute('aria-pressed', 'true')
    expect(card()).toBeTruthy()
  })
})
