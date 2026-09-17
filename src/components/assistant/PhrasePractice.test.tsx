import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace } from '../../core/database'
import { createConversation, saveAIConnection, saveDraft, selectPracticePhrase, updateThread } from '../../core/assistant/store'
import * as capture from '../../core/assistant/speech-capture'
import * as assessment from '../../core/assistant/speech-assessment'
import type { SpeechConnection } from '../../core/assistant/speech-contracts'
import { clearUnsavedDrafts } from '../../core/assistant/drafts'
import { stopBrowserSpeech } from '../../core/assistant/speech'
import * as playback from '../../core/assistant/speech'
import * as cues from '../../core/assistant/recording-cue'

const phrase = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', romanization: 'ni hao', meaning: 'hello' } as const
const connection: SpeechConnection = { id: 'assistant-speech', provider: 'azure', region: 'eastus', apiKey: 'fake-speech-key',
  storageAcknowledged: true, revision: 'speech-revision', updatedAt: 1 }
let report: (state: assessment.SpeechAssessmentCaptureState) => void
const start = vi.fn<typeof capture.startSpeechCapture>()
const azureStart = vi.fn<typeof assessment.startAzurePracticeCapture>()
const cancel = vi.fn()
const stop = vi.fn()
let threadId: string
const playCue = vi.fn<() => Promise<void>>()
const cancelCue = vi.fn<() => Promise<void>>()

function mockPracticePlayback() {
  vi.spyOn(playback, 'playBrowserSpeechToEnd').mockResolvedValue({ status: 'completed' })
  vi.stubGlobal('AudioContext', class {})
  playCue.mockReset().mockResolvedValue()
  cancelCue.mockReset().mockResolvedValue()
  vi.spyOn(cues, 'prepareRecordingCue').mockImplementation(() => ({
    play: playCue, cancel: cancelCue, takeContext: () => new AudioContext(),
  }))
}

