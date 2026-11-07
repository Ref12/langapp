import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { resetProfileStorage } from '../test/profile-storage'
import { createConversation } from '../core/assistant/store'
import { rememberPracticePhrase } from '../core/assistant/practice-history'
import { openPhraseActions } from '../test/phrase-actions'
import { clearVoiceCache, setSpeechVoicePreferences, stopBrowserSpeech } from '../core/assistant/speech'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../core/ai/structured', () => structured)

const phrase = { type: 'speech', text: '你好', locale: 'zh-Hans', meaning: 'Hello' } as const
beforeEach(async () => {
  await resetProfileStorage()
  await initializeWorkspace()
  window.location.hash = '#history'
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), getVoices: () => [], speak: vi.fn() })
  clearVoiceCache(); setSpeechVoicePreferences(); stopBrowserSpeech()
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); stopBrowserSpeech(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

it('lists History in top-level navigation and starts empty', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: 'No phrases yet' })
  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  const drawer = screen.getByRole('dialog', { name: 'Workspace navigation' })
  expect(within(drawer).getByRole('link', { name: 'History' })).toHaveAttribute('href', '#history')
  expect(within(drawer).getByRole('link', { name: 'Assistant' })).toHaveAttribute('href', '#conversation')
})

it('records silent openings once in StrictMode and reopens the latest playlist after navigation and reload', async () => {
  const id = await createConversation()
  await db.assistantMessages.put({
    id: 'reply', threadId: id, sequence: 0, role: 'assistant', text: '', blocks: [phrase],
    mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
  })
  window.location.hash = `#conversation/${id}`
  render(<StrictMode><App /></StrictMode>)
  const reply = await screen.findByRole('article', { name: 'Assistant reply' })
  const put = vi.spyOn(db.practiceHistory, 'put')
  fireEvent.click(openPhraseActions(reply).getByRole('button', { name: 'Practice' }))
  let popup = await screen.findByRole('dialog', { name: 'Phrase practice' })
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(await db.practiceHistory.get(phrase.text)).toMatchObject({ phrase })
  expect(speechSynthesis.speak).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(within(popup).getByRole('button', { name: 'Close practice' }))
  await waitFor(() => expect(popup).not.toBeInTheDocument())
  await go('history')
  fireEvent.click(await screen.findByRole('button', { name: `Practice ${phrase.text}` }))
  popup = await screen.findByRole('dialog', { name: 'Phrase practice' })
  await waitFor(() => expect(within(popup).getByRole('button', { name: 'Edit playlist' })).toBeEnabled())
  fireEvent.click(within(popup).getByRole('button', { name: 'Edit playlist' }))
  fireEvent.click(within(popup).getByRole('button', { name: 'Edit chunks' }))
  fireEvent.click(within(popup).getByRole('button', { name: /^Split after character 1:/ }))
  fireEvent.click(within(popup).getByRole('button', { name: 'Save chunks' }))
  await waitFor(async () => expect((await db.practiceHistory.get(phrase.text))?.chain?.ends).toEqual([1, 2]))
  expect((await db.assistantMessages.get('reply'))?.practiceChains).toBeUndefined()
  expect(await db.assistantRuns.count()).toBe(0)
  expect(await db.attempts.count()).toBe(0)
  cleanup()
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: `Practice ${phrase.text}` }))
  popup = await screen.findByRole('dialog', { name: 'Phrase practice' })
  await waitFor(() => expect(within(popup).getByRole('button', { name: 'Edit playlist' })).toBeEnabled())
  fireEvent.click(within(popup).getByRole('button', { name: 'Edit playlist' }))
  expect(within(popup).getAllByRole('button', { name: /^Play step/ })).toHaveLength(2)
  expect(await db.practiceHistory.count()).toBe(1)
})

it('reports a failed history write, remains usable, and retries without speaking', async () => {
  await rememberPracticePhrase(phrase, 0.5)
  render(<App />)
  const button = await screen.findByRole('button', { name: `Practice ${phrase.text}` })
  vi.spyOn(db.practiceHistory, 'put').mockRejectedValueOnce(new Error('Storage full'))
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('History not saved. Storage full')
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving History' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(speechSynthesis.speak).not.toHaveBeenCalled()
})

