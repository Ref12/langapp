import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { savePreferences } from '../core/learning'
import { createConversation } from '../core/assistant/store'
import { rememberPracticePhrase } from '../core/assistant/practice-history'
import { exportWorkspaceBackup, readBackup } from '../core/backup'
import { resetProfileStorage } from '../test/profile-storage'

beforeEach(async () => {
  window.location.hash = '#settings'
  await resetProfileStorage()
  await initializeWorkspace()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

it('defaults old profiles to tone marks and persists all three Settings choices without network requests', async () => {
  render(<App />)
  const select = await screen.findByRole('combobox', { name: 'Pinyin format' })
  expect(select).toHaveValue('marks')
  expect(await db.preferences.get('workspace')).not.toHaveProperty('pinyinFormat')
  for (const value of ['marks-and-numbers', 'numbers', 'marks']) {
    await userEvent.setup().selectOptions(select, value)
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.pinyinFormat).toBe(value))
    expect(readBackup(await exportWorkspaceBackup()).preferences.pinyinFormat).toBe(value)
  }
  cleanup()
  render(<App />)
  expect(await screen.findByRole('combobox', { name: 'Pinyin format' })).toHaveValue('marks')
  expect(fetch).not.toHaveBeenCalled()
})

it('reformats saved Assistant replies, History, and an open practice dialog in place without changing their source', async () => {
  const id = await createConversation()
  const phrase = { type: 'speech', text: '我们', romanization: 'wǒ men', locale: 'zh-Hans' } as const
  await db.assistantMessages.add({
    id: 'reply', threadId: id, sequence: 0, role: 'assistant', text: '', blocks: [phrase],
    mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
  })
  await rememberPracticePhrase(phrase, 1)
  const saved = await db.assistantMessages.get('reply')
  window.location.hash = `#conversation/${id}`
  render(<App />)
  const pronunciation = await screen.findByText('wǒ men')
  await act(() => savePreferences({ pinyinFormat: 'marks-and-numbers' }))
  await waitFor(() => expect(pronunciation).toHaveTextContent('wǒ3 men5'))
  expect(screen.getByText('wǒ3 men5')).toBe(pronunciation)
  await act(() => savePreferences({ pinyinFormat: 'numbers' }))
  await waitFor(() => expect(pronunciation).toHaveTextContent('wo3 men5'))
  expect(await db.assistantMessages.get('reply')).toEqual(saved)
  await go('history')
  const history = await screen.findByRole('button', { name: 'Practice 我们' })
  expect(history).toHaveTextContent('wo3 men5')
  await userEvent.setup().click(history)
  const dialog = await screen.findByRole('dialog', { name: 'Phrase practice' })
  await waitFor(() => expect(dialog.querySelector('.practice-current .practice-track-pinyin')).toHaveTextContent('wo3 men5'))
  const current = dialog.querySelector('.practice-current .practice-track-pinyin')!
  await act(() => savePreferences({ pinyinFormat: 'marks-and-numbers' }))
  await waitFor(() => expect(current).toHaveTextContent('wǒ3 men5'))
  expect(dialog.querySelector('.practice-current .practice-track-pinyin')).toBe(current)
  expect(history).toHaveTextContent('wǒ3 men5')
  expect((await db.practiceHistory.get('我们'))?.phrase).toEqual(phrase)
  expect(await db.assistantMessages.get('reply')).toEqual(saved)
  expect(await db.assistantRuns.count()).toBe(0)
  expect(fetch).not.toHaveBeenCalled()
})

it('reformats dictionary readings and examples while retaining search and pinyin visibility controls', async () => {
  await savePreferences({ pinyinFormat: 'marks-and-numbers' })
  window.location.hash = '#dictionary'
  render(<App />)
  const query = await screen.findByRole('searchbox', { name: 'Search dictionary' })
  await screen.findByText(/^\d+ items$/)
  const user = userEvent.setup()
  for (const spelling of ['chá2', 'cha2', 'chá']) {
    await user.clear(query)
    await user.type(query, spelling)
    const heading = (await screen.findAllByRole('heading', { name: '茶' }))[0]
    const card = heading.closest('article')!
    expect(card.querySelector('.study-pinyin')).toHaveTextContent('chá2')
  }
  await act(() => savePreferences({ pinyinFormat: 'numbers' }))
  await waitFor(() => expect(screen.getAllByRole('heading', { name: '茶' })[0].closest('article')!.querySelector('.study-pinyin')).toHaveTextContent('cha2'))
  await act(() => savePreferences({ pinyin: false }))
  await waitFor(() => expect(document.querySelector('.study-pinyin')).toBeNull())
  expect(fetch).not.toHaveBeenCalled()
})

it('shows preference storage failures instead of changing the saved format', async () => {
  render(<App />)
  const select = await screen.findByRole('combobox', { name: 'Pinyin format' })
  vi.spyOn(db.preferences, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await userEvent.setup().selectOptions(select, 'numbers')
  expect(await within(screen.getByRole('main')).findByText(/Unable to complete this action.*Storage full/)).toBeInTheDocument()
  expect(select).toHaveValue('marks')
  expect(await db.preferences.get('workspace')).not.toHaveProperty('pinyinFormat')
})
