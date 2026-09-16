import { Blob as NodeBlob } from 'node:buffer'
import Dexie from 'dexie'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, clearLocalData, exportBackup, importBackup } from '../../core/database'
import type { LanguageProfile } from '../../core/domain'
import { invokeAIOperation } from '../../core/ai/operations'
import { startCapture } from '../../core/voice/capture'
import { assessPronunciation } from '../../core/voice/azure'
import { encodeWav } from '../../core/voice/pcm'
import type { CaptureOptions, CaptureResult } from '../../core/voice/contracts'
import { VoiceConversation } from './VoiceConversation'
import * as storage from '../../core/voice/storage'
import { playSpeechSegments } from '../../core/speech'

vi.mock('../../core/ai/operations', () => ({ invokeAIOperation: vi.fn() }))
vi.mock('../../core/voice/capture', () => ({ startCapture: vi.fn() }))
vi.mock('../../core/voice/azure', () => ({ assessPronunciation: vi.fn() }))
vi.mock('../../core/speech', () => ({ playSpeechSegments: vi.fn(() => Promise.resolve()), stopSpeech: vi.fn() }))

const now = '2026-09-09T00:00:00.000Z'
const profile: LanguageProfile = {
  id: 'profile', name: 'Japanese', sourceLanguage: 'en', targetLanguage: 'ja', romanization: 'Hepburn',
  dailyNewItemLimit: 5, createdAt: now, updatedAt: now,
}
const greeting = { segments: [{ text: 'Hello! What would you like to learn?', locale: 'en-US' as const }] }
let options: CaptureOptions
let result: CaptureResult
const cancel = vi.fn()
const stop = vi.fn()

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:test')
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  await clearLocalData()
  await db.profiles.add(profile)
  await db.conversationThreads.add({ id: 'thread', profileId: profile.id, mode: 'voice', title: 'Voice', createdAt: now, updatedAt: now })
  await db.speechConnections.add({ id: 'default', apiKey: 'test', region: 'eastus', warningAcknowledged: true, configurationVersion: 1, updatedAt: now })
  vi.mocked(invokeAIOperation).mockResolvedValue(greeting as never)
  vi.mocked(playSpeechSegments).mockResolvedValue(undefined)
  result = {
    audio: encodeWav([new ArrayBuffer(32_000)]), durationMs: 1000,
    recognizedTranscript: 'Hello tutor', segments: [{ text: 'Hello tutor', locale: 'en-US' }],
    provider: { provider: 'azure', configurationVersion: 1 },
  }
  stop.mockImplementation(async () => result)
  vi.mocked(startCapture).mockImplementation(async value => { options = value; return { stop, cancel } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function open() {
  const rendered = render(<VoiceConversation threadId="thread" profile={profile} />)
  await screen.findByText(greeting.segments[0].text)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reply' })).toBeDisabled())
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record a turn (up to 2 minutes)' })).toBeEnabled())
  return rendered
}
async function record() {
  fireEvent.click(screen.getByRole('button', { name: 'Record a turn (up to 2 minutes)' }))
  await screen.findByRole('button', { name: 'Stop recording' })
}
async function stopForReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  await screen.findByText('Saved on this device.')
}

describe('reviewed voice conversation', () => {
  it('opens in English; silence does not send; stop, edit and explicit Send submit once', async () => {
    await open()
    expect(vi.mocked(invokeAIOperation).mock.calls[0][1]).toEqual({ targetLanguage: 'ja', messages: [] })
    await record()
    act(() => { options.onTranscript?.(result.segments); options.onPartial?.('partial') })
    expect(invokeAIOperation).toHaveBeenCalledTimes(1)
    expect(await db.voiceRecordings.count()).toBe(0)
    await stopForReview()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(invokeAIOperation).toHaveBeenCalledTimes(2))
    const users = (await db.conversationMessages.toArray()).filter(message => message.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].canonicalContent).toBe('Edited turn')
    expect(users[0].recognizedTranscript).toBe('Hello tutor')
    expect((await db.voiceRecordings.toArray())[0].messageId).toBe(users[0].id)
  })
  it('shows the cap warning and enters saved review without sending', async () => {
    await open()
    await record()
    act(() => options.onElapsed?.(115))
    expect(screen.getByText(/Stopping soon for review, not sending/)).toBeInTheDocument()
    act(() => options.onFinished?.(result))
    await screen.findByText('Saved on this device.')
    expect(invokeAIOperation).toHaveBeenCalledTimes(1)
    expect(await db.voiceRecordings.count()).toBe(1)
  })
  it('preserves audio and submitted text when generation fails; retry does not create another user message', async () => {
    await open(); await record(); await stopForReview()
    vi.mocked(invokeAIOperation).mockRejectedValueOnce(new Error('Network unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const retry = await screen.findByRole('button', { name: /Retry tutor reply/ })
    expect(await db.voiceRecordings.count()).toBe(1)
    fireEvent.click(retry)
    await waitFor(() => expect(invokeAIOperation).toHaveBeenCalledTimes(3))
    expect((await db.conversationMessages.toArray()).filter(message => message.role === 'user')).toHaveLength(1)
  })
  it('keeps an unsaved quota-failed take replayable and blocks Send', async () => {
    await open()
    vi.spyOn(storage, 'saveRecording').mockRejectedValueOnce(new Error('Device storage is full'))
    await record()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await screen.findByText(/Not saved on this device/)
    expect(screen.getByLabelText('Replay your recording')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving recording' }))
    await screen.findByText('Saved on this device.')
  })
  it.each([false, true])('requires explicit discard before resuming over an unsaved take (confirm: %s)', async confirmed => {
    await open(); await record(); await stopForReview()
    const previous = (await db.voiceRecordings.toArray())[0]
    const persist = vi.spyOn(storage, 'saveRecording').mockRejectedValueOnce(new Error('Device storage is full'))
    result = { ...result, audio: encodeWav([new ArrayBuffer(64_000)]), durationMs: 2000, recognizedTranscript: 'New unsaved transcript' }
    await record()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await screen.findByText(/Not saved on this device/)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited unsaved transcript' } })
    const replay = screen.getAllByLabelText('Replay your recording')[0]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(confirmed)
    fireEvent.click(screen.getByRole('button', { name: 'Resume review' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('discard its audio and transcript'))
    expect(await db.voiceRecordings.count()).toBe(1)
    if (confirmed) {
      expect(screen.getByRole('textbox')).toHaveValue(previous.recognizedTranscript)
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    } else {
      expect(screen.getByRole('textbox')).toHaveValue('Edited unsaved transcript')
      expect(screen.getAllByLabelText('Replay your recording')[0]).toBe(replay)
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Retry saving recording' }))
      await screen.findByText('Saved on this device.')
      expect(persist.mock.calls[1][0]).toMatchObject({ audio: result.audio, recognizedTranscript: 'New unsaved transcript' })
      expect(persist.mock.calls[1][0].audio).toBe(result.audio)
      expect(screen.getByRole('textbox')).toHaveValue('Edited unsaved transcript')
      expect(await db.voiceRecordings.count()).toBe(2)
    }
  })
  it('resumes and sends an edited unsent transcript after an audio-free backup round trip', async () => {
    const rendered = await open()
    await record(); await stopForReview()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Restored draft edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft edit' }))
    await waitFor(async () => expect((await db.voiceRecordings.toArray())[0].submittedTranscript).toBe('Restored draft edit'))
    rendered.unmount()
    const backup = await exportBackup()
    await clearLocalData()
    await importBackup(JSON.parse(JSON.stringify(backup)))
    render(<VoiceConversation threadId="thread" profile={profile} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume review' }))
    expect(screen.getByRole('textbox')).toHaveValue('Restored draft edit')
    expect(screen.getByText('Transcript saved on this device; audio was not included in the backup.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Replay your recording')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(async () => expect((await db.conversationMessages.toArray()).filter(message => message.role === 'user')).toHaveLength(1))
    const user = (await db.conversationMessages.toArray()).find(message => message.role === 'user')!
    expect(user).toMatchObject({ canonicalContent: 'Restored draft edit', recognizedTranscript: 'Hello tutor' })
    expect((await db.voiceRecordings.get(user.recordingId!))?.messageId).toBe(user.id)
  })
  it('suppresses late generation after Stop reply', async () => {
    await open()
    let complete!: (value: unknown) => void
    vi.mocked(invokeAIOperation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }) as never)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(invokeAIOperation).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Stop reply' }))
    await act(async () => complete({ segments: [{ text: 'Late reply', locale: 'en-US' }] }))
    expect(screen.queryByText('Late reply')).not.toBeInTheDocument()
    expect((await db.conversationMessages.toArray()).some(message => message.canonicalContent === 'Late reply')).toBe(false)
  })
  it('cancels a pending microphone start on unmount and rejects late results', async () => {
    const rendered = await open()
    let release!: (session: { stop: typeof stop; cancel: typeof cancel }) => void
    vi.mocked(startCapture).mockImplementationOnce(value => {
      options = value
      return new Promise(resolve => { release = resolve })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record a turn (up to 2 minutes)' }))
    await screen.findByRole('button', { name: 'Cancel microphone request' })
    rendered.unmount()
    expect(options.signal.aborted).toBe(true)
    await act(async () => release({ stop, cancel }))
    expect(cancel).toHaveBeenCalled()
    expect(await db.voiceRecordings.count()).toBe(0)
  })
  it('resumes a reviewed draft after remount', async () => {
    const rendered = await open()
    await record(); await stopForReview()
    rendered.unmount()
    render(<VoiceConversation threadId="thread" profile={profile} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume review' }))
    expect(screen.getByRole('textbox')).toHaveValue('Hello tutor')
  })
  it('preserves readable generated text after failed playback', async () => {
    vi.mocked(playSpeechSegments).mockRejectedValueOnce(new Error('No ja-JP voice is available'))
    render(<VoiceConversation threadId="thread" profile={profile} />)
    await screen.findByText(/No ja-JP voice is available/)
    expect(screen.getByText(greeting.segments[0].text)).toBeInTheDocument()
    const assistant = (await db.conversationMessages.toArray())[0]
    expect(assistant.status).toBe('completed')
    expect(assistant.playbackStatus).toBe('failed')
  })
  it('does not turn valid text into failed generation when saving playback metadata fails', async () => {
    const update = db.conversationMessages.update.bind(db.conversationMessages)
    vi.spyOn(db.conversationMessages, 'update').mockImplementation((key, changes) =>
      typeof changes === 'object' && 'playbackStatus' in changes
        ? Dexie.Promise.reject(new Error('Storage full'))
        : update(key, changes))
    render(<VoiceConversation threadId="thread" profile={profile} />)
    await screen.findByText(/its playback status could not be saved/)
    expect((await db.conversationMessages.toArray())[0].status).toBe('completed')
    expect(screen.getByText(greeting.segments[0].text)).toBeInTheDocument()
  })
  it('cancels recording when connection settings change and ignores subsequent capture callbacks', async () => {
    await open(); await record()
    await act(async () => { await db.speechConnections.update('default', { configurationVersion: 2 }) })
    await screen.findByText(/Connection settings changed/)
    expect(options.signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalled()
    act(() => options.onFinished?.(result))
    expect(await db.voiceRecordings.count()).toBe(0)
  })
  it('recovers a pending reply on reload with a retry action', async () => {
    await db.conversationMessages.add({ id: 'stale', threadId: 'thread', role: 'assistant', status: 'pending', canonicalContent: '', annotations: [], createdAt: now })
    render(<VoiceConversation threadId="thread" profile={profile} />)
    await screen.findByRole('button', { name: /Retry tutor reply/ })
    expect(invokeAIOperation).not.toHaveBeenCalled()
    expect((await db.conversationMessages.get('stale'))?.cancelled).toBe(true)
  })
  it('assesses the original audio and exact chosen reference without adding practice chat turns', async () => {
    await db.conversationMessages.add({
      id: 'target-message', threadId: 'thread', role: 'assistant', status: 'completed', annotations: [],
      canonicalContent: 'こんにちは', speechSegments: [{ text: 'こんにちは', locale: 'ja-JP' }], createdAt: now,
    })
    render(<VoiceConversation threadId="thread" profile={profile} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Practice: こんにちは' }))
    fireEvent.click(screen.getByRole('checkbox'))
    const recordPractice = screen.getByRole('button', { name: 'Record practice (up to 30 seconds)' })
    await waitFor(() => expect(recordPractice).toBeEnabled())
    fireEvent.click(recordPractice)
    await screen.findByRole('button', { name: 'Stop recording' })
    expect(options.mode).toBe('practice')
    await stopForReview()
    expect(assessPronunciation).not.toHaveBeenCalled()
    vi.mocked(assessPronunciation).mockResolvedValue({
      provider: result.provider, result: { status: 'assessed', accuracy: 90, fluency: 80, completeness: 100, words: [] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assess saved audio' }))
    await waitFor(() => expect(assessPronunciation).toHaveBeenCalledTimes(1))
    expect(vi.mocked(assessPronunciation).mock.calls[0].slice(0, 3)).toEqual([result.audio, 'こんにちは', 'ja-JP'])
    await waitFor(async () => expect((await db.pronunciationAttempts.toArray())[0].result?.accuracy).toBe(90))
    expect(await db.conversationMessages.count()).toBe(1)
  })
})
