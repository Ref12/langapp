// @vitest-environment jsdom
// The Dictionary's Phrases section in the Japanese and Korean builds: the lesson sentences, with the pack's wording, language tag, reading column,
// search folding, lesson-range filter and ready / pending state. The Chinese section is in DictionaryPhrases.test.tsx and does not change.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../core/study/catalog'
import { resetBackupStateForTests } from '../core/backup/state'
import { savePreferences } from '../core/learning'
import { initializeProfiles } from '../core/profiles/store'
import { T0 } from '../core/profiles/fixtures/learner'
import type { KnowledgeEntry } from '../core/study/contracts'

const speech = vi.hoisted(() => ({ played: [] as string[][] }))
vi.mock('../core/assistant/speech', async importOriginal => ({ ...(await importOriginal<object>()), playBrowserSpeech: (...args: string[]) => { speech.played.push(args) } }))

let catalog: Catalog
const LANGUAGES = {
  ja: { id: 'ja', total: 820, text: 'Japanese', reading: 'Reading', placeholder: 'Japanese, reading, or English', locale: 'ja-JP', first: '私は学生です。', firstReading: 'わたしはがくせいです。', romaji: 'watashihagakuseidesu.', style: 'romaji', other: 'kana' },
  ko: { id: 'ko', total: 905, text: 'Korean', reading: 'Reading', placeholder: 'Korean, romanization, or English', locale: 'ko-KR', first: '저는 학생이에요.', firstReading: 'jeoneun haksaengieyo.', romaji: '', style: 'hangul', other: 'romanized' },
} as const

const rowOf = (text: string) => rows().find(row => row.dataset.phrase === text)!
const rows = () => [...document.querySelectorAll<HTMLElement>('tr[data-phrase]')]
const status = () => screen.getByRole('status').textContent ?? ''
const type = (query: string) => fireEvent.change(screen.getByRole('searchbox', { name: 'Search dictionary' }), { target: { value: query } })
async function open(route = 'dictionary/phrases/all', count?: number) {
  window.location.hash = '#' + route
  render(<App />)
  await waitFor(() => expect(rows().length).toBeGreaterThan(0), { timeout: 15000 })
  // the list is whole once the heading count has stopped changing
  if (count !== undefined) await waitFor(() => expect(status()).toBe(`${count} phrases`), { timeout: 15000 })
}

