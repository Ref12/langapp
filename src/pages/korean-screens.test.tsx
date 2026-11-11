// @vitest-environment jsdom
// The visible text of the Overview, the Lessons page, the Lessons list and a lesson page in a Korean build, for a small seeded learner. Next to japanese-screens.test.tsx; the same walk
// of the page text, pinned in __screens__/ko-<name>.txt. None of the screens may speak of Mandarin, Chinese, pinyin or HSK. To accept a deliberate
// change, review the diff and run with -u.
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
  it('Settings offers Hangul only or Hangul with romanization', async () => {
    await pin('settings', await screenText('settings', () => expect(screen.getByText('Hangul with romanization', { exact: false })).toBeInTheDocument()))
    // The option labels are short enough for a phone-width select; the example sits under it for the chosen style.
    const readings = screen.getByRole('combobox', { name: /^Readings/ }) as HTMLSelectElement
    expect([...readings.options].map(option => option.text)).toEqual(['Hangul only', 'Hangul with romanization'])
    expect(Math.max(...[...readings.options].map(option => option.text.length))).toBeLessThanOrEqual(26)
    expect(screen.getByTestId('reading-example')).toHaveTextContent('Example: \uacf5\ubd80\ud574\uc694 gongbuhaeyo')
  })
  it('A lesson page with Hangul only has no romanization line', async () => {
    await db.preferences.update('workspace', { readingStyle: 'hangul' })
    const text = await screenText(`lessons/group/${groupIds()[4]}`, () => expect(document.querySelector('.word-card')).toBeTruthy())
    expect(text).not.toMatch(/\buri\b/)
    await pin('lesson-hangul-only', text)
  })
  it('A lesson page', async () => {
    await pin('lesson', await screenText(`lessons/group/${groupIds()[4]}`, () => expect(document.querySelector('.word-card')).toBeTruthy()))
  })
  it('A lesson page with the dictionary form chosen', async () => {
    await savePreferences({ displayForm: 'dict' })
    const text = await screenText(`lessons/group/${groupIds()[4]}`, () => expect(document.querySelector('.word-card')).toBeTruthy())
    expect(text).toContain('일하다')
    await pin('lesson-dictionary-form', text)
  })
  it('Practice start, before anything is learned', async () => {
    await db.knowledge.clear(); await db.studyCards.clear()
    await pin('practice-start', await screenText('practice', () => expect(screen.getByText('Learning from')).toBeInTheDocument()))
  })
  it('Practice by skill, for a learner who knows some lessons', async () => {
    const text = await screenText('practice', () => expect(screen.getByText('Practice by skill')).toBeInTheDocument())
    for (const absent of ['written by your own AI model', 'Hands-free', 'Classic practice', 'Mahjong']) expect(text).not.toContain(absent)
    await pin('practice-by-skill', text)
  })
  // Skipped 2026-11-11: the pinned item counts of this page differ under load (seen in a session on 2026-11-10 and in Pages run
  // 43066983523 on a docs-only commit). Re-enable once the page's counts are awaited deterministically before the snapshot.
  it.skip('The Ready page of a session, with the Writing preset', async () => {
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
    expect(document.querySelectorAll('.tile-bank .tile').length).toBeGreaterThanOrEqual(2)
    vi.restoreAllMocks()
  }, 30000)
  it('Practice: a typed-romanization question', async () => {
    saveCustomPreset({ id: 'custom-reading', name: 'Romanization only', forms: ['pinyin'], stages: ['recall'] })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'custom-reading' })
    const question = await screenText(`practice/set/${id}/engine`, () => expect(screen.getByPlaceholderText('Type the romanization')).toBeInTheDocument())
    // The word is drawn at random from the lesson's new words: the pin masks it.
    await pin('practice-type-reading', question.replace(/(Type the romanization\n)[^\n]+/, '$1<word>'))
    expect(document.querySelector('.engine-pinyin-preview')).toBeNull()
    expect(document.querySelector('.engine-pinyin-hint')).toHaveTextContent('Type the romanization, with or without spaces and hyphens (gongbuhaeyo).')
    // a wrong answer: marked wrong, the romanization shown
    fireEvent.change(screen.getByPlaceholderText('Type the romanization'), { target: { value: 'zzz' } })
    fireEvent.click(document.querySelector('.check-answer-button')!)
    expect(await screen.findByText('Not the reading.')).toBeInTheDocument()
    expect(screen.getByText(/The romanization is/)).toBeInTheDocument()
  }, 30000)
  it('Practice: a Conjugate question', async () => {
    saveCustomPreset({ id: 'custom-conjugate', name: 'Conjugate only', forms: ['conjugate'], stages: ['produce'] })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await setEngineChoice(id, { preset: 'custom-conjugate' })
    const question = await screenText(`practice/set/${id}/engine`, () => expect(screen.getByTestId('conjugate-prompt')).toBeInTheDocument())
    // The word, its form and the meaning are drawn at random from what the lessons so far teach, and the tiles are shuffled: the pin masks them.
    await pin('practice-conjugate', question.replace(/(Conjugate\n)[\s\S]*?(Tap the tiles in order to build the form\.\n)[\s\S]*?(Check answer)/, '$1<word, form, meaning>\n$2<tiles>\n$3'))
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
})