beforeEach(async () => {
  mockPracticePlayback()
  clearUnsavedDrafts()
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      blocks: [{ type: 'text', markdown: 'A normal assistant reply.' }, phrase],
    }) } }],
  }))))
  await db.delete(); await db.open(); await initializeWorkspace()
  threadId = await createConversation()
  await saveDraft(threadId, 'Keep my question')
  await saveAIConnection({ baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true })
  await selectPracticePhrase(threadId, phrase)
  await updateThread(threadId, { practiceInput: 'spoken-feedback' })
  await db.assistantThreads.update(threadId, { mode: 'shadow' })
  window.location.hash = `conversation/${threadId}`
  vi.spyOn(capture, 'speechCaptureSupported').mockReturnValue(true)
  vi.spyOn(assessment, 'azureSpeechCaptureSupported').mockReturnValue(true)
  cancel.mockReset().mockImplementation(() => report({ phase: 'finished', transcript: '', cancelled: true }))
  stop.mockReset().mockImplementation(() => report({ phase: 'finished', transcript: phrase.text }))
  start.mockReset().mockImplementation(listener => {
    report = state => {
      if (state.phase === 'assessing' || state.phase === 'ready') throw new Error('Browser transcription cannot assess audio.')
      listener({ ...state, phase: state.phase })
    }
    listener({ phase: 'starting', transcript: '' })
    return { cancel, stop }
  })
  azureStart.mockReset().mockImplementation((_connection, _reference, listener, options) => {
    report = listener
    listener({ phase: 'starting', transcript: '' })
    void options?.beforeListening?.().then(() => listener({ phase: 'listening', transcript: '' }))
    return { cancel, stop }
  })
  vi.spyOn(capture, 'startSpeechCapture').mockImplementation(start)
  vi.spyOn(assessment, 'startAzurePracticeCapture').mockImplementation(azureStart)
})
afterEach(() => { cleanup(); stopBrowserSpeech(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function begin(name = 'Start speaking') {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled())
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

describe('automatic translation practice', () => {
  it('previews a Shadow phrase when Practice is clicked, without starting a recording on panel mount', async () => {
    await updateThread(threadId, { practiceInput: 'listen-repeat' })
    await db.assistantMessages.add({ id: 'shadow-reply', threadId, role: 'assistant', sequence: 0, text: '', blocks: [phrase],
      mode: 'shadow', intent: 'shadow', status: 'completed', createdAt: 1 })
    const preview = vi.spyOn(playback, 'playBrowserSpeech').mockImplementation(() => {})
    render(<App />)
    const reply = await screen.findByRole('article', { name: 'Assistant reply' })
    expect(preview).not.toHaveBeenCalled()
    fireEvent.click(within(reply).getByRole('button', { name: 'Practice' }))
    expect(preview).toHaveBeenCalledWith(`practice-preview-${threadId}`, phrase.text, phrase.locale, 1)
    expect(start).not.toHaveBeenCalled()
    expect(azureStart).not.toHaveBeenCalled()
    expect(playCue).not.toHaveBeenCalled()
  })

  it('connects actual browser recognition callbacks to one automatic local comparison', async () => {
    vi.restoreAllMocks()
    mockPracticePlayback()
    type NativeRecognition = InstanceType<NonNullable<Window['SpeechRecognition']>>
    const instances: NativeRecognition[] = []
    class Recognition implements NativeRecognition {
      lang = ''; interimResults = false; continuous = true; maxAlternatives = 0
      onstart: NativeRecognition['onstart'] = null
      onresult: NativeRecognition['onresult'] = null
      onerror: NativeRecognition['onerror'] = null
      onend: NativeRecognition['onend'] = null
      start = vi.fn()
      stop = vi.fn(() => {
        this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: phrase.text } } } })
        this.onend?.()
      })
      abort = vi.fn()
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('SpeechRecognition', Recognition)
    render(<App />)
    expect(instances).toHaveLength(0)
    await begin()
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({ lang: 'zh-CN', interimResults: true, continuous: false, maxAlternatives: 1 })
    await act(async () => instances[0].onstart?.())
    expect(screen.getByText('Listening...')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop capture' }))
    const bubble = await screen.findByRole('article', { name: 'Practice result' })
    expect(bubble).toHaveTextContent('Transcript matches.')
    expect(instances[0].onresult).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('defaults to listen-and-repeat without activating either capture engine', async () => {
    await updateThread(threadId, { practiceInput: 'listen-repeat' })
    await db.speechConnections.put(connection)
    render(<App />)
    const panel = await screen.findByLabelText('Translation practice')
    expect(within(panel).getByRole('button', { name: 'Hear' })).toBeEnabled()
    expect(panel).toHaveTextContent('Your microphone is off')
    expect(screen.queryByRole('button', { name: 'Start speaking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send for feedback' })).not.toBeInTheDocument()
    expect(start).not.toHaveBeenCalled()
    expect(azureStart).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('automatically persists a diff once, preserves the draft, and supports another identical attempt', async () => {
    render(<App />)
    await begin()
    expect(screen.queryByRole('button', { name: 'Send for feedback' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Review your transcript' })).not.toBeInTheDocument()
    act(() => {
      report({ phase: 'finished', transcript: phrase.text })
      report({ phase: 'finished', transcript: 'duplicate callback' })
    })
    const bubble = await screen.findByRole('article', { name: 'Practice result' })
    expect(bubble).toHaveTextContent('not pronunciation accuracy')
    expect(within(bubble).getByRole('button', { name: 'Copy full message' })).toBeInTheDocument()
    expect(await db.assistantMessages.count()).toBe(1)
    expect(await db.assistantThreads.get(threadId)).toMatchObject({ mode: 'shadow', draft: 'Keep my question', practicePhrase: phrase })
    expect(await db.attempts.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    await begin('Record again')
    act(() => report({ phase: 'finished', transcript: phrase.text }))
    await waitFor(async () => expect(await db.assistantMessages.count()).toBe(2))
    cleanup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Practice result' })).toHaveLength(2))
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Keep my question')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses Azure automatically when configured and enabled, saving genuine provider measurements without LLM calls', async () => {
    await db.speechConnections.put(connection)
    render(<App />)
    await begin()
    expect(azureStart).toHaveBeenCalledWith(connection, phrase.text, expect.any(Function),
      { automaticAssessment: true, audioContext: expect.any(AudioContext), beforeListening: expect.any(Function) })
    expect(start).not.toHaveBeenCalled()
    act(() => report({ phase: 'assessing', transcript: phrase.text }))
    expect(screen.getByText('Assessing...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record again' })).not.toBeInTheDocument()
    act(() => report({ phase: 'finished', transcript: phrase.text, assessment: {
      status: 'assessed', accuracy: 93.5, fluency: 82, completeness: 100, words: [{ text: phrase.text, accuracy: 93.5 }],
    } }))
    const bubble = await screen.findByRole('article', { name: 'Practice result' })
    expect(bubble).toHaveTextContent('Azure Speech')
    expect(bubble).toHaveTextContent('93.5 / 100')
    expect((await db.assistantMessages.toArray())[0].practiceResult).toMatchObject({ kind: 'azure', phrase, transcript: phrase.text })
    expect(fetch).not.toHaveBeenCalled()
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('uses only browser transcription and a local diff when speech feedback is disabled', async () => {
    await db.speechConnections.put(connection)
    await updateThread(threadId, { speechFeedback: false })
    render(<App />)
    await begin()
    act(() => report({ phase: 'finished', transcript: '\u4f60' }))
    const bubble = await screen.findByRole('article', { name: 'Practice result' })
    expect(bubble).toHaveTextContent('Transcript differs.')
    expect(bubble).toHaveTextContent('turned off for this conversation')
    expect(within(bubble).getByLabelText('Missing: \u597d')).toBeInTheDocument()
    expect(start).toHaveBeenCalledTimes(1)
    expect(azureStart).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never includes completed results in subsequent normal model requests', async () => {
    render(<App />)
    await begin()
    act(() => report({ phase: 'finished', transcript: 'PRIVATE_AUDIO_TRANSCRIPT_113' }))
    await screen.findByRole('article', { name: 'Practice result' })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('A normal assistant reply.')
    expect(fetch).toHaveBeenCalledTimes(1)
    const init = vi.mocked(fetch).mock.calls[0][1]
    expect(String(init?.body)).not.toMatch(/PRIVATE_AUDIO_TRANSCRIPT_113|practiceResult|transcript-diff/)
    expect(String(init?.body)).toContain('Keep my question')
  })

  it('cancels on input changes, closing, or navigation, and ignores late final results', async () => {
    const user = userEvent.setup()
    render(<App />)
    await begin()
    const late = report
    await user.click(screen.getByRole('button', { name: 'Assistant settings' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Practice input' }), 'listen-repeat')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop capture' })).not.toBeInTheDocument())
    act(() => late({ phase: 'finished', transcript: 'late discarded text' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Practice input' }), 'spoken-feedback')
    await begin()
    fireEvent.click(screen.getByRole('button', { name: 'Close practice' }))
    await waitFor(() => expect(screen.queryByLabelText('Translation practice')).not.toBeInTheDocument())
    await act(async () => { await selectPracticePhrase(threadId, phrase) })
    await begin()
    const lateNavigation = report
    await act(async () => { window.location.hash = 'dictionary'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    act(() => lateNavigation({ phase: 'finished', transcript: 'late navigation text' }))
    expect(cancel).toHaveBeenCalled()
    expect(await db.assistantMessages.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['feedback', 'connection'] as const)('cancels an Azure attempt if its %s configuration changes', async change => {
    await db.speechConnections.put(connection)
    render(<App />)
    await begin()
    const late = report
    await act(async () => {
      if (change === 'feedback') await updateThread(threadId, { speechFeedback: false })
      else await db.speechConnections.update(connection.id, { revision: 'changed' })
    })
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    act(() => late({ phase: 'finished', transcript: 'late Azure text', assessment: { status: 'no-speech', words: [] } }))
    expect(await db.assistantMessages.count()).toBe(0)
  })

  it('does not treat Escape/page-hide cancellation or an explicit Cancel as a completed attempt', async () => {
    render(<App />)
    await begin()
    act(() => report({ phase: 'finished', transcript: phrase.text, cancelled: true }))
    expect(screen.getByText('Attempt cancelled. No result was added.')).toBeInTheDocument()
    await begin('Record again')
    const late = report
    fireEvent.click(screen.getByRole('button', { name: 'Cancel attempt' }))
    act(() => late({ phase: 'finished', transcript: 'late after cancel' }))
    expect(await db.assistantMessages.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still supports comparison without an AI connection', async () => {
    await db.aiConnections.clear()
    render(<App />)
    await begin()
    act(() => report({ phase: 'finished', transcript: phrase.text }))
    expect(await screen.findByRole('article', { name: 'Practice result' })).toHaveTextContent('Transcript matches.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports unavailable capture without requesting permission or silently switching Azure off', async () => {
    await db.speechConnections.put(connection)
    vi.mocked(assessment.azureSpeechCaptureSupported).mockReturnValue(false)
    render(<App />)
    await screen.findByText('Recording unavailable in this browser.')
    expect(screen.getByRole('button', { name: 'Start speaking' })).toBeDisabled()
    expect(start).not.toHaveBeenCalled()
    expect(azureStart).not.toHaveBeenCalled()
  })

  it('cancels before Hear so reference playback cannot become a recorded attempt', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
    const synthesis = Object.assign(new EventTarget(), {
      getVoices: () => [{ name: 'Mandarin', lang: 'zh-CN', voiceURI: 'local-zh', localService: true, default: false }],
      speak: vi.fn(), cancel: vi.fn(),
    })
    vi.stubGlobal('speechSynthesis', synthesis)
    render(<App />)
    await begin()
    fireEvent.click(within(screen.getByLabelText('Translation practice')).getByRole('button', { name: 'Hear' }))
    expect(cancel).toHaveBeenCalled()
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(await db.assistantMessages.count()).toBe(0)
  })

  it('saves visible provider failures rather than fake scores or silent transcript-only fallback', async () => {
    await db.speechConnections.put(connection)
    render(<App />)
    await begin()
    act(() => report({ phase: 'error', transcript: '', error: 'Azure Speech could not assess this recording.' }))
    const bubble = await screen.findByRole('article', { name: 'Practice result' })
    expect(within(bubble).getByRole('alert')).toHaveTextContent('could not assess')
    expect(bubble).not.toHaveTextContent('Accuracy')
    expect(bubble).not.toHaveTextContent('Transcript matches')
    expect(start).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains a result after storage failure for an idempotent storage-only retry', async () => {
    render(<App />)
    await begin()
    vi.spyOn(db.assistantMessages, 'add').mockRejectedValueOnce(new Error('Storage full'))
    act(() => report({ phase: 'finished', transcript: phrase.text }))
    const retry = await screen.findByRole('button', { name: 'Retry saving result' })
    expect(screen.getByLabelText('Translation practice')).toHaveTextContent(phrase.text)
    expect(await db.assistantMessages.count()).toBe(0)
    expect(screen.getByRole('button', { name: 'Record again' })).toBeDisabled()
    fireEvent.click(retry)
    await screen.findByRole('article', { name: 'Practice result' })
    expect(await db.assistantMessages.count()).toBe(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
