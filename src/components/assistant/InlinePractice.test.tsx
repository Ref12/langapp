import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace } from '../../core/database'
import { createConversation, saveAIConnection, saveDraft, updateThread } from '../../core/assistant/store'
import { clearUnsavedDrafts } from '../../core/assistant/drafts'
import * as capture from '../../core/assistant/speech-capture'
import * as azure from '../../core/assistant/speech-assessment'
import type { SpeechAssessmentCaptureState } from '../../core/assistant/speech-assessment'
import type { SpeechAssessment } from '../../core/assistant/speech-contracts'
import * as playback from '../../core/assistant/speech'
import { exportWorkspaceBackup, restoreBackup } from '../../core/backup'

const phrase = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', meaning: 'hello' } as const
let threadId: string
let report: (state: SpeechAssessmentCaptureState) => void
const handles: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = []
const speechConnection = { id: 'assistant-speech', provider: 'azure', region: 'eastus', apiKey: 'test-key',
  storageAcknowledged: true, revision: 'speech-revision', updatedAt: 1 } as const
const assessment: SpeechAssessment = { status: 'assessed', accuracy: 93, fluency: 82, completeness: 100, words: [] }

beforeEach(async () => {
  clearUnsavedDrafts()
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ blocks: [{ type: 'text', markdown: 'Normal reply.' }] }) } }],
  }))))
  handles.length = 0
  await db.delete(); await db.open(); await initializeWorkspace()
  threadId = await createConversation()
  await updateThread(threadId, { practiceInput: 'spoken-feedback' })
  await saveDraft(threadId, 'Keep this draft')
  await saveAIConnection({ baseUrl: 'https://example.test/v1', apiKey: 'fake', model: 'test', nativeTools: false, structuredOutput: false, storageAcknowledged: true })
  await db.assistantMessages.add({
    id: 'source-reply', threadId, sequence: 0, role: 'assistant', text: '', blocks: [
      { type: 'text', markdown: 'Try these phrases.' }, phrase, phrase, { ...phrase, text: '\u8336', meaning: 'tea' },
    ], mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
  })
  vi.spyOn(capture, 'speechCaptureSupported').mockReturnValue(true)
  vi.spyOn(azure, 'azureSpeechCaptureSupported').mockReturnValue(true)
  vi.spyOn(capture, 'startSpeechCapture').mockImplementation(listener => {
    report = state => {
      if (state.phase === 'assessing' || state.phase === 'ready') throw new Error('Invalid browser capture phase.')
      listener({ ...state, phase: state.phase })
    }
    const handle = {
      stop: vi.fn(() => listener({ phase: 'finished', transcript: phrase.text })),
      cancel: vi.fn(() => listener({ phase: 'finished', transcript: '', cancelled: true })),
    }
    handles.push(handle)
    listener({ phase: 'listening', transcript: '' })
    return handle
  })
  vi.spyOn(azure, 'startAzurePracticeCapture').mockImplementation((_connection, _reference, listener) => {
    report = listener
    const handle = {
      stop: vi.fn(() => listener({ phase: 'finished', transcript: phrase.text, assessment })),
      cancel: vi.fn(() => listener({ phase: 'finished', transcript: '', cancelled: true })),
    }
    handles.push(handle)
    listener({ phase: 'listening', transcript: '' })
    return handle
  })
  window.location.hash = `conversation/${threadId}`
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function blocks() {
  const reply = await screen.findByRole('article', { name: 'Assistant reply' })
  return Array.from(reply.querySelectorAll<HTMLElement>('.speech-block'))
}
async function begin(index = 0) {
  const block = (await blocks())[index]
  await waitFor(() => expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled())
  fireEvent.click(within(block).getByRole('button', { name: 'Practice' }))
  return block
}
async function submit(block: HTMLElement) {
  fireEvent.click(within(block).getByRole('button', { name: 'Submit' }))
  await within(block).findByLabelText('Practice feedback')
}