const session = {
  id: 'sess-1', mode: 'new' as const, domain: 'reading' as const, targetRefs: ['vocabulary:ni'], reviewRefs: [] as string[], cursor: 1,
  exercises: [{ id: 'e1', type: 'choice' as const, targets: ['vocabulary:ni'], direction: 'en-to-zh' as const, question: 'you', options: ['你', '我'], answer: 0, explanation: 'x' }],
  status: 'completed' as const, model: 'm', rejected: [] as string[], createdAt: 40, completedAt: 50,
}

it('shows kind chips and the standard actions, filters by kind and lessons, and persists the filter', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10)
  await rememberPracticePhrase(phrase, 1)
  vi.mocked(Date.now).mockReturnValue(20)
  await rememberPracticePhrase({ ...phrase, text: '茶', meaning: 'Tea' }, 1, undefined, undefined, 'write')
  await db.exerciseSessions.add(session as never)
  await db.exerciseAttempts.add({ id: 'a1', sessionId: 'sess-1', index: 0, refs: ['vocabulary:ni'], response: '你', correct: true, createdAt: 45 } as never)
  vi.restoreAllMocks()
  render(<App />)
  const list = await screen.findByRole('list')
  expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  expect(within(list).getAllByText('Spoken')).toHaveLength(1)
  expect(within(list).getAllByText('Written')).toHaveLength(1)
  expect(screen.getByText(/score 1\/1/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Open lesson session/ })).toHaveAttribute('href', '#lessons/session/sess-1')
  expect(openPhraseActions(list, 0).getByRole('button', { name: 'Write' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Written' }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
  expect(screen.getByRole('button', { name: 'Practice 茶' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Spoken' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Practice 你好' })).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Practice 茶' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Lessons' }))
  expect(await screen.findByRole('link', { name: /Open lesson session/ })).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect((await db.preferences.get('workspace'))?.historyFilter).toBe('lessons')
  cleanup()
  render(<App />)
  expect(await screen.findByRole('link', { name: /Open lesson session/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Lessons' })).toHaveAttribute('aria-pressed', 'true')
  await go('history') // a filter in the hash wins; a bare #history follows the saved preference
  await db.preferences.update('workspace', { historyFilter: 'write' })
  expect(await screen.findByText('茶')).toBeInTheDocument()
  expect(screen.queryByText('你好')).not.toBeInTheDocument()
})

it('shows a per-filter empty state', async () => {
  await db.preferences.update('workspace', { historyFilter: 'all' })
  await rememberPracticePhrase(phrase, 1)
  render(<App />)
  await screen.findByRole('button', { name: 'Practice 你好' })
  fireEvent.click(screen.getByRole('button', { name: 'Written' }))
  expect(await screen.findByRole('heading', { name: 'No written phrases yet.' })).toBeInTheDocument()
})

it('reopens a phrase last written in Write mode', async () => {
  await rememberPracticePhrase(phrase, 1, undefined, undefined, 'write')
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Practice 你好' }))
  const popup = await screen.findByRole('dialog', { name: 'Phrase practice' })
  expect(await within(popup).findByRole('list', { name: 'Words to write' })).toBeInTheDocument()
})

it('previews item text on a lesson row, which offers Open, Practice and Save to study set but no Redo, Practice these or Hands-free', async () => {
  await db.exerciseSessions.add({
    id: 'sess-r', mode: 'review', domain: 'reading', targetRefs: ['vocabulary:wo3--me'], reviewRefs: [], exercises: [{ id: 'c', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'x' }],
    cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: 5, completedAt: 6,
  } as never)
  render(<App />)
  const open = await screen.findByRole('link', { name: /Open lesson session/ })
  const row = open.closest('li')!
  await waitFor(() => expect(row).toHaveTextContent('我'))
  expect(row.textContent).not.toContain('--')
  expect(within(row).getByRole('link', { name: /Practice lesson session/ })).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: /Save .* to study set|Save/ })).toBeInTheDocument()
  expect(within(row).queryByRole('button', { name: /Redo|Practice these|Hands-free/ })).toBeNull()
})

