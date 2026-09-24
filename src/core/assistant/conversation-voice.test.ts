import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireAudio, interruptAudio } from './audio-owner'
import type { AssistantBlock, SpeechLocale, SpeechRate } from './contracts'
import { conversationCaptureSupported, speakConversationReply, startConversationCapture, type ConversationCaptureState } from './conversation-voice'
import { prepareRecordingCue, type RecordingCue } from './recording-cue'
import { speechCaptureSupported, startSpeechCapture, type SpeechCaptureSession, type SpeechCaptureState } from './speech-capture'
import { playBrowserSpeechToEnd, stopBrowserSpeech, type PlaybackOutcome } from './speech'

vi.mock('./recording-cue', () => ({ prepareRecordingCue: vi.fn() }))
vi.mock('./speech-capture', () => ({ speechCaptureSupported: vi.fn(), startSpeechCapture: vi.fn() }))
vi.mock('./speech', () => ({ playBrowserSpeechToEnd: vi.fn(), stopBrowserSpeech: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

async function flush() {
  for (let index = 0; index < 10; index++) await Promise.resolve()
}

const captures: {
  receive: (state: SpeechCaptureState) => void
  handle: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
}[] = []
const cues: { handle: RecordingCue; completion: ReturnType<typeof deferred<void>> }[] = []
const utterances: ReturnType<typeof deferred<PlaybackOutcome>>[] = []
const sessions: SpeechCaptureSession[] = []
const replies: ReturnType<typeof speakConversationReply>[] = []
const blocks: AssistantBlock[] = [
  { type: 'text', markdown: '**Not spoken**' },
  { type: 'speech', text: 'Hello', locale: 'en-US', romanization: 'ignored', meaning: 'ignored too' },
  { type: 'speech', text: '你好', locale: 'zh-Hans', romanization: 'nǐ hǎo', meaning: 'Hello' },
]

function begin(locale: SpeechLocale = 'en-US', onState?: (state: ConversationCaptureState) => void) {
  const listener = vi.fn<(state: ConversationCaptureState) => void>(onState)
  const session = startConversationCapture(locale, listener)
  sessions.push(session)
  return { session, listener, last: () => listener.mock.calls[listener.mock.calls.length - 1]?.[0] }
}

function speak(input: readonly AssistantBlock[] = blocks, rate: SpeechRate = 0.75) {
  const reply = speakConversationReply(input, rate)
  replies.push(reply)
  return reply
}

function listening(transcript = '') {
  captures[captures.length - 1].receive({ phase: 'listening', transcript })
}

function pageCancel(reason: string) {
  if (reason === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  else if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'))
  else {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('AudioContext', vi.fn())
  vi.mocked(speechCaptureSupported).mockReturnValue(true)
  vi.mocked(prepareRecordingCue).mockImplementation(() => {
    const completion = deferred<void>()
    const handle: RecordingCue = {
      play: vi.fn(() => completion.promise),
      cancel: vi.fn(() => {
        completion.reject(new DOMException('cancelled', 'AbortError'))
        return Promise.resolve()
      }),
      takeContext: vi.fn(),
    }
    cues.push({ handle, completion })
    return handle
  })
  vi.mocked(startSpeechCapture).mockImplementation(receive => {
    const handle = {
      stop: vi.fn(),
      cancel: vi.fn(() => receive({ phase: 'finished', transcript: '', cancelled: true })),
    }
    captures.push({ receive, handle })
    receive({ phase: 'starting', transcript: '' })
    return handle
  })
  vi.mocked(playBrowserSpeechToEnd).mockImplementation(() => {
    const utterance = deferred<PlaybackOutcome>()
    utterances.push(utterance)
    return utterance.promise
  })
})

afterEach(async () => {
  sessions.splice(0).forEach(session => session.cancel())
  replies.splice(0).forEach(reply => reply.cancel())
  interruptAudio()
  await flush()
  captures.length = 0
  cues.length = 0
  utterances.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('explicit conversation dictation', () => {
  it('checks capability without initializing audio, capture, playback, or network', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(conversationCaptureSupported()).toBe(true)
    vi.mocked(speechCaptureSupported).mockReturnValue(false)
    expect(conversationCaptureSupported()).toBe(false)
    vi.mocked(speechCaptureSupported).mockReturnValue(true)
    vi.stubGlobal('AudioContext', undefined)
    expect(conversationCaptureSupported()).toBe(false)
    expect(prepareRecordingCue).not.toHaveBeenCalled()
    expect(startSpeechCapture).not.toHaveBeenCalled()
    expect(stopBrowserSpeech).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['en-US', 'zh-Hans'] as const)('prepares the cue synchronously and requests %s, but plays only when native listening begins', async locale => {
    const result = begin(locale)
    expect(stopBrowserSpeech).toHaveBeenCalledOnce()
    expect(prepareRecordingCue).toHaveBeenCalledOnce()
    expect(startSpeechCapture).toHaveBeenCalledWith(expect.any(Function), { locale })
    expect(vi.mocked(stopBrowserSpeech).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(prepareRecordingCue).mock.invocationCallOrder[0])
    expect(vi.mocked(prepareRecordingCue).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(startSpeechCapture).mock.invocationCallOrder[0])
    expect(result.last()).toEqual({ phase: 'starting', transcript: '' })
    expect(cues[0].handle.play).not.toHaveBeenCalled()
    listening()
    expect(result.last()).toEqual({ phase: 'cue', transcript: '' })
    expect(cues[0].handle.play).toHaveBeenCalledOnce()
    listening('early interim')
    expect(result.last()).toEqual({ phase: 'cue', transcript: '' })
    cues[0].completion.resolve()
    await flush()
    expect(result.last()).toEqual({ phase: 'listening', transcript: 'early interim' })
    listening('final snapshot')
    expect(result.last()).toEqual({ phase: 'listening', transcript: 'final snapshot' })
    expect(cues[0].handle.play).toHaveBeenCalledOnce()
  })

  it('returns naturally completed dictation without sending it, speaking, or auto-listening', async () => {
    const fetch = vi.fn()
    const getUserMedia = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const result = begin()
    listening()
    cues[0].completion.resolve()
    await flush()
    captures[0].receive({ phase: 'finished', transcript: 'Please explain this phrase' })
    await flush()
    expect(result.last()).toEqual({ phase: 'finished', transcript: 'Please explain this phrase' })
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
    expect(captures[0].handle.cancel).not.toHaveBeenCalled()
    expect(startSpeechCapture).toHaveBeenCalledOnce()
    expect(playBrowserSpeechToEnd).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it.each(['starting', 'cue', 'listening'])('Stop in %s waits for the final native snapshot', async phase => {
    const result = begin()
    if (phase !== 'starting') listening('interim')
    if (phase === 'listening') { cues[0].completion.resolve(); await flush() }
    result.session.stop()
    result.session.stop()
    expect(result.last()?.phase).toBe('stopping')
    expect(captures[0].handle.stop).toHaveBeenCalledOnce()
    expect(captures[0].handle.cancel).not.toHaveBeenCalled()
    captures[0].receive({ phase: 'stopping', transcript: 'complete final snapshot' })
    captures[0].receive({ phase: 'finished', transcript: 'complete final snapshot' })
    await flush()
    expect(result.last()).toEqual({ phase: 'finished', transcript: 'complete final snapshot' })
    expect(result.listener.mock.calls.filter(([state]) => state.phase === 'finished')).toHaveLength(1)
  })

  it('finishes rather than resurrecting listening when recognition ends before the cue', async () => {
    const result = begin()
    listening('available text')
    captures[0].receive({ phase: 'finished', transcript: 'available text' })
    cues[0].completion.resolve()
    await flush()
    expect(result.listener.mock.calls.map(([state]) => state.phase)).toEqual(['starting', 'cue', 'finished'])
    expect(result.last()?.transcript).toBe('available text')
  })

  it.each(['Escape', 'pagehide', 'hidden'])('cancels the whole pending cue on %s and ignores late callbacks', async reason => {
    const result = begin()
    listening('retained')
    pageCancel(reason)
    await flush()
    expect(result.last()).toEqual({ phase: 'finished', transcript: 'retained', cancelled: true })
    expect(captures[0].handle.cancel).toHaveBeenCalledOnce()
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
    const calls = result.listener.mock.calls.length
    listening('stale')
    captures[0].receive({ phase: 'error', transcript: '', error: 'stale error' })
    cues[0].completion.resolve()
    result.session.cancel()
    result.session.stop()
    await flush()
    expect(result.listener).toHaveBeenCalledTimes(calls)
  })

  it('does not initialize microphone or cue on an already hidden page', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const result = begin()
    await flush()
    expect(result.last()).toMatchObject({ phase: 'finished', cancelled: true })
    expect(prepareRecordingCue).not.toHaveBeenCalled()
    expect(startSpeechCapture).not.toHaveBeenCalled()
  })

  it('cancels recognition even if Escape happens before its handle is returned', async () => {
    const handle = { stop: vi.fn(), cancel: vi.fn() }
    vi.mocked(startSpeechCapture).mockImplementation(receive => {
      receive({ phase: 'listening', transcript: '' })
      return handle
    })
    const result = begin('en-US', state => { if (state.phase === 'cue') pageCancel('Escape') })
    await flush()
    expect(handle.cancel).toHaveBeenCalledOnce()
    expect(cues[0].handle.play).not.toHaveBeenCalled()
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
    expect(result.last()).toMatchObject({ cancelled: true })
  })

  it('cleans up cue preparation cancelled before the prepared handle is assigned', async () => {
    const prepare = vi.mocked(prepareRecordingCue).getMockImplementation()!
    vi.mocked(prepareRecordingCue).mockImplementation(() => {
      const cue = prepare()
      pageCancel('pagehide')
      return cue
    })
    const result = begin()
    await flush()
    expect(result.last()).toMatchObject({ cancelled: true })
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
    expect(startSpeechCapture).not.toHaveBeenCalled()
  })

  it('cleans up a synchronously completed recognition without aborting it or playing a late cue', async () => {
    const handle = { stop: vi.fn(), cancel: vi.fn() }
    vi.mocked(startSpeechCapture).mockImplementation(receive => {
      receive({ phase: 'listening', transcript: '' })
      receive({ phase: 'finished', transcript: 'synchronous result' })
      return handle
    })
    const result = begin()
    await flush()
    expect(result.last()).toEqual({ phase: 'finished', transcript: 'synchronous result' })
    expect(handle.cancel).not.toHaveBeenCalled()
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
  })

  it('supersedes older capture and cannot let stale cancellation stop its replacement', async () => {
    const first = begin()
    listening()
    const second = begin('zh-Hans')
    await flush()
    expect(first.last()).toMatchObject({ cancelled: true })
    expect(second.last()?.phase).toBe('starting')
    first.session.cancel()
    first.session.stop()
    expect(captures[1].handle.cancel).not.toHaveBeenCalled()
    expect(cues[1].handle.cancel).not.toHaveBeenCalled()
  })

  it('does not start a superseded capture when interruption reentrantly acquires another flow', async () => {
    let newest: ReturnType<typeof begin> | undefined
    acquireAudio(() => { newest = begin('zh-Hans') })
    const superseded = begin('en-US')
    await flush()
    expect(superseded.last()).toMatchObject({ cancelled: true })
    expect(newest?.last()?.phase).toBe('starting')
    expect(startSpeechCapture).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { locale: 'zh-Hans' })
  })

  it('lets a reentrant reply supersede a cue listener without then starting the tone', async () => {
    const result = begin('en-US', state => { if (state.phase === 'cue') speak() })
    listening()
    await flush()
    expect(result.last()).toMatchObject({ cancelled: true })
    expect(cues[0].handle.play).not.toHaveBeenCalled()
    expect(captures[0].handle.cancel).toHaveBeenCalledOnce()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('removes all page listeners after completion', async () => {
    const addedDocument = vi.spyOn(document, 'addEventListener')
    const removedDocument = vi.spyOn(document, 'removeEventListener')
    const addedWindow = vi.spyOn(window, 'addEventListener')
    const removedWindow = vi.spyOn(window, 'removeEventListener')
    begin()
    captures[0].receive({ phase: 'finished', transcript: 'done' })
    await flush()
    for (const [type, callback, options] of addedDocument.mock.calls) {
      expect(removedDocument).toHaveBeenCalledWith(...(options === undefined ? [type, callback] : [type, callback, options]))
    }
    for (const [type, callback] of addedWindow.mock.calls) expect(removedWindow).toHaveBeenCalledWith(type, callback)
  })
})

describe('visible dictation failures', () => {
  it('rejects unsupported languages and unsupported browsers without opening audio', async () => {
    const invalid = begin('fr-FR' as SpeechLocale)
    await flush()
    expect(invalid.last()?.error).toContain('supports only')
    vi.mocked(speechCaptureSupported).mockReturnValue(false)
    const unsupported = begin()
    await flush()
    expect(unsupported.last()?.error).toContain('not supported')
    expect(prepareRecordingCue).not.toHaveBeenCalled()
    expect(startSpeechCapture).not.toHaveBeenCalled()
  })

  it('does not open microphone after prior speech cannot be stopped', async () => {
    vi.mocked(stopBrowserSpeech).mockReturnValue('The browser could not stop speech playback.')
    const result = begin()
    await flush()
    expect(result.last()?.error).toContain('could not stop speech')
    expect(prepareRecordingCue).not.toHaveBeenCalled()
    expect(startSpeechCapture).not.toHaveBeenCalled()
  })

  it('reports cue preparation failure without starting dictation', async () => {
    vi.mocked(prepareRecordingCue).mockImplementation(() => { throw new Error('audio unavailable') })
    const result = begin()
    await flush()
    expect(result.last()).toMatchObject({ phase: 'error', error: expect.stringContaining('audio unavailable') })
    expect(startSpeechCapture).not.toHaveBeenCalled()
  })

  it('reports native permission errors and cleans a cue which was never played', async () => {
    const result = begin()
    captures[0].receive({ phase: 'error', transcript: '', error: 'Microphone permission denied' })
    await flush()
    expect(result.last()?.error).toContain('permission denied')
    expect(cues[0].handle.play).not.toHaveBeenCalled()
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
  })

  it.each(['throw', 'reject'])('reports cue playback %s and aborts dictation', async kind => {
    const result = begin()
    if (kind === 'throw') vi.mocked(cues[0].handle.play).mockImplementation(() => { throw new Error('tone failed') })
    listening()
    if (kind === 'reject') cues[0].completion.reject(new Error('tone failed'))
    await flush()
    expect(result.last()).toMatchObject({ phase: 'error', error: expect.stringContaining('tone failed') })
    expect(captures[0].handle.cancel).toHaveBeenCalledOnce()
  })

  it('reports cue cleanup failures along with an original recognition error', async () => {
    const result = begin()
    vi.mocked(cues[0].handle.cancel).mockRejectedValue(new Error('context stuck'))
    captures[0].receive({ phase: 'error', transcript: '', error: 'network failed' })
    await flush()
    expect(result.last()?.error).toContain('network failed')
    expect(result.last()?.error).toContain('context stuck')
  })

  it('reports native abort failures while retaining cancellation identity', async () => {
    const result = begin()
    captures[0].handle.cancel.mockImplementation(() => {
      captures[0].receive({ phase: 'error', transcript: '', cancelled: true, error: 'abort failed' })
    })
    result.session.cancel()
    await flush()
    expect(result.last()).toMatchObject({ phase: 'error', cancelled: true, error: expect.stringContaining('abort failed') })
  })

  it.each(['starting', 'cue', 'listening'])('cleans resources and reports an exception in a %s listener', async phase => {
    const result = begin('en-US', state => { if (state.phase === phase) throw new Error('listener failed') })
    if (phase !== 'starting') listening()
    if (phase === 'listening') cues[0].completion.resolve()
    await flush()
    expect(result.last()).toMatchObject({ phase: 'error', error: expect.stringContaining('listener failed') })
    if (phase !== 'starting') {
      expect(captures[0].handle.cancel).toHaveBeenCalledOnce()
      expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
    } else expect(startSpeechCapture).not.toHaveBeenCalled()
  })

  it('reports a terminal-listener exception without an unhandled promise or leaked resources', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = begin('en-US', state => { if (state.phase === 'finished') throw new Error('terminal listener failed') })
    result.session.cancel()
    await flush()
    expect(report).toHaveBeenCalledWith(expect.stringContaining('terminal listener failed'))
    expect(captures[0].handle.cancel).toHaveBeenCalledOnce()
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
  })
})

describe('explicit queued tutor speech', () => {
  it.each([0.25, 0.75] as const)('plays only locale-tagged speech in order, English normally and Mandarin at %s', async rate => {
    const reply = speak(blocks, rate)
    expect(playBrowserSpeechToEnd).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'Hello', 'en-US', 1)
    utterances[0].resolve({ status: 'completed' })
    await flush()
    expect(playBrowserSpeechToEnd).toHaveBeenLastCalledWith(expect.any(String), '你好', 'zh-Hans', rate)
    expect(playBrowserSpeechToEnd).toHaveBeenCalledTimes(2)
    utterances[1].resolve({ status: 'completed' })
    await expect(reply.done).resolves.toEqual({ status: 'completed' })
    expect(startSpeechCapture).not.toHaveBeenCalled()
    expect(prepareRecordingCue).not.toHaveBeenCalled()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledTimes(2)
  })

  it('interrupts existing dictation before beginning a tutor reply', async () => {
    const capture = begin()
    listening()
    speak()
    await flush()
    expect(capture.last()).toMatchObject({ cancelled: true })
    expect(captures[0].handle.cancel).toHaveBeenCalledOnce()
    expect(cues[0].handle.cancel).toHaveBeenCalledOnce()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('finishes with a visible error for replies without speakable blocks', async () => {
    const reply = speak([{ type: 'text', markdown: 'Just markdown' }])
    await expect(reply.done).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('no locale-tagged speech') })
    expect(playBrowserSpeechToEnd).not.toHaveBeenCalled()
  })

  it.each([
    [],
    Array.from({ length: 13 }, () => blocks[1]),
    [{ type: 'speech', text: 'bonjour', locale: 'fr-FR' }],
    [{ type: 'speech', text: 'a'.repeat(3001), locale: 'en-US' }],
    [{ type: 'speech', text: ' ', locale: 'en-US' }],
  ].map(input => ({ input })))('rejects invalid or unbounded speech blocks (case %#)', async ({ input }) => {
    const reply = speak(input as AssistantBlock[])
    await expect(reply.done).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('invalid speech blocks') })
    expect(playBrowserSpeechToEnd).not.toHaveBeenCalled()
  })

  it('validates the rate instead of silently clamping it', async () => {
    await expect(speak(blocks, 0.6 as SpeechRate).done).resolves.toMatchObject({ status: 'error' })
    expect(playBrowserSpeechToEnd).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'supersede', 'Escape', 'pagehide', 'hidden'])('prevents every remaining block after %s', async reason => {
    const reply = speak()
    if (reason === 'cancel') reply.cancel()
    else if (reason === 'supersede') acquireAudio(vi.fn())
    else pageCancel(reason)
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    expect(stopBrowserSpeech).toHaveBeenCalledTimes(2)
    utterances[0].resolve({ status: 'completed' })
    await flush()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
    reply.cancel()
    expect(stopBrowserSpeech).toHaveBeenCalledTimes(2)
  })

  it('prevents the second block when cancelled between a completed block and its continuation', async () => {
    const reply = speak()
    utterances[0].resolve({ status: 'completed' })
    reply.cancel()
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    await flush()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('allows new capture to interrupt the complete remaining reply queue', async () => {
    const reply = speak()
    begin()
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    utterances[0].resolve({ status: 'completed' })
    await flush()
    expect(startSpeechCapture).toHaveBeenCalledOnce()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('ignores late completion and stale cancellation after a newer reply starts', async () => {
    const old = speak()
    const next = speak()
    await expect(old.done).resolves.toEqual({ status: 'cancelled' })
    const stops = vi.mocked(stopBrowserSpeech).mock.calls.length
    old.cancel()
    utterances[0].resolve({ status: 'completed' })
    await flush()
    expect(stopBrowserSpeech).toHaveBeenCalledTimes(stops)
    expect(playBrowserSpeechToEnd).toHaveBeenCalledTimes(2)
    utterances[1].resolve({ status: 'completed' })
    await flush()
    utterances[2].resolve({ status: 'completed' })
    await expect(next.done).resolves.toEqual({ status: 'completed' })
  })

  it.each(['cancelled', 'error'] as const)('stops at a %s block outcome without trying later blocks', async status => {
    const reply = speak()
    const outcome: PlaybackOutcome = status === 'error' ? { status, error: 'voice unavailable' } : { status }
    utterances[0].resolve(outcome)
    await expect(reply.done).resolves.toEqual(outcome)
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('converts a rejected playback promise to an error outcome and stops active speech', async () => {
    const reply = speak()
    utterances[0].reject(new Error('speech failed'))
    await expect(reply.done).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('speech failed') })
    expect(stopBrowserSpeech).toHaveBeenCalledTimes(2)
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('reports stop failures rather than pretending cancellation succeeded', async () => {
    const reply = speak()
    vi.mocked(stopBrowserSpeech).mockReturnValue('speech stuck')
    reply.cancel()
    await expect(reply.done).resolves.toEqual({ status: 'error', error: 'speech stuck' })
  })

  it('does not start when a reentrant claim cancels its lease before assignment', async () => {
    acquireAudio(() => { begin() })
    const reply = speak()
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    expect(playBrowserSpeechToEnd).not.toHaveBeenCalled()
    expect(startSpeechCapture).toHaveBeenCalledOnce()
  })

  it('handles a synchronous cancellation during playback startup', async () => {
    const play = vi.mocked(playBrowserSpeechToEnd).getMockImplementation()!
    vi.mocked(playBrowserSpeechToEnd).mockImplementation((...args) => {
      pageCancel('Escape')
      return play(...args)
    })
    const reply = speak()
    await expect(reply.done).resolves.toEqual({ status: 'cancelled' })
    utterances[0].resolve({ status: 'completed' })
    await flush()
    expect(playBrowserSpeechToEnd).toHaveBeenCalledOnce()
  })

  it('does not play on a hidden page', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await expect(speak().done).resolves.toEqual({ status: 'cancelled' })
    expect(playBrowserSpeechToEnd).not.toHaveBeenCalled()
  })

  it('releases ownership and page listeners after natural completion', async () => {
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const reply = speak([blocks[1]])
    utterances[0].resolve({ status: 'completed' })
    await reply.done
    const stops = vi.mocked(stopBrowserSpeech).mock.calls.length
    acquireAudio(vi.fn())
    expect(stopBrowserSpeech).toHaveBeenCalledTimes(stops)
    for (const [type, callback, options] of added.mock.calls) {
      expect(removed).toHaveBeenCalledWith(...(options === undefined ? [type, callback] : [type, callback, options]))
    }
  })
})
