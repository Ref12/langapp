import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from './database'
import { resetProfileStorage } from '../test/profile-storage'
import { allRows, expectedChinese, fixtureJson, isOtherLanguage, stableView } from './main-made-profile.helpers'

// The database as main left it, rows written straight into IndexedDB (not through any Stable import path), then opened and shown by Stable.
const REVIEW_LABEL = /./

/** What only main's other-language code can show: a ja:/ko: ref, a kana or hangul character, or the names of main's tracks and settings. */
const OTHER_LANGUAGE_TEXT = /\b(ja|ko):[a-z]|[\u3040-\u30ff\uac00-\ud7af]|Japanese|Korean|romaji|kana/

async function seedMainRows() {
  const tables = fixtureJson<Record<string, Record<string, unknown>[]>>('idb-rows.json')
  for (const [name, rows] of Object.entries(tables)) {
    if (name === 'aiConnections' || name === 'backupConfig') continue
    await (db as unknown as Record<string, { clear(): Promise<void>; bulkPut(rows: unknown[]): Promise<unknown> }>)[name].bulkPut(rows)
  }
  // The rows main's other tracks also leave: a Korean lesson, a finished Japanese conjugate session in the exercise tables, a Japanese conversation.
  await db.lessons.put({ lessonId: 'ko:lesson:2', startedAt: 5, completedAt: 6 })
  await db.exerciseSessions.put({ id: 'ja-conjugate', mode: 'new', domain: 'reading', targetRefs: ['ja:w:ja-n5-00679'], reviewRefs: [], exercises: [{ id: 'cj', type: 'conjugate', targets: ['ja:w:ja-n5-00679'], lemma: '食べる' }],
    cursor: 1, status: 'completed', model: '', rejected: [], createdAt: 10, completedAt: 11, language: 'ja' } as never)
  await db.exerciseAttempts.put({ id: 'ja-conjugate:0', sessionId: 'ja-conjugate', index: 0, refs: ['ja:w:ja-n5-00679'], response: '食べます', correct: true, createdAt: 10 } as never)
  await db.assistantThreads.put({ id: 'ja-thread', title: 'Ja', draft: '', mode: 'conversation', shadowIntent: 'new-phrase', source: { text: 'こんにちは', title: 't', route: 'a/b', language: 'ja' }, romanization: false, speechRate: 1, returnRoute: 'dictionary', createdAt: 1, updatedAt: 2 } as never)
}

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  await seedMainRows()
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), getVoices: () => [], speak: vi.fn() })
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Stable opens the database main left behind', () => {
  it('reads no error and exactly the Chinese state main showed', async () => {
    expect(await stableView()).toEqual(expectedChinese())
  })

  it.each(['overview', 'lessons', 'review', 'practice', 'history', 'dictionary', 'settings', 'curriculum'])('shows only Chinese state on #%s', async route => {
    await act(async () => { window.location.hash = '#' + route })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('main')?.textContent?.length).toBeGreaterThan(20))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)) })
    const text = container.textContent ?? ''
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toMatch(/could not|failed|invalid|error/i)
    expect(text).not.toMatch(OTHER_LANGUAGE_TEXT)
    expect(REVIEW_LABEL.test(text)).toBe(true)
  })

  it('counts only the two Chinese lesson sessions in History', async () => {
    await act(async () => { window.location.hash = '#history' })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('main')?.textContent?.length).toBeGreaterThan(20))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    expect(container.textContent).not.toMatch(/ja-conjugate|食べ/)
    expect(expectedChinese().exerciseSessions.map(row => row.id).some(isOtherLanguage)).toBe(false)
  })

  it('keeps the other-language rows exactly as they were, field for field, after a database upgrade check', async () => {
    const before = await allRows()
    await act(async () => { window.location.hash = '#overview' })
    render(<App />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    expect(await allRows()).toEqual(before)
  })
})