describe('the Korean Dictionary: lesson words first, the TOPIK words as look-up', () => {
  const open = async (route = 'dictionary') => {
    window.location.hash = '#' + route
    render(<App />)
    await waitFor(() => expect(document.querySelector('[data-unit]')).toBeTruthy(), { timeout: 8000 })
  }
  const lookupCards = () => [...document.querySelectorAll('[data-lookup]')] as HTMLElement[]
  const type = (query: string) => fireEvent.change(screen.getByRole('searchbox', { name: 'Search dictionary' }), { target: { value: query } })
  it('opens on the lesson words, with Vocabulary and Grammar and the Korean wording', async () => {
    const text = await screenText('dictionary', () => expect(document.querySelector('[data-unit]')).toBeTruthy())
    // a lesson word's meaning (Chinese language) is lesson content, not the page's own wording
    expect(text.split('\n').filter(line => FORBIDDEN.test(line) && line !== 'Chinese language').map(line => line.slice(0, 160))).toEqual([])
    await expect(text).toMatchFileSnapshot('./__screens__/ko-dictionary.txt')
    cleanup()
    await open()
    expect(within(screen.getByRole('group', { name: 'Dictionary section' })).getAllByRole('button').map(button => button.textContent)).toEqual([expect.stringMatching(/^Vocabulary \(\d+\)$/), expect.stringMatching(/^Grammar \(\d+\)$/)])
    expect(screen.queryByRole('button', { name: /Draw|Characters|Phrases/ })).toBeNull()
    expect(screen.getByPlaceholderText('Word, romanization, or English')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Words shown' })).getByRole('button', { name: /^Lesson words/ })).toHaveAttribute('aria-pressed', 'true')
    expect(lookupCards()).toHaveLength(0)
    expect(document.querySelector('.page-footnote')?.textContent).toContain('National Institute of Korean Language')
  })
  it('All words adds the TOPIK words as look-up cards without Add to study', async () => {
    await open()
    const lessonCount = Number(/\((\d+)\)/.exec(screen.getByRole('button', { name: /^Lesson words/ }).textContent!)![1])
    fireEvent.click(screen.getByRole('button', { name: /^All words/ }))
    // the lesson words come first and the list is paged: the look-up cards are reached by a search
    await waitFor(() => expect(Number(/\((\d[\d,]*)\)/.exec(screen.getByRole('button', { name: /^All words/ }).textContent ?? '')?.[1].replace(',', ''))).toBeGreaterThan(lessonCount + 8000), { timeout: 8000 })
    expect(document.querySelectorAll('article').length).toBeLessThanOrEqual(48)
    type('ㅎㅅ')
    await waitFor(() => expect(lookupCards().length).toBeGreaterThan(0), { timeout: 8000 })
    for (const card of lookupCards()) {
      expect(card).toHaveTextContent('Look-up only')
      expect(card.textContent).toMatch(/TOPIK [1-6]/)
      expect(within(card).queryByRole('button', { name: /knowledge set|study/i })).toBeNull()
      expect(card.querySelector('.word-meaning')!.textContent!.length).toBeLessThanOrEqual(80)
    }
  })
  it.each([['학생'], ['haksaeng'], ['student'], ['ㅎㅅ']])('a search for %s lists the lesson word 학생 first', async query => {
    await open()
    type(query)
    await waitFor(() => expect(document.querySelector('[data-unit]')?.querySelector('h3')?.textContent).toContain('학생'), { timeout: 8000 })
    expect(document.querySelector('article')!.hasAttribute('data-unit')).toBe(true)
  })
  it('a search shows a lesson word and look-up words, and a look-up card opens to its full definition', async () => {
    await open()
    type('ㅎㅅ')
    await waitFor(() => expect(lookupCards().length).toBeGreaterThan(0), { timeout: 8000 })
    expect(document.querySelector('article')!.hasAttribute('data-unit')).toBe(true)
    const card = lookupCards().find(item => item.querySelector('details')) ?? lookupCards()[0]
    const details = card.querySelector('details')
    expect(details).toBeTruthy()
    expect(details!.textContent!.length).toBeGreaterThan(card.querySelector('.word-meaning')!.textContent!.length)
  })
  it('shows a repeated headword once, with its senses', async () => {
    await open()
    type('가깝다')
    await waitFor(() => expect(lookupCards().length + document.querySelectorAll('[data-unit]').length).toBeGreaterThan(0), { timeout: 8000 })
    const forms = [...document.querySelectorAll('article h3')].map(heading => heading.textContent)
    expect(forms.filter(form => form === '가깝다').length).toBeLessThanOrEqual(1)
  })
})
