import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { savePreferences } from '../core/learning'
import { resetProfileStorage } from '../test/profile-storage'

// History and Overview in the Chinese build with the language switch: each language is its own world.
const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../core/ai/structured', () => structured)

const at = Date.now() - 5000
const lesson = (id: string, refs: string[]) => ({ id, mode: 'new' as const, domain: 'reading' as const, targetRefs: refs, reviewRefs: [], exercises: [], cursor: 0, status: 'completed' as const, model: 'fixture', rejected: [], createdAt: at, completedAt: at })
const drill = (id: string, title: string, refs: string[]) => ({ id, source: 'drill' as const, title, refs, status: 'active' as const, format: 'single' as const, progress: {}, content: { state: 'pending' as const, sentences: {}, conversations: [] }, createdAt: at, updatedAt: at })
const phrase = { type: 'speech', text: '你好', locale: 'zh-Hans', meaning: 'Hello' } as const
const knowledge = (ref: string, kind: 'vocabulary' | 'grammar') => ({ ref, kind, lb: ref, band: '1' as const, addedAt: at, source: 'new' as const })

beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), getVoices: () => [], speak: vi.fn() })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  await db.exerciseSessions.bulkAdd([lesson('zh-lesson', ['vocabulary:wo3--me']), lesson('ja-lesson', ['ja:w:ja-n5-00149'])])
  await db.drillSets.bulkAdd([drill('zh-set', 'Chinese set', ['vocabulary:wo3--me']), drill('ja-set', 'Japanese set', ['ja:w:ja-n5-00149'])])
  await db.practiceHistory.put({ text: phrase.text, phrase, rate: 1, lastOpenedAt: at } as never)
  await db.knowledge.bulkAdd([knowledge('vocabulary:wo3--me', 'vocabulary'), knowledge('ja:w:ja-n5-00149', 'vocabulary'), knowledge('ja:w:ja-n5-00150', 'vocabulary'), knowledge('ja:g:wa', 'grammar')])
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const open = async (route: string, language?: string) => {
  if (language) await savePreferences({ currentLanguage: language, startedTracks: ['ja', 'ko'] })
  window.location.hash = route
  render(<App />)
}
const rowNames = () => [...document.querySelectorAll('.phrase-history-entry strong')].map(item => item.textContent)

describe('History by language', () => {
  it('Chinese selected: the Chinese lesson, practice set and phrase only', async () => {
    await open('#history', 'zh')
    await screen.findByText('Chinese set')
    expect(screen.queryByText('Japanese set')).toBeNull()
    expect(rowNames().filter(name => name === 'New items')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Practice 你好' })).toBeInTheDocument()
  })
  it('an old Japanese selection no longer selects anything: the Chinese build shows its Chinese rows and hides the ja: ones', async () => {
    await open('#history', 'ja')
    await screen.findByText('Chinese set')
    expect(screen.queryByText('Japanese set')).toBeNull()
    expect(rowNames().filter(name => name === 'New items')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Practice 你好' })).toBeInTheDocument()
  })
})

describe('Overview by language', () => {
  const stats = () => screen.getByLabelText('Your actual learning progress')
  it('Chinese selected: counts the Chinese knowledge and lessons', async () => {
    await open('#overview', 'zh')
    await waitFor(() => expect(stats()).toHaveTextContent('1words in your knowledge set'))
    expect(stats()).toHaveTextContent('0 grammar')
    expect(stats()).toHaveTextContent('1new-item lessons finished')
  })
  it('an old Japanese selection no longer selects anything: the counts are the Chinese ones, the ja: rows are not counted', async () => {
    await open('#overview', 'ja')
    await waitFor(() => expect(stats()).toHaveTextContent('1words in your knowledge set'))
    expect(stats()).toHaveTextContent('0 grammar')
    expect(stats()).toHaveTextContent('1new-item lessons finished')
  })
})

describe('Pick up where you left off, by language', () => {
  it('lists only the unfinished lessons of the language in use', async () => {
    await db.exerciseSessions.bulkAdd([
      { ...lesson('zh-open', ['vocabulary:wo3--me']), status: 'active' as const, completedAt: undefined },
      { ...lesson('ja-open', ['ja:w:ja-n5-00149']), status: 'active' as const, completedAt: undefined },
    ])
    await open('#lessons', 'zh')
    await screen.findByText('Pick up where you left off')
    expect(document.querySelector('a[href="#lessons/session/zh-open"]')).not.toBeNull()
    expect(document.querySelector('a[href="#lessons/session/ja-open"]')).toBeNull()
  })
})
