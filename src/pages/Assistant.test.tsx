import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { createConversation, saveAIConnection, saveDraft } from '../core/assistant/store'
import { getWord } from '../data/mandarin'
import { savePreferences, startPractice, trackWord } from '../core/learning'
import type { AssistantBlock } from '../core/assistant/contracts'
import { clearUnsavedDrafts } from '../core/assistant/drafts'

const connection = { baseUrl: 'https://example.test/v1', apiKey: 'test-key-not-a-secret', model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true as const }

beforeEach(async () => {
  clearUnsavedDrafts()
  window.location.hash = ''
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

function respond(blocks: AssistantBlock[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ blocks }) } }],
  }), { status: 200 })))
}

describe('first usable Assistant', () => {
  it('expands the compact conversation picker before focusing search', async () => {
    const id = await createConversation()
    await savePreferences({ sidebarCollapsed: true })
    window.location.hash = `conversation/${id}`
    render(<App />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Find a conversation' }))
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Find a conversation' })).toHaveFocus())
    expect((await db.preferences.get('workspace'))?.sidebarCollapsed).toBe(false)
  })

  it('keeps a new draft while stopping an in-flight reply and ignores its late response', async () => {
    await saveAIConnection(connection)
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve })))
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Message Assistant' }), 'First question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await user.type(screen.getByRole('textbox', { name: 'Message Assistant' }), 'Keep this next question')
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.draft).toBe('Keep this next question'))
    await user.click(screen.getByRole('button', { name: 'Stop reply' }))
    await waitFor(async () => expect((await db.assistantRuns.toArray())[0]?.status).toBe('cancelled'))
    resolveResponse(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ blocks: [{ type: 'text', markdown: 'Too late' }] }) } }] })))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop reply' })).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Keep this next question')
    expect(screen.queryByText('Too late')).not.toBeInTheDocument()
    expect((await db.assistantMessages.where('threadId').equals(id).toArray()).filter(message => message.role === 'assistant' && message.status === 'completed')).toHaveLength(0)
  })

  it('retains a failed draft across navigation and lets the learner retry saving', async () => {
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    render(<App />)
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' })
    vi.spyOn(db.assistantThreads, 'put').mockRejectedValueOnce(new Error('Storage full'))
    fireEvent.change(input, { target: { value: 'Please keep this unsaved question' } })
    await screen.findByRole('button', { name: 'Retry saving draft' })
    expect((await db.assistantThreads.get(id))?.draft).toBe('')
    await go('overview')
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go(`conversation/${id}`)
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Please keep this unsaved question')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry saving draft' }))
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.draft).toBe('Please keep this unsaved question'))
    expect(screen.queryByRole('button', { name: 'Retry saving draft' })).not.toBeInTheDocument()
  })

  it('prepares exact reading context without sending or overwriting another draft', async () => {
    const old = await createConversation()
    await saveDraft(old, 'Keep my original draft')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go('reader/zh:tea-house')
    const card = (await screen.findByRole('heading', { name: getWord('zh:rain').native })).closest('article')!
    await userEvent.setup().click(within(card).getAllByRole('button', { name: 'Ask Assistant' })[0])
    await screen.findByRole('textbox', { name: 'Message Assistant' })
    const prepared = (await db.assistantThreads.toArray()).find(thread => thread.id !== old)!
    expect(prepared.source).toMatchObject({ text: getWord('zh:rain').native, meaning: 'rain', route: 'reader/zh:tea-house' })
    expect((await db.assistantThreads.get(old))?.draft).toBe('Keep my original draft')
    expect(await db.words.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove context' }))
    await waitFor(async () => expect((await db.assistantThreads.get(prepared.id))?.source).toBeUndefined())
    expect((await db.assistantThreads.get(prepared.id))?.draft).toContain(getWord('zh:rain').native)
  })

  it('keeps drafts separate across conversations, mode changes, and reload', async () => {
    const first = await createConversation()
    const second = await createConversation()
    await db.assistantThreads.update(first, { title: 'First conversation' })
    await db.assistantThreads.update(second, { title: 'Second conversation' })
    window.location.hash = `conversation/${first}`
    const user = userEvent.setup()
    const view = render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Message Assistant' }), 'Tea tomorrow')
    await waitFor(async () => expect((await db.assistantThreads.get(first))?.draft).toBe('Tea tomorrow'))
    await user.click(screen.getByRole('button', { name: 'Assistant settings' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'shadow')
    await waitFor(async () => expect((await db.assistantThreads.get(first))?.mode).toBe('shadow'))
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Tea tomorrow')
    await go(`conversation/${second}`)
    await user.type(await screen.findByRole('textbox', { name: 'Message Assistant' }), 'Another draft')
    await waitFor(async () => expect((await db.assistantThreads.get(second))?.draft).toBe('Another draft'))
    await go(`conversation/${first}`)
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Tea tomorrow')
    view.unmount()
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Tea tomorrow')
    expect((await db.assistantMessages.where('threadId').equals(first).toArray()).filter(message => message.role === 'event')).toHaveLength(1)
  })

  it('sends a real validated turn, persists it, and waits without awarding progress', async () => {
    await saveAIConnection(connection)
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    respond([{ type: 'text', markdown: 'Let us explore **tea**.' }, { type: 'speech', text: '\u8336', locale: 'zh-Hans', romanization: 'cha', meaning: 'tea' }])
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Message Assistant' }), 'Tell me about tea')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(async () => {
      const runs = await db.assistantRuns.toArray()
      expect(runs).toHaveLength(1)
      expect(runs[0].status).not.toBe('running')
    })
    expect((await db.assistantRuns.toArray())[0].error).toBeUndefined()
    await screen.findByText('Let us explore', { exact: false })
    await waitFor(async () => expect((await db.assistantRuns.toArray())[0]?.status).toBe('awaiting-learner'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await db.words.count()).toBe(0)
    expect(await db.attempts.count()).toBe(0)
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('')
    cleanup()
    render(<App />)
    await screen.findByText('Tell me about tea')
    await screen.findByText('Let us explore', { exact: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not offer contextual help until a practice answer is checked or revealed', async () => {
    await trackWord('zh:tea', 'test')
    const id = await startPractice('all')
    window.location.hash = `practice/${id}`
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'Show answer' })
    expect(screen.queryByRole('button', { name: 'Ask Assistant' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-assistant-protected="true"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await screen.findByRole('button', { name: 'Ask Assistant' })
    expect(document.querySelector('[data-assistant-protected="true"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ask Assistant' }))
    await screen.findByRole('textbox', { name: 'Message Assistant' })
    expect((await db.sessions.get(id))?.questions[0].revealed).toBe(true)
    expect(await db.attempts.count()).toBe(0)
  })

  it('saves explicit AI settings without making a network request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    window.location.hash = 'settings'
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('API key'), connection.apiKey)
    await user.type(screen.getByLabelText('Model'), connection.model)
    await user.click(screen.getByRole('checkbox', { name: /I understand that the key/ }))
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }))
    await screen.findByText('Saved AI connection: test-model')
    expect((await db.aiConnections.get('assistant'))?.apiKey).toBe(connection.apiKey)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('deletes a conversation only after confirmation and leaves learning alone', async () => {
    await trackWord('zh:tea', 'test')
    const id = await createConversation()
    await saveDraft(id, 'A saved draft')
    window.location.hash = `conversation/${id}`
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Delete conversation' }))
    expect(await db.assistantThreads.get(id)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(async () => expect(await db.assistantThreads.get(id)).toBeUndefined())
    expect(await db.words.count()).toBe(1)
  })
})
