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
import * as cues from '../../core/assistant/recording-cue'
import { exportWorkspaceBackup, restoreBackup } from '../../core/backup'

const phrase = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', meaning: 'hello' } as const
let threadId: string
let report: (state: SpeechAssessmentCaptureState) => void
const handles: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = []
const speechConnection = { id: 'assistant-speech', provider: 'azure', region: 'eastus', apiKey: 'test-key',
  storageAcknowledged: true, revision: 'speech-revision', updatedAt: 1 } as const
const assessment: SpeechAssessment = { status: 'assessed', accuracy: 93, fluency: 82, completeness: 100, words: [] }
const playCue = vi.fn<() => Promise<void>>()
const cancelCue = vi.fn<() => Promise<void>>()

beforeEach(async () => {
  clearUnsavedDrafts()
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ blocks: [{ type: 'text', markdown: 'Normal reply.' }] }) } }],
  }))))
  handles.length = 0
  vi.spyOn(playback, 'playBrowserSpeechToEnd').mockResolvedValue({ status: 'completed' })
  vi.stubGlobal('AudioContext', class {})
  playCue.mockReset().mockResolvedValue()
  cancelCue.mockReset().mockResolvedValue()
  vi.spyOn(cues, 'prepareRecordingCue').mockImplementation(() => ({
    play: playCue, cancel: cancelCue, takeContext: () => new AudioContext(),
  }))
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
  vi.spyOn(azure, 'startAzurePracticeCapture').mockImplementation((_connection, _reference, listener, options) => {
    report = listener
    const handle = {
      stop: vi.fn(() => listener({ phase: 'finished', transcript: phrase.text, assessment })),
      cancel: vi.fn(() => listener({ phase: 'finished', transcript: '', cancelled: true })),
    }
    handles.push(handle)
    listener({ phase: 'starting', transcript: '' })
    void options?.beforeListening?.().then(() => listener({ phase: 'listening', transcript: '' }))
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
  await act(async () => { fireEvent.click(within(block).getByRole('button', { name: 'Practice' })) })
  return block
}
async function submit(block: HTMLElement) {
  fireEvent.click(within(block).getByRole('button', { name: 'Submit' }))
  await within(block).findByLabelText('Practice feedback')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('inline Conversation practice', () => {
  it('connects actual speech end/cancel events to the practice sequence without cancelling its own reference', async () => {
    vi.mocked(playback.playBrowserSpeechToEnd).mockRestore()
    class Utterance {
      voice?: SpeechSynthesisVoice
      lang = ''; rate = 1
      onstart?: (() => void) | null
      onend?: (() => void) | null
      onerror?: (() => void) | null
      constructor(public text: string) {}
    }
    const synthesis = Object.assign(new EventTarget(), {
      getVoices: () => [{ name: 'Mandarin', lang: 'zh-CN', voiceURI: 'local-zh', localService: true, default: false }],
      speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    vi.stubGlobal('speechSynthesis', synthesis)
    render(<App />)
    const block = await begin()
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ text: phrase.text, rate: 1 })
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    act(() => synthesis.speak.mock.calls[0][0].onstart?.())
    expect(within(block).getByRole('status')).toHaveTextContent('Listen...')
    await act(async () => synthesis.speak.mock.calls[0][0].onend?.())
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    expect(playCue).toHaveBeenCalledTimes(1)
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }))
    await begin()
    const lateEnd = synthesis.speak.mock.calls[1][0].onend
    synthesis.cancel.mockClear()
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }))
    await act(async () => lateEnd?.())
    expect(synthesis.cancel).toHaveBeenCalled()
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
  })

  it('waits for the phrase to finish and the microphone to start, then cues before enabling Submit', async () => {
    const voice = deferred<playback.PlaybackOutcome>()
    const tone = deferred<void>()
    vi.mocked(playback.playBrowserSpeechToEnd).mockReturnValue(voice.promise)
    playCue.mockReturnValue(tone.promise)
    render(<App />)
    const block = await begin()
    expect(within(block).getByRole('status')).toHaveTextContent('Listen...')
    expect(within(block).getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    expect(playCue).not.toHaveBeenCalled()
    expect(cues.prepareRecordingCue).toHaveBeenCalledTimes(1)
    await act(async () => { voice.resolve({ status: 'completed' }) })
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    expect(playCue).toHaveBeenCalledTimes(1)
    expect(within(block).getByRole('status')).toHaveTextContent('Get ready...')
    expect(within(block).getByRole('button', { name: 'Submit' })).toBeDisabled()
    await act(async () => { tone.resolve() })
    expect(within(block).getByRole('status')).toHaveTextContent('Listening...')
    expect(within(block).getByRole('button', { name: 'Submit' })).toBeEnabled()
    expect(await db.assistantMessages.count()).toBe(1)
  })

  it('does not cue until browser recognition actually reports microphone readiness', async () => {
    const original = vi.mocked(capture.startSpeechCapture).getMockImplementation()!
    vi.mocked(capture.startSpeechCapture).mockImplementation(listener => original(state =>
      listener(state.phase === 'listening' ? { ...state, phase: 'starting' } : state)))
    render(<App />)
    const block = await begin()
    expect(within(block).getByRole('status')).toHaveTextContent('Starting microphone...')
    expect(playCue).not.toHaveBeenCalled()
    expect(within(block).getByRole('button', { name: 'Submit' })).toBeDisabled()
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }))
    expect(cancelCue).toHaveBeenCalled()
    expect(handles[0].cancel).toHaveBeenCalled()
  })

  it.each(['phrase', 'cue'])('cancels during the %s and ignores late completion', async phase => {
    const voice = deferred<playback.PlaybackOutcome>()
    const tone = deferred<void>()
    if (phase === 'phrase') vi.mocked(playback.playBrowserSpeechToEnd).mockReturnValue(voice.promise)
    else playCue.mockReturnValue(tone.promise)
    render(<App />)
    const block = await begin()
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }))
    await act(async () => { voice.resolve({ status: 'completed' }); tone.resolve() })
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    expect(cancelCue).toHaveBeenCalled()
    if (phase === 'phrase') expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    else expect(handles[0].cancel).toHaveBeenCalled()
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
  })

  it('does not capture or cue when reference speech fails or is interrupted', async () => {
    vi.mocked(playback.playBrowserSpeechToEnd).mockResolvedValueOnce({ status: 'error', error: 'The selected voice is unavailable.' })
    render(<App />)
    let block = await begin()
    expect(within(block).getByRole('alert')).toHaveTextContent('selected voice is unavailable')
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    vi.mocked(playback.playBrowserSpeechToEnd).mockResolvedValueOnce({ status: 'cancelled' })
    block = await begin()
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    expect(playCue).not.toHaveBeenCalled()
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    expect(await db.assistantMessages.count()).toBe(1)
  })

  it.each(['prepare', 'play'])('shows cue %s failures and cancels instead of silently recording without a cue', async phase => {
    if (phase === 'prepare') vi.mocked(cues.prepareRecordingCue).mockImplementation(() => { throw new Error('Audio unavailable.') })
    else playCue.mockRejectedValueOnce(new Error('Audio unavailable.'))
    render(<App />)
    const block = await begin()
    expect(within(block).getByRole('alert')).toHaveTextContent('Audio unavailable.')
    expect(within(block).getByRole('button', { name: 'Practice' })).toBeEnabled()
    if (phase === 'prepare') expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    else expect(handles[0].cancel).toHaveBeenCalled()
    expect((await db.assistantMessages.get('source-reply'))?.practiceResults).toBeUndefined()
  })

  it('never begins recording after navigation while the phrase is still playing', async () => {
    const voice = deferred<playback.PlaybackOutcome>()
    vi.mocked(playback.playBrowserSpeechToEnd).mockReturnValueOnce(voice.promise)
    render(<App />)
    await begin()
    await act(async () => { window.location.hash = 'dictionary'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await act(async () => { voice.resolve({ status: 'completed' }) })
    expect(cancelCue).toHaveBeenCalled()
    expect(playCue).not.toHaveBeenCalled()
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    expect(await db.assistantMessages.count()).toBe(1)
  })

  it('plays the phrase from Practice, replaces just that row, and saves feedback without a new message', async () => {
    render(<App />)
    const block = await begin(1)
    expect(playback.playBrowserSpeechToEnd).toHaveBeenCalledWith(expect.any(String), phrase.text, phrase.locale, 1)
    expect(playCue).toHaveBeenCalledTimes(1)
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
    expect(azure.startAzurePracticeCapture).toHaveBeenCalledWith(speechConnection, phrase.text, expect.any(Function),
      { automaticAssessment: false, audioContext: expect.any(AudioContext), beforeListening: expect.any(Function) })
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
    expect(playback.playBrowserSpeechToEnd).toHaveBeenCalledTimes(1)
    expect(cues.prepareRecordingCue).not.toHaveBeenCalled()
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
    await screen.findByText('Conversation / English and Mandarin')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument())
    await begin()
    await waitFor(() => expect(handles).toHaveLength(2))
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
    expect(playback.playBrowserSpeechToEnd).toHaveBeenCalledTimes(1)
    expect(playCue).toHaveBeenCalledTimes(1)
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
