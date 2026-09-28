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
