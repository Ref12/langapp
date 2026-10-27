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
