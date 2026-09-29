import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { createConversation, saveAIConnection, saveDraft, updateThread } from '../core/assistant/store'
import { getWord } from '../data/mandarin'
import { savePreferences, startPractice, trackWord } from '../core/learning'
import type { AIAPIType, AssistantBlock } from '../core/assistant/contracts'
import { clearUnsavedDrafts } from '../core/assistant/drafts'
import { buildLessonPages } from '../core/learning-content'
import { lessonDefinitions } from '../data/learning-content'
import { resetProfileStorage } from '../test/profile-storage'
import { openPhraseActions } from '../test/phrase-actions'

const connection = { baseUrl: 'https://example.test/v1', apiKey: 'test-key-not-a-secret', model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true as const }

beforeEach(async () => {
  clearUnsavedDrafts()
  window.location.hash = ''
  await resetProfileStorage()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

function aiResponse(text: string, apiType: AIAPIType = 'chat-completions') {
  const body = apiType === 'responses' ? {
    object: 'response', id: 'resp_test', status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
  } : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }
  return new Response(JSON.stringify(body), { status: 200 })
}

function respond(blocks: AssistantBlock[], apiType: AIAPIType = 'chat-completions') {
  vi.stubGlobal('fetch', vi.fn(async () => aiResponse(stringify({ blocks }, { indentSeq: false }), apiType)))
}

describe('first usable Assistant', () => {
  it.each(['conversation', 'shadow'] as const)('keeps the %s composer free of instructional text and placeholders', async mode => {
    const id = await createConversation()
    await updateThread(id, { mode })
    window.location.hash = `conversation/${id}`
    render(<App />)
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' })
    expect(input).toHaveAttribute('rows', '1')
    expect(input).not.toHaveAttribute('placeholder')
    expect(input).toHaveValue('')
    const composer = input.closest<HTMLDivElement>('.assistant-composer')!
    expect(within(composer).queryByText(/Share a thought in English/)).not.toBeInTheDocument()
    expect(within(composer).getByRole('link', { name: 'AI connection settings' })).toBeInTheDocument()
  })

  it('uses a one-row empty composer and a top-bar title menu with persistent rename and guarded deletion', async () => {
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    const user = userEvent.setup()
    render(<App />)
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' })
    expect(input).toHaveAttribute('rows', '1')
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).not.toBeInTheDocument()
    let title = screen.getByRole('button', { name: 'Conversation actions: New conversation' })
    expect(title.closest('.topbar')).not.toBeNull()
    await user.click(title)
    await user.click(screen.getByRole('button', { name: 'Rename conversation' }))
    const name = screen.getByRole('textbox', { name: 'Conversation name' })
    await user.clear(name)
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
    await user.type(name, '  Tea practice  ')
    vi.spyOn(db.assistantThreads, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
    expect(await db.assistantThreads.get(id)).toMatchObject({ title: 'New conversation' })
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    title = await screen.findByRole('button', { name: 'Conversation actions: Tea practice' })
    expect(title).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Conversation name' })).not.toBeInTheDocument())
    expect(await db.assistantThreads.get(id)).toMatchObject({ title: 'Tea practice', titleManuallySet: true })
    cleanup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Conversation actions: Tea practice' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Conversation actions: Tea practice' }))
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep conversation' }))
    expect(await db.assistantThreads.get(id)).toBeDefined()
  })

  it('omits redundant workspace back links from conversations and their picker', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message Assistant' })
    expect(screen.queryByRole('link', { name: 'Back to workspace' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'All conversations' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(within(screen.getByRole('dialog', { name: 'Workspace navigation' })).getByRole('link', { name: 'Assistant' })).toHaveAttribute('href', '#conversation')
    await go('conversation')
    await screen.findByRole('heading', { name: 'Your Mandarin, in conversation.' })
    expect(screen.queryByRole('link', { name: 'Back to workspace' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
  })

  it('automatically loads development settings before showing the editable connection form', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      aiConnection: connection, defaultSpeechRate: 0.5,
      speechVoices: { 'en-US': { provider: 'edge', voice: 'en-US-ChristopherNeural' } },
    }))))
    window.location.hash = 'settings'
    render(<App />)
    await screen.findByText('Saved AI connection: test-model')
    expect(screen.getByLabelText('API key')).toHaveValue(connection.apiKey)
    expect(within(screen.getByRole('region', { name: 'AI connection settings' })).getByText(/Loaded the AI connection from default.yaml/)).toBeInTheDocument()
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
    await act(async () => { await savePreferences({
      defaultSpeechRate: 1.25,
      speechVoices: { 'en-US': { provider: 'edge', voice: 'en-US-AriaNeural' } },
    }) })
    expect(fetch).toHaveBeenCalledTimes(1)
    cleanup()
    render(<App />)
    await screen.findByText('No AI connection is saved on this device.')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await db.preferences.get('workspace')).toMatchObject({
      defaultSpeechRate: 1.25, speechVoices: { 'en-US': { provider: 'edge', voice: 'en-US-AriaNeural' } },
    })
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

  it('waits for the JSON default before creating a conversation', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve })))
    window.location.hash = 'conversation'
    render(<App />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const buttons = screen.getAllByRole('button', { name: 'New conversation' })
    expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true)
    await act(async () => { resolveResponse(new Response(JSON.stringify({ defaultSpeechRate: 0.5 }))) })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    fireEvent.click(buttons[0])
    await screen.findByRole('textbox', { name: 'Message Assistant' })
    expect((await db.assistantThreads.toArray())[0].speechRate).toBe(0.5)
  })

  it('offers quarter-speed Mandarin and retains the selected conversation speed after reload', async () => {
    const id = await createConversation()
    window.location.hash = `conversation/${id}`
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Assistant settings' }))
    const select = screen.getByLabelText('Mandarin speech speed')
    expect(within(select).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['0.25', '0.5', '0.75', '1', '1.25'])
    await user.selectOptions(select, '0.25')
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.speechRate).toBe(0.25))
    expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBeUndefined()
    cleanup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Assistant settings' }))
    expect(screen.getByLabelText('Mandarin speech speed')).toHaveValue('0.25')
  })

  it('reports an invalid JSON speed in voice settings even when both connections are already saved', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    await saveAIConnection(connection)
    await db.speechConnections.put({ id: 'assistant-speech', provider: 'azure', region: 'eastus', apiKey: 'fake-test-key',
      storageAcknowledged: true, revision: 'test-revision', updatedAt: 1 })
    await db.preferences.update('workspace', { defaultSpeechRate: 0.75 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ defaultSpeechRate: 0.6 }))))
    window.location.hash = 'settings'
    render(<App />)
    expect(await screen.findByText(/Default speech speed could not be loaded/)).toHaveAttribute('role', 'alert')
    expect((await db.preferences.get('workspace'))?.defaultSpeechRate).toBe(0.75)
    expect(fetch).toHaveBeenCalledTimes(1)
    await go('overview')
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(screen.queryByText(/Default speech speed could not be loaded/)).not.toBeInTheDocument()
  })

  it('does not block lessons while local AI initializes and confines its status to settings', async () => {
    vi.stubEnv('DEV_LOCAL_SETTINGS', 'true')
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve })))
    const lessonId = 'zh-level-01:first-exchanges:part-1'
    const definition = lessonDefinitions.get(lessonId)!
    const grammar = definition.sections.find(section => section.kind === 'grammar')!
    const grammarPage = buildLessonPages(definition).findIndex(page => page.kind === 'grammar') + 1
    const lessonRoute = `lesson/${lessonId}/${grammarPage}`
    window.location.hash = lessonRoute
    render(<App />)
    await screen.findByRole('heading', { name: grammar.title })
    expect(screen.queryByText(/Loading local Assistant configuration/)).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await go('settings')
    await screen.findByText('Loading local Assistant configuration...')
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    await go(lessonRoute)
    await screen.findByRole('heading', { name: grammar.title })
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

  it.each(['conversation', 'shadow'] as const)('uses Ask without Explain more in %s phrase menus and appends context to the current chat', async mode => {
    const originalSource = { text: 'Original reference', title: 'Original source', route: 'dictionary' }
    const id = await createConversation(originalSource)
    await updateThread(id, { mode })
    await saveDraft(id, 'Keep my question')
    const other = await createConversation()
    await saveDraft(other, 'Other chat draft')
    await db.assistantMessages.add({
      id: 'multi-block-reply', threadId: id, role: 'assistant', text: '', sequence: mode === 'shadow' ? 1 : 0,
      mode, intent: 'message', status: 'completed', createdAt: Date.now(),
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
    expect(within(reply).queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    expect(within(reply).getAllByRole('button', { name: 'Phrase actions' })).toHaveLength(2)
    for (const phrase of ['\u8336', '\u4f60\u597d']) {
      const block = within(reply).getByText(phrase).closest<HTMLDivElement>('.speech-block')!
      openPhraseActions(block)
      expect(within(block).getByRole('button', { name: 'Hear' })).toBeInTheDocument()
      expect(within(block).getByRole('button', { name: 'Ask' })).toBeInTheDocument()
      expect(within(block).getByRole('button', { name: 'Practice' })).toBeInTheDocument()
      expect(within(block).queryByRole('button', { name: 'Explain more', hidden: true })).not.toBeInTheDocument()
    }
    for (const block of reply.querySelectorAll('.assistant-markdown')) {
      expect(block.querySelector('button')).toBeNull()
    }
    expect(within(reply).getByRole('button', { name: 'Copy full message' })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Keep my question and this last keystroke' } })
    fireEvent.click(openPhraseActions(reply).getByRole('button', { name: 'Ask' }))
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
    expect(await db.assistantMessages.count()).toBe(mode === 'shadow' ? 2 : 1)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    selection.removeAllRanges()
    cleanup()
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue(selectedDraft)
  })

  it.each(['conversation', 'shadow'] as const)('opens listen-and-repeat practice without changing %s mode, sending, or replacing drafts', async mode => {
    const id = await createConversation()
    await updateThread(id, { mode })
    await saveDraft(id, 'Keep my unfinished question')
    const tea = { type: 'speech', text: '\u8336', locale: 'zh-Hans', romanization: 'cha', meaning: 'tea' } as const
    const greeting = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', romanization: 'ni hao', meaning: 'hello' } as const
    await db.assistantMessages.add({
      id: 'practice-reply', threadId: id, role: 'assistant', text: '', sequence: mode === 'shadow' ? 1 : 0,
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
    expect(within(reply).getAllByRole('button', { name: 'Phrase actions' })).toHaveLength(2)
    const englishText = within(reply).getByText('Hello')
    expect(englishText).toHaveAttribute('lang', 'en-US')
    expect(englishText.closest('.speech-block')).toBeNull()
    expect(reply.querySelectorAll('.speech-block')).toHaveLength(2)
    const english = englishText.closest<HTMLDivElement>('.assistant-markdown')!
    expect(within(english).queryByRole('button', { hidden: true })).not.toBeInTheDocument()

    await user.click(openPhraseActions(reply, 1).getByRole('button', { name: 'Practice' }))
    const reference = await screen.findByRole('dialog', { name: 'Phrase practice' })
    expect(reference.querySelector('.practice-target')).toHaveTextContent(greeting.text)
    const playlist = await within(reference).findByRole('region', { name: 'Current practice step' })
    expect(playlist.querySelector('[lang="zh-Latn"]')).toHaveTextContent(/\S/)
    expect(playlist).toHaveTextContent(greeting.meaning)
    expect(await db.assistantThreads.get(id)).toMatchObject({
      mode, practiceInput: 'listen-repeat', draft: 'Keep my unfinished question',
    })
    expect((await db.assistantThreads.get(id))?.practicePhrase).toBeUndefined()
    expect(input).toHaveValue('Keep my unfinished question')
    await waitFor(() => expect(within(reference).getByRole('button', { name: 'Close practice' })).toHaveFocus())
    expect(within(reference).queryByRole('button', { name: 'Start speaking' })).not.toBeInTheDocument()
    expect(within(reference).queryByRole('region', { name: 'Optional whole phrase recording' })).not.toBeInTheDocument()
    expect(reference).toHaveTextContent('Opening is silent')
    expect(screen.queryByRole('heading', { name: 'Practice this translation' })).not.toBeInTheDocument()
    expect(window.location.hash).toBe(`#conversation/${id}`)
    expect((await db.assistantMessages.get('practice-reply'))?.mode).toBe('conversation')

    await user.click(within(reference).getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(reference).not.toBeInTheDocument())
    await user.click(openPhraseActions(reply).getByRole('button', { name: 'Practice' }))
    const next = await screen.findByRole('dialog', { name: 'Phrase practice' })
    expect(await within(next).findByRole('region', { name: 'Current practice step' })).toHaveTextContent(tea.meaning)
    expect((await db.assistantThreads.get(id))?.practicePhrase).toBeUndefined()
    expect(await db.assistantMessages.where('threadId').equals(id).filter(message => message.role === 'event').count()).toBe(mode === 'shadow' ? 1 : 0)
    expect(await db.assistantThreads.count()).toBe(1)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    expect(await db.attempts.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()

    cleanup()
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Keep my unfinished question')
    expect(screen.queryByRole('dialog', { name: 'Phrase practice' })).not.toBeInTheDocument()
    const restoredReply = await screen.findByRole('article', { name: 'Assistant reply' })
    await user.click(openPhraseActions(restoredReply).getByRole('button', { name: 'Practice' }))
    expect(await within(await screen.findByRole('dialog', { name: 'Phrase practice' })).findByRole('region', { name: 'Current practice step' })).toHaveTextContent(tea.meaning)
    await user.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Phrase practice' })).not.toBeInTheDocument())
    expect((await db.assistantThreads.get(id))?.mode).toBe(mode)
  })

  it('defaults older conversations to no recording and saves practice input separately for each conversation', async () => {
    const first = await createConversation()
    const second = await createConversation()
    await db.assistantThreads.update(first, { practiceInput: undefined })
    window.location.hash = `conversation/${first}`
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Assistant settings' }))
    expect(screen.getByRole('combobox', { name: 'Practice input' })).toHaveValue('listen-repeat')
    expect(screen.getByRole('checkbox', { name: 'Speech feedback' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Speech feedback' }))
    await waitFor(async () => expect((await db.assistantThreads.get(first))?.speechFeedback).toBe(false))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Practice input' }), 'spoken-feedback')
    await waitFor(async () => expect((await db.assistantThreads.get(first))?.practiceInput).toBe('spoken-feedback'))
    expect((await db.assistantThreads.get(first))?.mode).toBe('conversation')
    await go(`conversation/${second}`)
    await user.click(await screen.findByRole('button', { name: 'Assistant settings' }))
    expect(screen.getByRole('combobox', { name: 'Practice input' })).toHaveValue('listen-repeat')
    expect(screen.getByRole('checkbox', { name: 'Speech feedback' })).toBeChecked()
    cleanup()
    window.location.hash = `conversation/${first}`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Assistant settings' }))
    expect(screen.getByRole('combobox', { name: 'Practice input' })).toHaveValue('spoken-feedback')
    expect(screen.getByRole('checkbox', { name: 'Speech feedback' })).not.toBeChecked()
    expect(await db.assistantMessages.count()).toBe(0)
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('offers an older pending Shadow repetition as an explicitly opened listen-only popup without hijacking the composer', async () => {
    const id = await createConversation()
    await updateThread(id, { mode: 'shadow', shadowIntent: 'repeat', shadowPhrase: { type: 'speech', text: '\u8336', locale: 'zh-Hans' } })
    await db.assistantThreads.update(id, { practiceInput: undefined })
    await saveDraft(id, 'My next thought in English')
    window.location.hash = `conversation/${id}`
    render(<App />)
    const card = (await screen.findByRole('heading', { name: 'Practice this translation' })).parentElement!
    expect(screen.queryByRole('dialog', { name: 'Phrase practice' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Practice' }))
    const panel = await screen.findByRole('dialog', { name: 'Phrase practice' })
    expect(panel).toHaveTextContent('Opening is silent')
    expect(panel.querySelector('.practice-target')).toHaveTextContent('\u8336')
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('My next thought in English')
    expect(screen.queryByText('Next turn: repeat the selected phrase')).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Phrase practice' })).not.toBeInTheDocument())
    expect(await db.assistantThreads.get(id)).toMatchObject({ mode: 'shadow', shadowIntent: 'new-phrase', draft: 'My next thought in English' })
  })

  it('does not offer LLM retry for saved legacy practice transcripts', async () => {
    const id = await createConversation()
    await saveAIConnection(connection)
    await db.assistantMessages.bulkAdd([
      { id: 'legacy-practice-user', threadId: id, role: 'user', text: 'Legacy transcript', blocks: [], sequence: 0, runId: 'legacy-practice-run',
        mode: 'conversation', intent: 'repeat', status: 'completed', createdAt: 1,
        practice: { input: 'speech-transcript', phrase: { type: 'speech', text: '\u8336', locale: 'zh-Hans' } } },
      { id: 'legacy-practice-reply', threadId: id, role: 'assistant', text: '', blocks: [], sequence: 1, runId: 'legacy-practice-run',
        mode: 'conversation', intent: 'repeat', status: 'failed', createdAt: 1, error: 'An old practice request failed.' },
    ])
    vi.stubGlobal('fetch', vi.fn())
    window.location.hash = `conversation/${id}`
    render(<App />)
    await screen.findByText('An old practice request failed.')
    expect(screen.queryByRole('button', { name: 'Retry reply' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
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

  it.each(['chat-completions', 'responses'] as const)('tests Assistant YAML and generated-content JSON separately with %s', async apiType => {
    await saveAIConnection({ ...connection, apiType, structuredOutput: true })
    window.location.hash = 'settings'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(aiResponse('blocks:\n- type: text\n  markdown: Connection ready.', apiType))
      .mockResolvedValueOnce(aiResponse('{"ready":true}', apiType))
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Test connection' }))
    await screen.findByText('Connection test succeeded with the selected capabilities. Save to use these settings.')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetcher.mock.calls[0][1].body)
    const second = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(first).not.toHaveProperty('response_format')
    expect(first).not.toHaveProperty('text')
    const format = apiType === 'responses' ? second.text.format : second.response_format.json_schema
    expect(format).toMatchObject({ name: 'connection_test', strict: true })
    expect(second).not.toHaveProperty('tools')
    expect(screen.getByText(/Assistant replies always use compact YAML/)).toBeInTheDocument()
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('does not report connection success when the separate JSON-schema test fails', async () => {
    await saveAIConnection({ ...connection, structuredOutput: true })
    window.location.hash = 'settings'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(aiResponse('blocks:\n- type: text\n  markdown: Connection ready.'))
      .mockResolvedValueOnce(aiResponse('{"ready":false}'))
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await within(screen.getByRole('form', { name: 'Assistant AI connection' })).findByRole('alert')).toHaveTextContent('expected JSON-schema test result')
    expect(screen.queryByText(/Connection test succeeded/)).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['chat-completions', 'responses'] as const)('can cancel the additional JSON capability request with %s', async apiType => {
    await saveAIConnection({ ...connection, apiType, structuredOutput: true })
    window.location.hash = 'settings'
    let finish!: (response: Response) => void
    const fetcher = vi.fn()
      .mockResolvedValueOnce(aiResponse('blocks:\n- type: text\n  markdown: Connection ready.', apiType))
      .mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel test' }))
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true)
    expect(await within(screen.getByRole('form', { name: 'Assistant AI connection' })).findByRole('alert')).toHaveTextContent('Assistant request cancelled.')
    await act(async () => { finish(aiResponse('{"ready":true}', apiType)) })
    expect(screen.queryByText(/Connection test succeeded/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled()
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('deletes a conversation only after confirmation and leaves learning alone', async () => {
    await trackWord('zh:tea', 'test')
    const id = await createConversation()
    await saveDraft(id, 'A saved draft')
    window.location.hash = `conversation/${id}`
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /^Conversation actions:/ }))
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
    expect(await db.assistantThreads.get(id)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(async () => expect(await db.assistantThreads.get(id)).toBeUndefined())
    expect(await db.words.count()).toBe(1)
  })
})