describe('inline Conversation practice', () => {
  it('starts recording from Practice, replaces just that row, and saves feedback without a new message', async () => {
    render(<App />)
    const block = await begin(1)
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    expect(within(block).queryByRole('button', { name: 'Hear' })).not.toBeInTheDocument()
    expect(within(block).queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    expect(within(block).getAllByRole('button').map(button => button.textContent)).toEqual(['Submit', 'Cancel'])
    expect(within((await blocks())[0]).getByRole('button', { name: 'Practice' })).toBeEnabled()
    expect(screen.queryByLabelText('Translation practice')).not.toBeInTheDocument()
    await submit(block)
    expect(within(block).getByText('Transcript matches.')).toBeInTheDocument()
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    expect(within((await blocks())[0]).queryByLabelText('Practice feedback')).not.toBeInTheDocument()
    const message = await db.assistantMessages.get('source-reply')
    expect(message?.practiceResults).toEqual([{ blockIndex: 2, result: { kind: 'transcript-diff', phrase, transcript: phrase.text, reason: 'not-configured' } }])
    expect(await db.assistantMessages.count()).toBe(1)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    expect(await db.assistantThreads.get(threadId)).toMatchObject({ mode: 'conversation', draft: 'Keep this draft' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('waits for Submit after recognition stops on its own, and Cancel discards the attempt', async () => {
    render(<App />)
    const block = await begin()
    act(() => report({ phase: 'finished', transcript: phrase.text }))
    expect(within(block).getByText('Ready to submit.')).toBeInTheDocument()
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }))
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits Azure feedback inline and explicitly disables assessment at the recording cap', async () => {
    await db.speechConnections.put(speechConnection)
    render(<App />)
    const block = await begin()
    expect(azure.startAzurePracticeCapture).toHaveBeenCalledWith(speechConnection, phrase.text, expect.any(Function), { automaticAssessment: false })
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    act(() => report({ phase: 'ready', transcript: '' }))
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    await submit(block)
    expect(within(block).getByLabelText('Practice feedback')).toHaveTextContent('93.0 / 100')
    expect(await db.assistantMessages.count()).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels an in-flight assessment and ignores its late result', async () => {
    await db.speechConnections.put(speechConnection)
    render(<App />)
    const block = await begin()
    const late = report
    handles[0].stop.mockImplementation(() => report({ phase: 'assessing', transcript: '' }))
    fireEvent.click(within(block).getByRole('button', { name: 'Submit' }))
    expect(within(block).getByRole('button', { name: 'Submit' })).toBeDisabled()
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }))
    act(() => late({ phase: 'finished', transcript: phrase.text, assessment }))
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    expect(await db.assistantMessages.count()).toBe(1)
  })

  it('keeps non-recording practice microphone-free with inline Submit and Cancel', async () => {
    await updateThread(threadId, { practiceInput: 'listen-repeat' })
    render(<App />)
    const block = await begin()
    expect(within(block).getByText('Repeat aloud. Microphone off.')).toBeInTheDocument()
    fireEvent.click(within(block).getByRole('button', { name: 'Submit' }))
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    expect(azure.startAzurePracticeCapture).not.toHaveBeenCalled()
    expect(await db.assistantMessages.count()).toBe(1)
  })

  it('moves between identical phrases without leaving two recorders or applying late feedback', async () => {
    render(<App />)
    const first = await begin()
    const late = report
    const second = await begin(1)
    expect(handles[0].cancel).toHaveBeenCalled()
    expect(within(first).getByRole('button', { name: 'Practice' })).toBeEnabled()
    act(() => late({ phase: 'finished', transcript: 'late text' }))
    await submit(second)
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults?.map(entry => entry.blockIndex)).toEqual([2])
  })

  it('does not reopen a stale attempt when returning to Conversation or restoring a setting', async () => {
    render(<App />)
    await begin()
    await act(async () => { await updateThread(threadId, { mode: 'shadow' }) })
    await waitFor(() => expect(handles[0].cancel).toHaveBeenCalled())
    await act(async () => { await updateThread(threadId, { mode: 'conversation' }) })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument())
    await begin()
    await act(async () => { await updateThread(threadId, { practiceInput: 'listen-repeat' }) })
    await waitFor(() => expect(handles[1].cancel).toHaveBeenCalled())
    await act(async () => { await updateThread(threadId, { practiceInput: 'spoken-feedback' }) })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument())
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(2)
  })

  it('shows capture errors inline without sending them or adding a message', async () => {
    render(<App />)
    const block = await begin()
    act(() => report({ phase: 'error', transcript: '', error: 'Microphone permission denied.' }))
    expect(within(block).getByRole('alert')).toHaveTextContent('Microphone permission denied.')
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    await submit(block)
    expect(within(block).getByRole('alert')).toHaveTextContent('Microphone permission denied.')
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults?.[0].result).toMatchObject({ kind: 'error', service: 'browser' })
    expect(await db.assistantMessages.count()).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ends recording when the main composer sends without including the attempt in that turn', async () => {
    render(<App />)
    await begin()
    const late = report
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Normal reply.')
    expect(handles[0].cancel).toHaveBeenCalled()
    act(() => late({ phase: 'finished', transcript: 'PRIVATE_CANCELLED_TRANSCRIPT' }))
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).not.toContain('PRIVATE_CANCELLED_TRANSCRIPT')
    expect(await db.assistantMessages.count()).toBe(3)
  })

  it.each(['Escape', 'settings', 'input', 'provider', 'mode', 'navigation', 'pagehide', 'hidden', 'playback'])('cancels inline practice for %s', async action => {
    const playbackListeners = new Set<() => void>()
    if (action === 'playback') vi.spyOn(playback, 'subscribePlayback').mockImplementation(listener => {
      playbackListeners.add(listener)
      return () => { playbackListeners.delete(listener) }
    })
    render(<App />)
    const block = await begin()
    const late = report
    if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    else if (action === 'pagehide') fireEvent(window, new Event('pagehide'))
    else if (action === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    }
    else if (action === 'playback') {
      vi.spyOn(playback, 'getPlaybackState').mockReturnValue({ activeId: 'other-audio' })
      act(() => playbackListeners.forEach(listener => listener()))
    }
    else await act(async () => {
      if (action === 'settings') await updateThread(threadId, { speechFeedback: false })
      else if (action === 'input') await updateThread(threadId, { practiceInput: 'listen-repeat' })
      else if (action === 'provider') await db.speechConnections.put(speechConnection)
      else if (action === 'mode') await updateThread(threadId, { mode: 'shadow' })
      else { window.location.hash = 'dictionary'; window.dispatchEvent(new HashChangeEvent('hashchange')) }
    })
    await waitFor(() => expect(handles[0].cancel).toHaveBeenCalled())
    act(() => late({ phase: 'finished', transcript: 'late' }))
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
    expect(within(block).queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
  })

  it('retries storage without recording or scoring again and replaces only the prior inline result', async () => {
    render(<App />)
    const block = await begin()
    vi.spyOn(db.assistantMessages, 'put').mockRejectedValueOnce(new Error('Storage full'))
    fireEvent.click(within(block).getByRole('button', { name: 'Submit' }))
    await within(block).findByRole('alert')
    expect(await db.assistantMessages.count()).toBe(1)
    await submit(block)
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    expect(handles[0].stop).toHaveBeenCalledTimes(1)
    await begin()
    act(() => report({ phase: 'finished', transcript: '\u4f60' }))
    await submit(block)
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toHaveLength(1)
    expect(within(block).getByText('Transcript differs.')).toBeInTheDocument()
  })

  it('persists inline feedback through backup/reload without exposing it in the next AI turn', async () => {
    render(<App />)
    const block = await begin()
    act(() => report({ phase: 'finished', transcript: 'PRIVATE_INLINE_TRANSCRIPT' }))
    await submit(block)
    const backup = await exportWorkspaceBackup()
    cleanup()
    await restoreBackup(backup)
    render(<App />)
    await screen.findByText('Transcript differs.')
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Normal reply.')
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).not.toMatch(/PRIVATE_INLINE_TRANSCRIPT|practiceResults/)
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain('Try these phrases.')
  })
})
