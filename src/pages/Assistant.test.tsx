import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { createConversation, saveAIConnection, saveDraft } from '../core/assistant/store'
import { getWord } from '../data/mandarin'
import { savePreferences, startPractice, trackWord } from '../core/learning'
import type { AIAPIType, AssistantBlock } from '../core/assistant/contracts'
import { clearUnsavedDrafts } from '../core/assistant/drafts'

const connection = { baseUrl: 'https://example.test/v1', apiKey: 'test-key-not-a-secret', model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true as const }

beforeEach(async () => {
  clearUnsavedDrafts()
  window.location.hash = ''
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

function respond(blocks: AssistantBlock[], apiType: AIAPIType = 'chat-completions') {
  const text = JSON.stringify({ blocks })
  const body = apiType === 'responses' ? {
    object: 'response', id: 'resp_test', status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
  } : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

describe('first usable Assistant', () => {
  it('automatically loads development settings before showing the editable connection form', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ aiConnection: connection }))))
    window.location.hash = 'settings'
    render(<App />)
    await screen.findByText('Saved AI connection: test-model')
    expect(screen.getByLabelText('API key')).toHaveValue(connection.apiKey)
    expect(within(screen.getByRole('region', { name: 'AI connection settings' })).getByText(/Loaded the AI connection from app.settings.jsonc/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    await go('conversation')
    expect(screen.queryByText(/Loaded the AI connection/)).not.toBeInTheDocument()
    await go('settings')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await db.assistantRuns.count()).toBe(0)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove connection' }))
    await user.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await screen.findByText('No AI connection is saved on this device.')
    expect(fetch).toHaveBeenCalledTimes(1)
    cleanup()
    render(<App />)
    await screen.findByText('Saved AI connection: test-model')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps manual setup available and reports local setup errors without displaying secrets', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`Failed request with ${connection.apiKey}`) }))
    window.location.hash = 'settings'
    render(<App />)
    await screen.findByLabelText('API key')
    expect(screen.getByText(/Local AI setup could not be completed/)).toHaveAttribute('role', 'alert')
    expect(document.body).not.toHaveTextContent(connection.apiKey)
    expect(await db.aiConnections.count()).toBe(0)
    await go('overview')
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(screen.queryByText(/Local AI setup could not be completed/)).not.toBeInTheDocument()
  })

  it('does not block lessons while local AI initializes and confines its status to settings', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve })))
    window.location.hash = 'lesson/zh-level-01:first-exchanges:part-1/7'
    render(<App />)
    await screen.findByRole('heading', { name: 'noun-predicate identity' })
    expect(screen.queryByText(/Loading local Assistant configuration/)).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await go('settings')
    await screen.findByText('Loading local Assistant configuration...')
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    await go('lesson/zh-level-01:first-exchanges:part-1/7')
    await screen.findByRole('heading', { name: 'noun-predicate identity' })
    await act(async () => { resolveResponse(new Response(JSON.stringify({ aiConnection: connection }))) })
    await waitFor(async () => expect(await db.aiConnections.count()).toBe(1))
    expect(screen.queryByText(/Loaded the AI connection/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss local AI notice' })).not.toBeInTheDocument()
    await go('settings')
    await screen.findByText('Saved AI connection: test-model')
    expect(within(screen.getByRole('region', { name: 'AI connection settings' })).getByText(/Loaded the AI connection/)).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveValue(connection.apiKey)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

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
    expect(within(card).getAllByRole('button', { name: 'Ask' })).toHaveLength(1)
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Ask' }))
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

  it('puts Hear/Ask under each Mandarin phrase and appends phrase or selection context to the current chat', async () => {
    const originalSource = { text: 'Original reference', title: 'Original source', route: 'dictionary' }
    const id = await createConversation(originalSource)
    await saveDraft(id, 'Keep my question')
    const other = await createConversation()
    await saveDraft(other, 'Other chat draft')
    await db.assistantMessages.add({
      id: 'multi-block-reply', threadId: id, role: 'assistant', text: '', sequence: 0,
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: Date.now(),
      blocks: [
        { type: 'text', markdown: 'First explanation.' },
        { type: 'speech', text: '\u8336', locale: 'zh-Hans', romanization: 'cha', meaning: 'tea' },
        { type: 'text', markdown: 'Another explanation.' },
        { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', romanization: 'ni hao', meaning: 'hello' },
      ],
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    window.location.hash = `/conversation/${id}`
    const user = userEvent.setup()
    render(<App />)
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' })
    const reply = await screen.findByRole('article', { name: 'Assistant reply' })
    expect(within(reply).getAllByRole('button', { name: 'Ask' })).toHaveLength(2)
    expect(within(reply).getAllByRole('button', { name: 'Hear' })).toHaveLength(2)
    for (const phrase of ['\u8336', '\u4f60\u597d']) {
      const block = within(reply).getByText(phrase).closest<HTMLDivElement>('.speech-block')!
      expect(within(block).getByRole('button', { name: 'Hear' })).toBeInTheDocument()
      expect(within(block).getByRole('button', { name: 'Ask' })).toBeInTheDocument()
      expect(within(block).getByRole('button', { name: 'Practice' })).toBeInTheDocument()
    }
    for (const block of reply.querySelectorAll('.assistant-markdown')) {
      expect(block.querySelector('button')).toBeNull()
    }
    expect(within(reply).getByRole('button', { name: 'Copy full message' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Keep my question and this last keystroke' } })
    fireEvent.click(within(reply).getAllByRole('button', { name: 'Ask' })[0])
    const fullDraft = 'Keep my question and this last keystroke\n\nPlease explain this passage:\n\n\u8336\n\nMeaning: tea'
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.draft).toBe(fullDraft))
    expect(input).toHaveValue(fullDraft)
    expect(input).toHaveFocus()
    expect(window.location.hash).toBe(`#conversation/${id}`)
    expect((await db.assistantThreads.get(id))?.source).toEqual(originalSource)
    expect((await db.assistantThreads.get(other))?.draft).toBe('Other chat draft')

    act(() => screen.getByLabelText('Conversation history').focus())
    const range = document.createRange()
    range.selectNodeContents(within(reply).getByText('Another explanation.'))
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent(document, new Event('selectionchange'))
    const toolbar = await screen.findByRole('toolbar', { name: 'Selected text actions' })
    await user.click(within(toolbar).getByRole('button', { name: 'Ask' }))
    expect(screen.queryAllByRole('alert').map(element => element.textContent)).toEqual([])
    const selectedDraft = `${fullDraft}\n\nPlease explain this passage:\n\nAnother explanation.`
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.draft).toBe(selectedDraft))
    expect(input).toHaveValue(selectedDraft)
    expect(await db.assistantThreads.count()).toBe(2)
    expect(await db.assistantMessages.count()).toBe(1)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    selection.removeAllRanges()
    cleanup()
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue(selectedDraft)
  })

  it('starts repeat practice from either mode without sending, replacing drafts, or rewriting earlier replies', async () => {
    const id = await createConversation()
    await saveDraft(id, 'Keep my unfinished question')
    const tea = { type: 'speech', text: '\u8336', locale: 'zh-Hans', romanization: 'cha', meaning: 'tea' } as const
    const greeting = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', romanization: 'ni hao', meaning: 'hello' } as const
    await db.assistantMessages.add({
      id: 'practice-reply', threadId: id, role: 'assistant', text: '', sequence: 0,
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: Date.now(),
      blocks: [{ type: 'text', markdown: 'Try a phrase.' }, tea, greeting,
        { type: 'speech', text: 'Hello', locale: 'en-US' }],
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    window.location.hash = `conversation/${id}`
    const user = userEvent.setup()
    render(<App />)
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' })
    const reply = await screen.findByRole('article', { name: 'Assistant reply' })
    expect(within(reply).getAllByRole('button', { name: 'Practice' })).toHaveLength(2)
    const english = within(reply).getByText('Hello').closest<HTMLDivElement>('.speech-block')!
    expect(within(english).queryByRole('button', { name: 'Practice' })).not.toBeInTheDocument()

    await user.click(within(reply).getAllByRole('button', { name: 'Practice' })[1])
    const reference = await screen.findByLabelText('Phrase to repeat')
    expect(within(reference).getByText(greeting.text)).toBeInTheDocument()
    expect(within(reference).getByText(greeting.romanization)).toBeInTheDocument()
    expect(within(reference).getByText(greeting.meaning)).toBeInTheDocument()
    expect(await db.assistantThreads.get(id)).toMatchObject({
      mode: 'shadow', shadowIntent: 'repeat', shadowPhrase: greeting, draft: 'Keep my unfinished question',
    })
    expect(input).toHaveValue('Keep my unfinished question')
    await waitFor(() => expect(input).toHaveFocus())
    expect(window.location.hash).toBe(`#conversation/${id}`)
    expect((await db.assistantMessages.get('practice-reply'))?.mode).toBe('conversation')

    await user.click(within(reply).getAllByRole('button', { name: 'Practice' })[0])
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.shadowPhrase).toEqual(tea))
    expect(await db.assistantMessages.where('threadId').equals(id).filter(message => message.role === 'event').count()).toBe(1)
    expect(await db.assistantThreads.count()).toBe(1)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    expect(await db.attempts.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()

    cleanup()
    render(<App />)
    expect(within(await screen.findByLabelText('Phrase to repeat')).getByText(tea.text)).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Keep my unfinished question')
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

  it.each(['chat-completions', 'responses'] as const)('sends a validated %s turn, persists it, and waits without awarding progress', async apiType => {
    await saveAIConnection({ ...connection, apiType })
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    respond([{ type: 'text', markdown: 'Let us explore **tea**.' }, { type: 'speech', text: '\u8336', locale: 'zh-Hans', romanization: 'cha', meaning: 'tea' }], apiType)
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
    expect(fetch).toHaveBeenCalledWith(`${connection.baseUrl}/${apiType === 'responses' ? 'responses' : 'chat/completions'}`, expect.objectContaining({ method: 'POST' }))
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
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-assistant-protected="true"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await screen.findByRole('button', { name: 'Ask' })
    expect(document.querySelector('[data-assistant-protected="true"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ask' }))
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
    expect(screen.getByRole('combobox', { name: 'API protocol' })).toHaveValue('chat-completions')
    await user.selectOptions(screen.getByRole('combobox', { name: 'API protocol' }), 'responses')
    await user.type(screen.getByLabelText('Model'), connection.model)
    await user.click(screen.getByRole('checkbox', { name: /I understand that the key/ }))
    await user.click(screen.getByRole('button', { name: 'Save AI connection' }))
    await screen.findByText('Saved AI connection: test-model')
    expect((await db.aiConnections.get('assistant'))?.apiKey).toBe(connection.apiKey)
    expect((await db.aiConnections.get('assistant'))?.apiType).toBe('responses')
    cleanup()
    render(<App />)
    expect(await screen.findByRole('combobox', { name: 'API protocol' })).toHaveValue('responses')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the selected Responses protocol for the explicit connection test', async () => {
    await saveAIConnection({ ...connection, apiType: 'responses' })
    window.location.hash = 'settings'
    respond([{ type: 'text', markdown: 'Connection ready.' }], 'responses')
    render(<App />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Test connection' }))
    await screen.findByText('Connection test succeeded with the selected capabilities. Save to use these settings.')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(`${connection.baseUrl}/responses`, expect.objectContaining({ method: 'POST' }))
    expect(await db.assistantRuns.count()).toBe(0)
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
