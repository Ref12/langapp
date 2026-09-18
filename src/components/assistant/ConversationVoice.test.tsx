import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace } from '../../core/database'
import { createConversation, saveAIConnection, saveDraft, updateThread } from '../../core/assistant/store'
import { clearUnsavedDrafts } from '../../core/assistant/drafts'
import type { AssistantBlock } from '../../core/assistant/contracts'
import * as capture from '../../core/assistant/speech-capture'
import * as playback from '../../core/assistant/speech'
import * as cues from '../../core/assistant/recording-cue'
import { interruptAudio } from '../../core/assistant/audio-owner'
import * as audioOwner from '../../core/assistant/audio-owner'

const phrase = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', meaning: 'hello' } as const
const blocks: AssistantBlock[] = [
  { type: 'text', markdown: 'Display only.' },
  { type: 'speech', text: 'Try this greeting.', locale: 'en-US' },
  phrase,
]
let id: string
let report: (state: capture.SpeechCaptureState) => void
let transcript: string
let stop: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>
const response = () => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ blocks }) } }],
}))

beforeEach(async () => {
  clearUnsavedDrafts()
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
  vi.stubGlobal('AudioContext', class {})
  transcript = 'Hello there'
  vi.stubGlobal('fetch', vi.fn(async () => response()))
  vi.spyOn(capture, 'speechCaptureSupported').mockReturnValue(true)
  vi.spyOn(capture, 'startSpeechCapture').mockImplementation(listener => {
    report = listener
    stop = vi.fn(() => listener({ phase: 'finished', transcript }))
    cancel = vi.fn(() => listener({ phase: 'finished', transcript: '', cancelled: true }))
    listener({ phase: 'listening', transcript: '' })
    return { stop, cancel }
  })
  vi.spyOn(cues, 'prepareRecordingCue').mockImplementation(() => ({
    play: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    takeContext: () => { throw new Error('Conversation dictation must not use Azure assessment.') },
  }))
  vi.spyOn(playback, 'playBrowserSpeechToEnd').mockResolvedValue({ status: 'completed' })
  await db.delete()
  await db.open()
  await initializeWorkspace()
  id = await createConversation()
  await saveAIConnection({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test-model',
    nativeTools: false, structuredOutput: false, storageAcknowledged: true })
  window.location.hash = `conversation/${id}`
})
afterEach(() => {
  cleanup()
  interruptAudio()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function openVoice() {
  await updateThread(id, { voiceEnabled: true })
  render(<App />)
  await screen.findByRole('button', { name: 'Start voice input' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start voice input' })).toBeEnabled())
  await waitFor(() => expect(screen.queryByText(/Set up your provider in/)).not.toBeInTheDocument())
}
async function begin() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start voice input' })) })
  await screen.findByText('Listening...')
}
async function userMessages() {
  return db.assistantMessages.where('threadId').equals(id).filter(message => message.role === 'user').toArray()
}
async function oldReply() {
  const previous = await db.assistantMessages.where('threadId').equals(id).sortBy('sequence')
  await db.assistantMessages.add({
    id: 'old-reply', threadId: id, sequence: (previous.at(-1)?.sequence ?? -1) + 1, role: 'assistant', text: '', blocks: [phrase],
    mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
  })
}

describe('conversation voice input and replies', () => {
  it('uses an icon-only Send and hides saved-status prose; voice settings do not autoplay', async () => {
    render(<App />)
    const send = await screen.findByRole('button', { name: 'Send' })
    expect(send).toHaveTextContent('')
    expect(send).toHaveClass('composer-send')
    expect(document.querySelector('.assistant-composer')).not.toHaveTextContent('Saved on this device')
    expect(screen.queryByRole('button', { name: 'Start voice input' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assistant settings' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Voice input and replies' }))
    await screen.findByRole('button', { name: 'Start voice input' })
    expect(screen.getByLabelText('Voice input language')).toHaveValue('en-US')
    fireEvent.change(screen.getByLabelText('Voice input language'), { target: { value: 'zh-Hans' } })
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.voiceInputLocale).toBe('zh-Hans'))
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    expect(playback.playBrowserSpeechToEnd).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['conversation', 'shadow'] as const)('dictates English in %s and sends only after Submit, then speaks the new reply', async mode => {
    await updateThread(id, { mode, speechRate: 0.75 })
    await saveDraft(id, 'Existing thought')
    await oldReply()
    await openVoice()
    expect(playback.playBrowserSpeechToEnd).not.toHaveBeenCalled()
    await begin()
    expect(capture.startSpeechCapture).toHaveBeenCalledWith(expect.any(Function), { locale: 'en-US' })
    act(() => report({ phase: 'listening', transcript: 'Hello' }))
    act(() => report({ phase: 'listening', transcript: 'Hello there' }))
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Existing thought\nHello there')
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveAttribute('readonly')
    expect((await db.assistantThreads.get(id))?.draft).toBe('Existing thought')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(playback.playBrowserSpeechToEnd).toHaveBeenCalledTimes(2))
    expect((await userMessages()).map(message => message.text)).toEqual(['Existing thought\nHello there'])
    expect(vi.mocked(playback.playBrowserSpeechToEnd).mock.calls.map(call => call.slice(1))).toEqual([
      ['Try this greeting.', 'en-US', 1], [phrase.text, 'zh-Hans', 0.75],
    ])
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('')
  })

  it('stops to review and edit without submitting or losing the typed draft', async () => {
    await updateThread(id, { voiceInputLocale: 'zh-Hans' })
    await saveDraft(id, 'Keep')
    await openVoice()
    await begin()
    expect(capture.startSpeechCapture).toHaveBeenCalledWith(expect.any(Function), { locale: 'zh-Hans' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Assistant' })).not.toHaveAttribute('readonly'))
    expect((await db.assistantThreads.get(id))?.draft).toBe('Keep\nHello there')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Assistant' }), { target: { value: 'Edited transcript' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(async () => expect((await userMessages()).map(message => message.text)).toEqual(['Edited transcript']))
  })

  it('lets native recognition finish without automatically sending', async () => {
    await openVoice()
    await begin()
    await act(async () => report({ phase: 'finished', transcript: 'Natural ending' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Assistant' })).not.toHaveAttribute('readonly'))
    expect((await db.assistantThreads.get(id))?.draft).toBe('Natural ending')
    expect(fetch).not.toHaveBeenCalled()
    expect(playback.playBrowserSpeechToEnd).not.toHaveBeenCalled()
  })

  it('cancels back to the original draft and ignores late callbacks', async () => {
    await saveDraft(id, 'Original')
    await openVoice()
    await begin()
    act(() => report({ phase: 'listening', transcript: 'Discard this' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }))
    await act(async () => report({ phase: 'finished', transcript: 'Late' }))
    expect(cancel).toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Original')
    expect((await db.assistantThreads.get(id))?.draft).toBe('Original')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('waits for final recognition and sends at most once when Submit is pressed twice', async () => {
    await openVoice()
    await begin()
    stop.mockImplementation(() => report({ phase: 'stopping', transcript: 'Interim' }))
    const form = screen.getByRole('textbox', { name: 'Message Assistant' }).closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    await act(async () => report({ phase: 'finished', transcript: 'Final words' }))
    await waitFor(async () => expect((await userMessages()).map(message => message.text)).toEqual(['Final words']))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })

  it('can cancel a submitted recording before recognition drains without sending', async () => {
    await saveDraft(id, 'Keep')
    await openVoice()
    await begin()
    stop.mockImplementation(() => report({ phase: 'stopping', transcript: 'Not final' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }))
    await act(async () => report({ phase: 'finished', transcript: 'Too late' }))
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Keep')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves the original draft when appended speech exceeds the draft limit', async () => {
    const original = 'a'.repeat(7998)
    await saveDraft(id, original)
    await openVoice()
    await begin()
    act(() => report({ phase: 'listening', transcript: 'Too long' }))
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue(original)
    expect(screen.getByRole('alert')).toHaveTextContent('There is not enough room')
    expect(cancel).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels dictation before Ask appends context to the original draft', async () => {
    await oldReply()
    await saveDraft(id, 'Original')
    await openVoice()
    await begin()
    act(() => report({ phase: 'listening', transcript: 'Discard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue(`Original\n\nPlease explain this passage:\n\n${phrase.text}\n\nMeaning: hello`))
    expect(cancel).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows capture errors and retains recognized text for review rather than sending', async () => {
    await openVoice()
    await begin()
    await act(async () => report({ phase: 'error', transcript: 'Partial words', error: 'Speech service failed.' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Assistant' })).not.toHaveAttribute('readonly'))
    expect(screen.getByRole('alert')).toHaveTextContent('Speech service failed.')
    expect((await db.assistantThreads.get(id))?.draft).toBe('Partial words')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not submit an unsaved voice draft and can retry saving it', async () => {
    await openVoice()
    await begin()
    vi.spyOn(db.assistantThreads, 'put').mockRejectedValueOnce(new Error('Storage full'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('The voice draft could not be saved. Retry saving the draft before sending.')
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Hello there')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving draft' }))
    await waitFor(async () => expect((await db.assistantThreads.get(id))?.draft).toBe('Hello there'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(async () => expect((await userMessages()).map(message => message.text)).toEqual(['Hello there']))
  })

  it('does not send empty capture or start a second recording automatically', async () => {
    transcript = ''
    await openVoice()
    await begin()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('No speech was recognized. Record again or type a message.')
    expect(fetch).not.toHaveBeenCalled()
    expect(capture.startSpeechCapture).toHaveBeenCalledTimes(1)
  })

  it('keeps typing available when browser recognition is unsupported', async () => {
    vi.mocked(capture.speechCaptureSupported).mockReturnValue(false)
    await updateThread(id, { voiceEnabled: true })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Start voice input' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Assistant settings' }))
    expect(screen.getByText(/Voice input is unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toBeEnabled()
  })

  it('does not replay saved replies on mount or reload', async () => {
    await oldReply()
    await openVoice()
    await screen.findByText(phrase.text)
    cleanup()
    render(<App />)
    await screen.findByText(phrase.text)
    expect(playback.playBrowserSpeechToEnd).not.toHaveBeenCalled()
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
  })

  it.each(['off', 'navigate', 'escape', 'hear'] as const)('suppresses a late spoken reply after %s', async change => {
    let finish!: (value: Response) => void
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await oldReply()
    await saveDraft(id, 'Request')
    await openVoice()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    if (change === 'off') await act(async () => updateThread(id, { voiceEnabled: false }))
    if (change === 'navigate') await act(async () => { window.location.hash = 'overview'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    if (change === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (change === 'hear') fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
    await act(async () => finish(response()))
    await waitFor(async () => expect(await db.assistantMessages.where('threadId').equals(id).filter(message => message.status === 'completed' && message.runId !== undefined && message.role === 'assistant').count()).toBe(1))
    expect(playback.playBrowserSpeechToEnd).not.toHaveBeenCalled()
  })

  it('reports playback failure without resending or losing the saved reply', async () => {
    vi.mocked(playback.playBrowserSpeechToEnd).mockResolvedValue({ status: 'error', error: 'Voice unavailable.' })
    await saveDraft(id, 'Request')
    await openVoice()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Voice unavailable.')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await db.assistantMessages.where('threadId').equals(id).filter(message => message.role === 'assistant' && message.status === 'completed').count()).toBe(1)
  })

  it('surfaces audio preparation failure without sending and permits another attempt', async () => {
    await saveDraft(id, 'Request')
    await openVoice()
    vi.spyOn(audioOwner, 'interruptAudio').mockImplementationOnce(() => { throw new Error('Audio could not be interrupted.') })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Audio could not be interrupted.')
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Request')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await screen.findByText('Display only.')
  })

  it('stops the full spoken reply and does not begin the next block after a late completion', async () => {
    let finish!: (value: playback.PlaybackOutcome) => void
    vi.mocked(playback.playBrowserSpeechToEnd).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await saveDraft(id, 'Request')
    await openVoice()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Speaking...')
    fireEvent.click(screen.getByRole('button', { name: 'Stop speaking' }))
    await act(async () => finish({ status: 'completed' }))
    expect(playback.playBrowserSpeechToEnd).toHaveBeenCalledTimes(1)
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
    expect(screen.queryByText('Speaking...')).not.toBeInTheDocument()
  })

  it('connects real speech end events to ordered bilingual playback and global Stop', async () => {
    vi.mocked(playback.playBrowserSpeechToEnd).mockRestore()
    class Utterance {
      voice?: SpeechSynthesisVoice
      lang = ''
      rate = 1
      onstart?: (() => void) | null
      onend?: (() => void) | null
      onerror?: (() => void) | null
      constructor(public text: string) {}
    }
    const synthesis = Object.assign(new EventTarget(), {
      getVoices: () => [
        { name: 'English', lang: 'en-US', voiceURI: 'local-en', localService: true, default: false },
        { name: 'Mandarin', lang: 'zh-CN', voiceURI: 'local-zh', localService: true, default: false },
      ],
      speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    vi.stubGlobal('speechSynthesis', synthesis)
    await updateThread(id, { speechRate: 0.75 })
    await saveDraft(id, 'Request')
    await oldReply()
    await openVoice()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(synthesis.speak).toHaveBeenCalledTimes(1))
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ text: 'Try this greeting.', lang: 'en-US', rate: 1 })
    act(() => synthesis.speak.mock.calls[0][0].onstart?.())
    await act(async () => synthesis.speak.mock.calls[0][0].onend?.())
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(synthesis.speak.mock.calls[1][0]).toMatchObject({ text: phrase.text, lang: 'zh-CN', rate: 0.75 })
    act(() => synthesis.speak.mock.calls[1][0].onstart?.())
    fireEvent.click(screen.getByRole('button', { name: 'Stop all playback' }))
    await waitFor(() => expect(screen.queryByText('Speaking...')).not.toBeInTheDocument())
    expect(synthesis.cancel).toHaveBeenCalled()
    expect(capture.startSpeechCapture).not.toHaveBeenCalled()
  })

  it.each(['Escape', 'pagehide', 'hidden'] as const)('cancels dictation on %s without sending', async event => {
    await saveDraft(id, 'Keep')
    await openVoice()
    await begin()
    act(() => report({ phase: 'listening', transcript: 'Temporary' }))
    if (event === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    else if (event === 'pagehide') fireEvent(window, new Event('pagehide'))
    else {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    }
    await act(async () => report({ phase: 'finished', transcript: 'Late' }))
    expect(cancel).toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveValue('Keep')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('makes Practice and composer recording interrupt each other without sending practice to the tutor', async () => {
    await oldReply()
    await updateThread(id, { practiceInput: 'spoken-feedback' })
    await openVoice()
    await begin()
    const firstCancel = cancel
    await waitFor(() => expect(screen.getByRole('button', { name: 'Practice' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Practice' })) })
    const practice = await screen.findByLabelText('Inline translation practice')
    await waitFor(() => expect(within(practice).getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(firstCancel).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeEnabled()
    const practiceCancel = cancel
    await begin()
    expect(practiceCancel).toHaveBeenCalled()
    expect(screen.queryByLabelText('Inline translation practice')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(await userMessages()).toEqual([])
  })
})