const wordRefs = ['vocabulary:wo3--me', 'vocabulary:xue2-xi2--study']
const drillSet = (fields: Record<string, unknown>) => ({ id: 'ds', source: 'new', title: 'New items · 31 Oct', refs: wordRefs, status: 'active', format: 'single', progress: {}, content: { state: 'no-ai', sentences: {}, conversations: [] }, createdAt: 100, updatedAt: 100, ...fields })

it('Practice on a lesson row opens Practice home filled from that lesson: Reviews, All, and Start makes a set of exactly its refs; the source survives a reload', async () => {
  await db.exerciseSessions.add({ id: 'sess-d', mode: 'new', domain: 'reading', targetRefs: [wordRefs[0]], reviewRefs: [wordRefs[1]], exercises: [], cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: Date.UTC(2026, 9, 30, 12), completedAt: Date.UTC(2026, 9, 30, 12) } as never)
  render(<App />)
  fireEvent.click(await screen.findByRole('link', { name: 'Practice lesson session New items' }))
  await waitFor(() => expect(window.location.hash).toBe('#practice?from=lesson:sess-d'))
  const source = await screen.findByRole('combobox', { name: 'Learning from' })
  await waitFor(() => expect(source).toHaveDisplayValue(/Lesson · 30 Oct/))
  expect(screen.getByRole('button', { name: 'Reviews' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  expect(await screen.findByTestId('selection-summary')).toHaveTextContent('2 of 2 items from Lesson · 30 Oct')
  cleanup()
  render(<App />)
  await waitFor(async () => expect(await screen.findByRole('combobox', { name: 'Learning from' })).toHaveDisplayValue(/Lesson · 30 Oct/))
  fireEvent.click(await screen.findByRole('button', { name: 'Start practice session' }))
  await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/set\//))
  expect((await db.drillSets.toArray())[0].refs).toEqual(wordRefs)
})

it('Save to study set on a lesson row adds all its refs to a new study set', async () => {
  await db.exerciseSessions.add({ id: 'sess-s', mode: 'new', domain: 'reading', targetRefs: [wordRefs[0]], reviewRefs: [wordRefs[1]], exercises: [], cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: 5, completedAt: 6 } as never)
  render(<App />)
  const row = (await screen.findByRole('link', { name: /Open lesson session/ })).closest('li')!
  fireEvent.click(within(row).getByRole('button', { name: /Save/ }))
  fireEvent.click(await screen.findByRole('button', { name: /New study set/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
  await waitFor(async () => expect((await db.collectionItems.toArray()).map(item => item.ref).sort()).toEqual([...wordRefs].sort()))
})

it('lists drill sets with their items and score line, filters to Practice, and offers Practice, and Practice opens Practice home filled from the set', async () => {
  await db.drillSets.bulkAdd([
    drillSet({ id: 'ds', progress: { meanings: { results: { [wordRefs[0]]: 'got', [wordRefs[1]]: 'hint' }, scope: wordRefs, done: true, redos: 0 }, write: { results: { [wordRefs[0]]: 'missed' }, chars: { 我: { mark: 'missed', cue: wordRefs[0] } }, scope: wordRefs, done: false, redos: 0 } } }),
    drillSet({ id: 'gone', title: 'Discarded', status: 'abandoned', discarded: true, createdAt: 50 }),
    drillSet({ id: 'aside', title: 'Set aside one', status: 'abandoned', createdAt: 60 }),
  ] as never)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Practice' }))
  const row = (await screen.findByText('New items · 31 Oct')).closest('li')!
  await waitFor(() => expect(row).toHaveTextContent('学习'))
  expect(row).toHaveTextContent('我')
  expect(row).toHaveTextContent('Word meanings 2/2 · Write it 0/1')
  expect(screen.queryByText('Discarded')).toBeNull()
  expect(screen.getByText('Set aside one')).toBeInTheDocument()
  expect(within(row).getByRole('link', { name: /Resume/ })).toHaveAttribute('href', '#practice/set/ds')
  fireEvent.click(within(row).getByRole('link', { name: /^Practice New items/ }))
  await waitFor(() => expect(window.location.hash).toBe('#practice?from=drill:ds'))
  await waitFor(async () => expect(await screen.findByRole('combobox', { name: 'Learning from' })).toHaveDisplayValue(/Practice session · 1 Jan/))
  expect(await screen.findByTestId('selection-summary')).toHaveTextContent('2 of 2 items')
})

it('lists Hands-free sets (a shortcut activity) with their items, resumes a stopped one on its Hands-free activity; never-started ones stay out', async () => {
  const set = (fields: Record<string, unknown>) => ({ id: 'hf', title: 'Hands-free · 1 Nov', refs: wordRefs, source: 'review', status: 'completed', format: 'single', progress: {}, content: { state: 'pending', sentences: {}, conversations: [] }, shortcut: 'handsfree', handsfree: { seed: 1, settings: { pause: 'normal', repeats: 1 }, started: true, position: 4, done: true }, createdAt: 200, updatedAt: 200, completedAt: 200, ...fields })
  await db.drillSets.bulkAdd([set({}), set({ id: 'stopped', title: 'Hands-free · 2 Nov', status: 'active', completedAt: undefined, createdAt: 300, handsfree: { seed: 1, settings: { pause: 'normal', repeats: 1 }, started: true, position: 4, done: false } }),
    set({ id: 'fresh', title: 'Hands-free · 3 Nov', status: 'abandoned', discarded: true, createdAt: 400, handsfree: { seed: 1, settings: { pause: 'normal', repeats: 1 }, started: false, position: 0, done: false } })] as never)
  render(<App />)
  const row = (await screen.findByText('Hands-free · 1 Nov')).closest('li')!
  await waitFor(() => expect(row).toHaveTextContent('学习'))
  expect(row).toHaveTextContent('Finished')
  expect(screen.queryByText('Hands-free · 3 Nov')).toBeNull()
  expect(within(screen.getByText('Hands-free · 2 Nov').closest('li')!).getByRole('link', { name: /Resume/ })).toHaveAttribute('href', '#practice/set/stopped/handsfree')
  fireEvent.click(within(row).getByRole('link', { name: /^Practice Hands-free/ }))
  await waitFor(() => expect(window.location.hash).toBe('#practice?from=drill:hf'))
  await waitFor(async () => expect(await screen.findByRole('combobox', { name: 'Learning from' })).toHaveDisplayValue(/Practice session · 1 Jan/))
})


async function seedPhrases(count: number, base = new Date(2026, 5, 10, 12).getTime()) {
  await db.practiceHistory.bulkAdd(Array.from({ length: count }, (_, i) => {
    const text = `词${String(i).padStart(3, '0')}`
    return { text, phrase: { type: 'speech', text, locale: 'zh-Hans' }, rate: 1, lastOpenedAt: base - i * 3_600_000 }
  }) as never)
}

it('paginates 30 rows per page, newest first, under date headers, with the page in the URL hash', async () => {
  const now = Date.now()
  await seedPhrases(70, now - 3_600_000)
  render(<App />)
  expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(30)
  expect(screen.getByRole('button', { name: 'Practice 词000' })).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(/^(Today|Yesterday)$/)
  expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Older' }))
  expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
  expect(window.location.hash).toBe('#history?f=all&p=2')
  expect(screen.getByRole('button', { name: 'Practice 词030' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Oldest' }))
  expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(10)
  expect(screen.getByRole('button', { name: 'Practice 词069' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled()
  // Back returns to the same page: the page comes from the hash, so loading it directly lands there.
  cleanup()
  await go('history?f=all&p=2')
  render(<App />)
  expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
})

it('removes one row through its menu with the learned-stays line, shows Undo, and keeps it hidden after reload', async () => {
  await rememberPracticePhrase(phrase, 1)
  await rememberPracticePhrase({ type: 'speech', text: '再见', locale: 'zh-Hans' }, 1)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'More for 你好' }))
  expect(screen.getByRole('menuitem', { name: 'Remove 你好 from history' })).toHaveAttribute('title', 'Removes it from History only. What you learned stays.')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove 你好 from history' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Practice 你好' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Practice 再见' })).toBeInTheDocument()
  expect((await db.practiceHistory.get('你好'))?.removedAt).toBeGreaterThan(0)
  cleanup()
  render(<App />)
  await screen.findByRole('button', { name: 'Practice 再见' })
  expect(screen.queryByRole('button', { name: 'Practice 你好' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'More for 再见' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove 再见 from history' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  await waitFor(async () => expect((await db.practiceHistory.get('再见'))?.removedAt).toBeUndefined())
  expect(await screen.findByRole('button', { name: 'Practice 再见' })).toBeInTheDocument()
  expect((await db.practiceHistory.get('再见'))?.removedAt).toBeUndefined()
})

it('Select mode removes the picked rows in bulk, selects all on the page, and Undo brings them back', async () => {
  await seedPhrases(35)
  render(<App />)
  expect(screen.queryByRole('button', { name: 'Select' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Page actions' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Select items' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select all on this page' }))
  expect(screen.getByRole('button', { name: 'Remove selected (30)' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Clear this page' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select 词000' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select 词001' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove selected (2)' }))
  await act(async () => { await new Promise(r => setTimeout(r, 800)) })
  expect(screen.queryByRole('button', { name: 'Practice 词000' })).toBeNull()
  expect(screen.getByText(/Removed 2 items from History/)).toBeInTheDocument()
  expect(await db.practiceHistory.filter(entry => !!entry.removedAt).count()).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await act(async () => { await new Promise(r => setTimeout(r, 800)) })
  expect(screen.getByRole('button', { name: 'Practice 词000' })).toBeInTheDocument()
  expect(await db.practiceHistory.filter(entry => !!entry.removedAt).count()).toBe(0)
}, 30000)

it('puts a lesson row actions on one row: Open and Practice icons, the Save icon, then the ⋯ menu with Remove from knowledge set and Remove from history', async () => {
  await db.exerciseSessions.add({ id: 'sess-m', mode: 'new', domain: 'reading', targetRefs: [wordRefs[0]], reviewRefs: [], exercises: [], cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: 5, completedAt: 6, addedRefs: [wordRefs[0]] } as never)
  await db.knowledge.put({ ref: wordRefs[0], kind: 'vocabulary', lb: 'wo3--me', band: '1', addedAt: 6, source: 'new' } as never)
  render(<App />)
  const row = (await screen.findByRole('link', { name: /Open lesson session/ })).closest('li')!
  const actions = row.querySelector('.history-actions')!
  const names = [...actions.querySelectorAll('a, button')].map(node => node.getAttribute('aria-label'))
  expect(names[0]).toMatch(/^Open lesson session/); expect(names[1]).toMatch(/^Practice lesson session/); expect(names[2]).toMatch(/Save/); expect(names[names.length - 1]).toBe('More for New items lesson')
  expect(within(row).queryByRole('button', { name: /knowledge set/ })).toBeNull()
  fireEvent.click(within(row).getByRole('button', { name: 'More for New items lesson' }))
  const menu = screen.getByRole('menu', { name: 'Actions for New items lesson' })
  await within(menu).findByRole('menuitem', { name: /from knowledge set/ })
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['Remove from knowledge set', 'Remove from history'])
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Remove New items lesson from knowledge set/ }))
  expect(await screen.findByRole('dialog', { name: 'Remove from knowledge set' })).toBeInTheDocument()
})

it('names the section in the top banner instead of Workspace', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: 'No phrases yet' })
  const banner = () => document.querySelector('.breadcrumb')!.textContent
  expect(banner()).toBe('History')
  for (const [route, title] of [['#dictionary', 'Dictionary'], ['#writing', 'Dictionary'], ['#practice', 'Practice'], ['#collections', 'Study sets'], ['#settings', 'Settings'], ['#unknown-page', 'Overview']] as const) {
    await go(route)
    await waitFor(() => expect(banner()).toBe(title))
    expect(document.querySelector('.topbar')).not.toHaveTextContent('Workspace')
  }
})
