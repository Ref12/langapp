import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { saveAIConnection } from '../core/assistant/store'
import { requestStructuredJSON } from '../core/ai/structured'
import { resetProfileStorage } from '../test/profile-storage'
import { importBookText } from '../core/library/store'

vi.mock('../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => {
  await resetProfileStorage()
  window.location.hash = '#library'
  vi.mocked(requestStructuredJSON).mockReset()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('book import and reading in v2', () => {
  it('imports pasted chapters, translates explicitly, resumes after reload and removes with confirmation', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your next good read.' })
    await user.click(screen.getByRole('button', { name: 'Import book' }))
    await user.click(screen.getByText('Or paste text'))
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'An imported book')
    await user.type(screen.getByRole('textbox', { name: 'Book text' }), '# One\nHello.\n# Two\nGoodbye.')
    await user.click(screen.getByRole('button', { name: 'Import text' }))
    await screen.findByRole('heading', { name: 'An imported book' })
    const id = (await db.libraryBooks.toArray())[0].id
    expect(window.location.hash).toBe(`#book/${id}`)
    expect(screen.getByRole('button', { name: 'Translate chapter' })).toBeDisabled()
    expect(requestStructuredJSON).not.toHaveBeenCalled()
    await act(() => saveAIConnection({
      baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test',
      nativeTools: false, structuredOutput: true, storageAcknowledged: true,
    }))
    vi.mocked(requestStructuredJSON).mockResolvedValue({ blocks: [[{ text: '\u4f60\u597d', pinyin: 'ni hao', meaning: 'hello', trailing: '\u3002' }]] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translate passage' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Translate passage' }))
    await screen.findByRole('button', { name: 'Word help: \u4f60\u597d' })
    await user.click(screen.getByRole('button', { name: 'Word help: \u4f60\u597d' }))
    expect(screen.getByText(/ni hao \/ hello/)).toBeInTheDocument()
    expect(requestStructuredJSON).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Read & continue' }))
    await screen.findByRole('heading', { name: 'This passage has not been translated yet' })
    cleanup()
    render(<App />)
    await screen.findByRole('heading', { name: 'This passage has not been translated yet' })
    expect(await db.libraryBooks.get(id)).toMatchObject({ passage: 1, completed: [0] })
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByRole('button', { name: 'Word help: \u4f60\u597d' })
    expect(requestStructuredJSON).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Remove book' }))
    expect(await db.libraryBooks.count()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await screen.findByRole('heading', { name: 'Your next good read.' })
    expect(await db.libraryBooks.count()).toBe(0)
    expect(await db.knowledge.count()).toBe(0)
  })

  it('surfaces a failed translation and leaves the original readable', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your next good read.' })
    await user.click(screen.getByRole('button', { name: 'Import book' }))
    const file = new File(['Hello book.'], 'sample.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { value: async () => 'Hello book.' })
    await user.upload(screen.getByLabelText('Book file'), file)
    await screen.findByRole('heading', { name: 'sample' })
    await act(() => saveAIConnection({
      baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test',
      nativeTools: false, structuredOutput: true, storageAcknowledged: true,
    }))
    vi.mocked(requestStructuredJSON).mockRejectedValue(new Error('Provider offline'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translate passage' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Translate passage' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider offline')
    expect(screen.getByText('Hello book.')).toBeInTheDocument()
    expect((await db.libraryBooks.toArray())[0].passages[0].translation).toBeUndefined()
  })

  it('cancels translation and ignores a late result after navigation', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your next good read.' })
    const id = await importBookText('Navigation book', 'Hello.')
    await act(async () => {
      await saveAIConnection({
        baseUrl: 'https://provider.test/v1', apiKey: 'synthetic-key', model: 'test',
        nativeTools: false, structuredOutput: true, storageAcknowledged: true,
      })
      window.location.hash = `#book/${id}`
    })
    await screen.findByRole('heading', { name: 'Navigation book' })
    let complete!: (value: unknown) => void
    vi.mocked(requestStructuredJSON).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    await user.click(screen.getByRole('button', { name: 'Translate passage' }))
    await waitFor(() => expect(requestStructuredJSON).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(requestStructuredJSON).mock.calls[0][1].signal!
    await user.click(screen.getByRole('button', { name: 'Cancel translation' }))
    expect(signal.aborted).toBe(true)
    await act(async () => {
      window.location.hash = '#library'
      complete({ blocks: [[{ text: '\u4f60\u597d', pinyin: 'ni hao', meaning: 'hello', trailing: '\u3002' }]] })
    })
    await screen.findByRole('heading', { name: 'Your next good read.' })
    expect((await db.libraryBooks.get(id))?.passages[0].translation).toBeUndefined()
  })
})