describe.each(Object.values(LANGUAGES))('the $id Dictionary Phrases section', lang => {
  beforeEach(async () => {
    speech.played.length = 0
    setBuildLanguageForTests(lang.id)
    resetCatalogCache()
    catalog = await loadCatalog()
    await resetBackupStateForTests()
    localStorage.clear()
    await initializeProfiles()
    await db.delete()
    await db.open()
    await initializeWorkspace()
    const units = catalog.orderedGroups.slice(0, 4).flatMap(item => item.group.units.map(unit => catalog.units.get(`${unit.kind}:${unit.ref}`)).filter(Boolean))
    const knowledge: KnowledgeEntry[] = units.map((unit, i) => ({ ref: unit!.ref, kind: unit!.kind, lb: unit!.record.lb, band: unit!.band, addedAt: T0 - (units.length - i) * 1000, source: 'new' as const }))
    await db.knowledge.bulkPut(knowledge)
  })
  afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

  it('has a Phrases tab and lists the lesson sentences, with the pack column names and language tag', async () => {
    await open()
    expect(within(screen.getByRole('group', { name: 'Dictionary section' })).getAllByRole('button').map(button => button.textContent)).toEqual([expect.stringMatching(/^Vocabulary/), expect.stringMatching(/^Grammar/), expect.stringMatching(/^Phrases \(/)])
    await waitFor(() => expect(Number(/^(\d+) phrases$/.exec(status())?.[1])).toBe(lang.total), { timeout: 15000 })
    const headers = [...document.querySelectorAll('thead th')].map(th => th.textContent)
    expect(headers.slice(0, 3)).toEqual(lang.id === 'ja' ? ['Japanese', 'Reading', 'English'] : ['Korean', 'Reading', 'English'])
    expect(screen.getByPlaceholderText(lang.placeholder)).toBeTruthy()
    const first = rowOf(lang.first)
    expect(first.querySelector('.phrase-zh')).toHaveAttribute('lang', lang.id)
    expect(first.querySelector('.phrase-zh')?.textContent).toBe(lang.first)
    expect(document.querySelector('.phrase-table [lang="zh-Hans"]')).toBeNull()
    // the page's own words (a sentence or a word's meaning is lesson content)
    for (const own of [document.querySelector('thead')!, document.querySelector('main h1')!, document.querySelector('main h1')!.parentElement!.querySelector('p')!]) expect(own.textContent).not.toMatch(/Pinyin|Mandarin|HSK|Chinese/)
    expect(document.querySelector('.phrase-links a[lang]')).toHaveAttribute('lang', lang.id)
  }, 60000)

  it('plays in the pack speech locale', async () => {
    await open()
    fireEvent.click(rowOf(lang.first).querySelector('button[aria-label^="Play"]')!)
    expect(speech.played).toEqual([['dictionary-phrases', lang.first, lang.locale]])
  }, 60000)

  it('writes the reading column as the reading setting says', async () => {
    await open()
    const cell = () => rowOf(lang.first).querySelector('.phrase-py')?.textContent
    if (lang.id === 'ja') {
      expect(cell()).toBe(lang.firstReading)
      cleanup(); await savePreferences({ readingStyle: 'romaji' }); await open()
      expect(cell()).toBe(lang.romaji)
    } else {
      // the default is Hangul with romanization
      expect(cell()).toBe(lang.firstReading)
      cleanup(); await savePreferences({ readingStyle: 'hangul' }); await open()
      expect([...document.querySelectorAll('thead th')].map(th => th.textContent)).not.toContain('Reading')
      expect(rowOf(lang.first).querySelector('.phrase-py')).toBeNull()
    }
  }, 60000)

  it('filters by lesson range', async () => {
    await open()
    const select = screen.getByLabelText('Lessons') as HTMLSelectElement
    expect(screen.queryByLabelText('Band')).toBeNull()
    expect([...select.options].map(option => option.text)).toEqual(['All lessons', '1\u201310', '11\u201320', '21\u201330', '31\u201340', '41\u201350', '51\u201360', '61\u201370', '71\u201380', '81\u201387'])
    const all = Number(/^(\d+)/.exec(status())![1])
    fireEvent.change(select, { target: { value: '1-10' } })
    await waitFor(() => expect(Number(/^(\d+)/.exec(status())![1])).toBeLessThan(all))
    for (const row of rows()) expect(row.querySelector('.phrase-state')).toBeTruthy()
    const inFirst = Number(/^(\d+)/.exec(status())![1])
    fireEvent.change(select, { target: { value: '81-87' } })
    await waitFor(() => expect(status()).not.toBe(`${inFirst} phrases`))
    expect(rows().length).toBeGreaterThan(0)
  }, 60000)

  it('is ready or pending by lesson, naming the missing words in the app language', async () => {
    await open()
    const ready = rows().find(row => row.classList.contains('ready'))
    const pending = rows().filter(row => row.classList.contains('pending')).at(-1)
    expect(ready).toBeTruthy()
    expect(within(ready!).getByText('Ready')).toBeTruthy()
    expect(pending).toBeTruthy()
    const needs = pending!.querySelector('.phrase-state .small')?.textContent ?? ''
    expect(needs).toMatch(/^ needs /)
    expect(needs).toMatch(lang.id === 'ja' ? /[\u3040-\u30ff\u3400-\u9fff]/u : /[\uac00-\ud7a3]/u)
    fireEvent.click(screen.getByRole('button', { name: /^Ready/ }))
    await waitFor(() => expect(rows().every(row => row.classList.contains('ready'))).toBe(true))
  }, 60000)
})

describe('the Japanese Phrases search', () => {
  beforeEach(async () => { setBuildLanguageForTests('ja'); resetCatalogCache(); await resetBackupStateForTests(); localStorage.clear(); await initializeProfiles(); await db.delete(); await db.open(); await initializeWorkspace() })
  afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })
  const found = async (query: string) => { type(query); await waitFor(() => expect(status()).not.toMatch(/^8\d\d phrases$/)); await new Promise(resolve => setTimeout(resolve, 100)); return rows().map(row => row.querySelector('.phrase-zh')?.textContent) }
  it.each([['gakusei'], ['gakuusei'], ['がくせい'], ['ガクセイ'], ['学生'], ['student']])('finds 私は学生です。 by %s', async query => {
    await open()
    expect(await found(query)).toContain('私は学生です。')
  }, 60000)
  it('folds long vowels in romaji (benkyou, benkyo, benkyō)', async () => {
    await open()
    const a = await found('benkyou'), b = await found('benkyo'), c = await found('benky\u014d')
    expect(a.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  }, 60000)
})

describe('the Korean Phrases search', () => {
  beforeEach(async () => { setBuildLanguageForTests('ko'); resetCatalogCache(); await resetBackupStateForTests(); localStorage.clear(); await initializeProfiles(); await db.delete(); await db.open(); await initializeWorkspace() })
  afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })
  const found = async (query: string) => { type(query); await waitFor(() => expect(status()).not.toMatch(/^9\d\d phrases$/)); await new Promise(resolve => setTimeout(resolve, 100)); return rows().map(row => row.querySelector('.phrase-zh')?.textContent) }
  it.each([['학생'], ['haksaeng'], ['ㅈㄴㅎㅅ'], ['student']])('finds 저는 학생이에요. by %s', async query => {
    await open()
    expect(await found(query)).toContain('저는 학생이에요.')
  }, 60000)
})
