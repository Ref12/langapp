import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_DRAFT_LENGTH, type SpeechLocale } from './contracts'
import { speechCaptureSupported, startSpeechCapture, type SpeechCaptureSession, type SpeechCaptureState } from './speech-capture'

type Recognition = NonNullable<Window['SpeechRecognition']> extends new () => infer Instance ? Instance : never
type ResultEvent = Parameters<NonNullable<Recognition['onresult']>>[0]

class FakeRecognition implements Recognition {
  static instances: FakeRecognition[] = []
  static construct = vi.fn<() => void>()
  static begin = vi.fn<(recognition: FakeRecognition) => void>()
  lang = ''
  interimResults = false
  continuous = true
  maxAlternatives = 5
  onstart: Recognition['onstart'] = null
  onresult: Recognition['onresult'] = null
  onerror: Recognition['onerror'] = null
  onend: Recognition['onend'] = null
  start = vi.fn(() => FakeRecognition.begin(this))
  stop = vi.fn<() => void>()
  abort = vi.fn<() => void>()

  constructor() {
    FakeRecognition.construct()
    FakeRecognition.instances.push(this)
  }
}

const sessions: SpeechCaptureSession[] = []

function resultEvent(parts: (string | { text: string; final: boolean })[], resultIndex = 0): ResultEvent {
  return {
    resultIndex,
    results: parts.map(part => ({
      0: { transcript: typeof part === 'string' ? part : part.text },
      length: 1,
      isFinal: typeof part !== 'string' && part.final,
    })),
  }
}

function start() {
  const listener = vi.fn<(state: SpeechCaptureState) => void>()
  const session = startSpeechCapture(listener)
  sessions.push(session)
  const recognition = FakeRecognition.instances[FakeRecognition.instances.length - 1]
  return { listener, session, recognition, last: () => listener.mock.calls[listener.mock.calls.length - 1][0] }
}

function expectClean(recognition?: FakeRecognition) {
  expect(vi.getTimerCount()).toBe(0)
  if (recognition) {
    expect(recognition.onstart).toBeNull()
    expect(recognition.onresult).toBeNull()
    expect(recognition.onerror).toBeNull()
    expect(recognition.onend).toBeNull()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRecognition.instances = []
  FakeRecognition.construct.mockReset()
  FakeRecognition.begin.mockReset()
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  vi.stubGlobal('webkitSpeechRecognition', undefined)
})

afterEach(() => {
  sessions.splice(0).forEach(session => session.cancel())
  expectClean()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('explicit Mandarin speech capture', () => {
  it('checks capability without constructing recognition, requesting permission, capturing, or fetching', () => {
    const fetch = vi.fn()
    const getUserMedia = vi.fn()
    const query = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, permissions: { query } })
    expect(speechCaptureSupported()).toBe(true)
    expect(speechCaptureSupported()).toBe(true)
    expect(FakeRecognition.construct).not.toHaveBeenCalled()
    expect(FakeRecognition.begin).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expectClean()
  })

  it.each(['SpeechRecognition', 'webkitSpeechRecognition'])('starts only explicitly, using %s in Mandarin', name => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal(name, FakeRecognition)
    expect(speechCaptureSupported()).toBe(true)
    expect(FakeRecognition.instances).toHaveLength(0)
    const { recognition, last } = start()
    expect(recognition).toMatchObject({
      lang: 'zh-CN', interimResults: true, continuous: false, maxAlternatives: 1,
    })
    expect(recognition.start).toHaveBeenCalledExactlyOnceWith()
    expect(last()).toEqual({ phase: 'starting', transcript: '' })
    recognition.onstart?.()
    expect(last()).toEqual({ phase: 'listening', transcript: '' })
  })

  it('prefers the standard implementation to the prefixed one', () => {
    const prefixed = vi.fn()
    vi.stubGlobal('webkitSpeechRecognition', prefixed)
    start()
    expect(FakeRecognition.construct).toHaveBeenCalledOnce()
    expect(prefixed).not.toHaveBeenCalled()
  })

  it.each([['en-US', 'en-US'], ['zh-Hans', 'zh-CN']] as const)('uses explicit %s without changing the dictation lifecycle', (locale, language) => {
    const listener = vi.fn()
    sessions.push(startSpeechCapture(listener, { locale }))
    const recognition = FakeRecognition.instances[0]
    expect(recognition.lang).toBe(language)
    recognition.onstart?.()
    recognition.onresult?.(resultEvent(['a complete snapshot']))
    recognition.onend?.()
    expect(listener).toHaveBeenLastCalledWith({ phase: 'finished', transcript: 'a complete snapshot' })
    expectClean(recognition)
  })

  it.each(['fr-FR', 'zh-CN', '', null])('rejects unsupported locale %s without starting a fallback', locale => {
    const listener = vi.fn()
    sessions.push(startSpeechCapture(listener, { locale: locale as SpeechLocale }))
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', error: expect.stringContaining('supports only') }))
    expect(FakeRecognition.construct).not.toHaveBeenCalled()
    expectClean()
  })

  it('reports the requested English language rather than claiming Mandarin failed', () => {
    const listener = vi.fn()
    sessions.push(startSpeechCapture(listener, { locale: 'en-US' }))
    FakeRecognition.instances[0].onerror?.({ error: 'language-not-supported' })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', error: expect.stringContaining('English (en-US)') }))
    expectClean(FakeRecognition.instances[0])
  })

  it('reports unsupported capture visibly, without starting or installing a fallback', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    expect(speechCaptureSupported()).toBe(false)
    const { last, session } = start()
    expect(last()).toMatchObject({ phase: 'error', transcript: '', error: expect.stringContaining('not supported') })
    session.stop()
    session.cancel()
    expect(FakeRecognition.construct).not.toHaveBeenCalled()
    expectClean()
  })

  it('reports unsupported capture outside a browser', () => {
    vi.stubGlobal('window', undefined)
    expect(speechCaptureSupported()).toBe(false)
    expect(start().last()).toMatchObject({ phase: 'error', error: expect.stringContaining('not supported') })
    expectClean()
  })

  it('does not access audio directly or send captured text through fetch', () => {
    const fetch = vi.fn()
    const getUserMedia = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const { recognition } = start()
    recognition.onstart?.()
    recognition.onresult?.(resultEvent(['我想喝茶']))
    recognition.onend?.()
    expect(fetch).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    expectClean(recognition)
  })
})

describe('bounded recognition result snapshots', () => {
  it('joins full results without duplicating changing interim or previously final fragments', () => {
    const { recognition, last } = start()
    recognition.onstart?.()
    recognition.onresult?.(resultEvent([' 我 ']))
    expect(last().transcript).toBe('我')
    recognition.onresult?.(resultEvent([' 我想 ']))
    expect(last().transcript).toBe('我想')
    const final = { text: '我想', final: true }
    recognition.onresult?.(resultEvent([final, '喝']))
    expect(last().transcript).toBe('我想 喝')
    recognition.onresult?.(resultEvent([final, '喝茶'], 1))
    expect(last().transcript).toBe('我想 喝茶')
    recognition.onresult?.(resultEvent([final, { text: '喝茶', final: true }], 1))
    recognition.onend?.()
    expect(last()).toEqual({ phase: 'finished', transcript: '我想 喝茶' })
    expectClean(recognition)
  })

  it('honors the full snapshot even when the first event has a nonzero result index', () => {
    const { recognition, last } = start()
    recognition.onresult?.(resultEvent([{ text: '你好', final: true }, '世界'], 1))
    expect(last()).toEqual({ phase: 'starting', transcript: '你好 世界' })
    recognition.onstart?.()
    expect(last()).toEqual({ phase: 'listening', transcript: '你好 世界' })
  })

  it('removes retracted interim results and excludes blank fragments and extra alternatives', () => {
    const { recognition, last } = start()
    const final = { text: '你好', final: true }
    recognition.onresult?.(resultEvent([final, '世界']))
    recognition.onresult?.(resultEvent([final], 1))
    expect(last().transcript).toBe('你好')
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: ' ' }, length: 1, isFinal: false }, {
        0: { transcript: '你好' }, 1: { transcript: 'wrong alternative' }, length: 2, isFinal: true,
      }],
    })
    expect(last().transcript).toBe('你好')
    recognition.onresult?.(resultEvent([]))
    expect(last().transcript).toBe('')
  })

  it('retains the last recognized text on end even if no final replacement arrives', () => {
    const { recognition, last } = start()
    recognition.onstart?.()
    recognition.onresult?.(resultEvent(['你好']))
    recognition.onend?.()
    expect(last()).toEqual({ phase: 'finished', transcript: '你好' })
  })

  it('accepts the exact draft limit and rejects overflow without silently truncating', () => {
    const { recognition, last } = start()
    const text = '中'.repeat(MAX_DRAFT_LENGTH)
    recognition.onstart?.()
    recognition.onresult?.(resultEvent([text]))
    expect(last()).toEqual({ phase: 'listening', transcript: text })
    recognition.onresult?.(resultEvent([text + '文']))
    expect(last()).toMatchObject({ phase: 'error', transcript: text, error: expect.stringContaining(`${MAX_DRAFT_LENGTH}-character limit`) })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('counts joined separators toward the limit and retains the entire previous valid snapshot', () => {
    const { recognition, last } = start()
    recognition.onresult?.(resultEvent(['原来的文字']))
    recognition.onresult?.(resultEvent(['中'.repeat(MAX_DRAFT_LENGTH - 1), '文']))
    expect(last()).toMatchObject({ phase: 'error', transcript: '原来的文字' })
    expect(last().error).toContain('limit')
    expectClean(recognition)
  })
})

describe('bounded capture lifecycle', () => {
  it('does not claim to be listening during permission and aborts a stalled start after ten seconds', () => {
    const { recognition, last } = start()
    vi.advanceTimersByTime(9999)
    expect(last().phase).toBe('starting')
    vi.advanceTimersByTime(1)
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('10 seconds') })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('clears the startup watchdog on start and caps listening at sixty seconds', () => {
    const { recognition, last } = start()
    vi.advanceTimersByTime(9000)
    recognition.onstart?.()
    vi.advanceTimersByTime(59_999)
    expect(last().phase).toBe('listening')
    expect(recognition.stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(last().phase).toBe('stopping')
    expect(recognition.stop).toHaveBeenCalledOnce()
    recognition.onresult?.(resultEvent([{ text: '谢谢', final: true }]))
    recognition.onend?.()
    expect(last()).toEqual({ phase: 'finished', transcript: '谢谢' })
    expectClean(recognition)
  })

  it('does not extend the capture limit after duplicate start callbacks', () => {
    const { recognition, last } = start()
    recognition.onstart?.()
    vi.advanceTimersByTime(30_000)
    recognition.onstart?.()
    vi.advanceTimersByTime(30_000)
    expect(last().phase).toBe('stopping')
    expect(recognition.stop).toHaveBeenCalledOnce()
  })

  it('accepts final results for five seconds after Stop and keeps Stop idempotent', () => {
    const { recognition, session, listener, last } = start()
    recognition.onstart?.()
    recognition.onresult?.(resultEvent(['喝']))
    session.stop()
    session.stop()
    expect(recognition.stop).toHaveBeenCalledOnce()
    expect(last()).toEqual({ phase: 'stopping', transcript: '喝' })
    vi.advanceTimersByTime(4999)
    recognition.onresult?.(resultEvent([{ text: '喝茶', final: true }]))
    recognition.onend?.()
    expect(last()).toEqual({ phase: 'finished', transcript: '喝茶' })
    const calls = listener.mock.calls.length
    session.stop()
    session.cancel()
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(recognition.abort).not.toHaveBeenCalled()
    expectClean(recognition)
  })

  it('aborts with an explicit error if native stop never ends', () => {
    const { recognition, session, last } = start()
    recognition.onstart?.()
    session.stop()
    vi.advanceTimersByTime(5000)
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('did not finish after Stop') })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('bounds Stop during pending permission and stops again if permission subsequently resolves', () => {
    const { recognition, session, listener, last } = start()
    session.stop()
    vi.advanceTimersByTime(4000)
    recognition.onstart?.()
    expect(recognition.stop).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls.map(([state]) => state.phase)).toEqual(['starting', 'stopping'])
    vi.advanceTimersByTime(1000)
    expect(last().phase).toBe('error')
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('finishes an intentional pending-start Stop when the browser ends without starting', () => {
    const { recognition, session, last } = start()
    session.stop()
    recognition.onend?.()
    expect(last()).toEqual({ phase: 'finished', transcript: '' })
    expectClean(recognition)
  })

  it('cancels pending permission immediately and ignores all cached native callbacks', () => {
    const { recognition, session, listener, last } = start()
    const late = { start: recognition.onstart, result: recognition.onresult, error: recognition.onerror, end: recognition.onend }
    session.cancel()
    session.cancel()
    session.stop()
    expect(last()).toEqual({ phase: 'finished', transcript: '', cancelled: true })
    late.start?.()
    late.result?.(resultEvent(['stale']))
    late.error?.({ error: 'not-allowed' })
    late.end?.()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('retains the last valid transcript when cancelling while listening or stopping', () => {
    const { recognition, session, last } = start()
    recognition.onstart?.()
    recognition.onresult?.(resultEvent(['我想喝茶']))
    session.stop()
    session.cancel()
    expect(last()).toEqual({ phase: 'finished', transcript: '我想喝茶', cancelled: true })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('replaces the active capture and prevents old sessions and callbacks affecting the new one', () => {
    const first = start()
    first.recognition.onstart?.()
    first.recognition.onresult?.(resultEvent(['旧的']))
    const late = { start: first.recognition.onstart, result: first.recognition.onresult, error: first.recognition.onerror, end: first.recognition.onend }
    const second = start()
    expect(first.last()).toEqual({ phase: 'finished', transcript: '旧的', cancelled: true })
    expect(first.recognition.abort).toHaveBeenCalledOnce()
    first.session.stop()
    first.session.cancel()
    late.start?.()
    late.result?.(resultEvent(['旧回调']))
    late.error?.({ error: 'network' })
    late.end?.()
    expect(second.last()).toEqual({ phase: 'starting', transcript: '' })
    second.recognition.onstart?.()
    second.recognition.onresult?.(resultEvent(['新的']))
    second.recognition.onend?.()
    expect(second.last()).toEqual({ phase: 'finished', transcript: '新的' })
    expect(second.recognition.abort).not.toHaveBeenCalled()
    expectClean(first.recognition)
    expectClean(second.recognition)
  })

  it('supports synchronous start/result/end events without leaving timers behind', () => {
    FakeRecognition.begin.mockImplementation(recognition => {
      recognition.onstart?.()
      recognition.onresult?.(resultEvent([{ text: '你好', final: true }]))
      recognition.onend?.()
    })
    const { recognition, listener, last } = start()
    expect(listener.mock.calls.map(([state]) => state.phase)).toEqual(['starting', 'listening', 'listening', 'finished'])
    expect(last()).toEqual({ phase: 'finished', transcript: '你好' })
    expectClean(recognition)
  })

  it('supports synchronous final result/end during Stop', () => {
    const { recognition, session, last } = start()
    recognition.onstart?.()
    recognition.stop.mockImplementation(() => {
      recognition.onresult?.(resultEvent([{ text: '再见', final: true }]))
      recognition.onend?.()
    })
    session.stop()
    expect(last()).toEqual({ phase: 'finished', transcript: '再见' })
    expectClean(recognition)
  })

  it('invalidates callbacks before native abort can synchronously deliver results or errors', () => {
    const { recognition, session, listener, last } = start()
    recognition.onresult?.(resultEvent(['保留']))
    const result = recognition.onresult
    const error = recognition.onerror
    recognition.abort.mockImplementation(() => {
      result?.(resultEvent(['不要覆盖']))
      error?.({ error: 'aborted' })
    })
    session.cancel()
    expect(last()).toEqual({ phase: 'finished', transcript: '保留', cancelled: true })
    expect(listener).toHaveBeenCalledTimes(3)
    expectClean(recognition)
  })
})

describe('native failures are explicit', () => {
  it.each([
    ['not-allowed', 'permission was denied'],
    ['service-not-allowed', 'permission was denied'],
    ['no-speech', 'No speech was recognized'],
    ['network', 'network'],
    ['audio-capture', 'microphone audio'],
    ['language-not-supported', 'Mandarin (zh-CN)'],
    ['language-unavailable', 'Mandarin (zh-CN)'],
    ['aborted', 'interrupted'],
    ['unknown-code', 'unknown-code'],
    ['', 'recognition failed'],
  ])('reports %s, retains valid text, and cleans up', (error, message) => {
    const { recognition, listener, last } = start()
    recognition.onresult?.(resultEvent(['保留']))
    recognition.onerror?.({ error })
    expect(last()).toMatchObject({ phase: 'error', transcript: '保留', error: expect.stringContaining(message) })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expect(recognition.start).toHaveBeenCalledOnce()
    expect(FakeRecognition.instances).toHaveLength(1)
    const calls = listener.mock.calls.length
    vi.advanceTimersByTime(120_000)
    expect(listener).toHaveBeenCalledTimes(calls)
    expectClean(recognition)
  })

  it('reports constructor failures rather than throwing out of the API', () => {
    FakeRecognition.construct.mockImplementation(() => { throw new Error('constructor failed') })
    const { last } = start()
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('constructor failed') })
    expectClean()
  })

  it('reports native configuration failures and aborts without starting a different language', () => {
    vi.stubGlobal('SpeechRecognition', class extends FakeRecognition {
      constructor() {
        super()
        Object.defineProperty(this, 'lang', {
          set() { throw new Error('Mandarin configuration failed') },
        })
      }
    })
    const { recognition, last } = start()
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('Mandarin configuration failed') })
    expect(recognition.start).not.toHaveBeenCalled()
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it.each([new Error('start blocked'), 'start blocked'])('reports start exceptions and aborts', cause => {
    FakeRecognition.begin.mockImplementation(() => { throw cause })
    const { recognition, last } = start()
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('start blocked') })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('reports stop exceptions and aborts even before native start', () => {
    const { recognition, session, last } = start()
    recognition.stop.mockImplementation(() => { throw new Error('stop failed') })
    session.stop()
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining('stop failed') })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('reports abort exceptions and attempts Stop as a last cleanup action', () => {
    const { recognition, session, last } = start()
    recognition.onresult?.(resultEvent(['保留']))
    recognition.abort.mockImplementation(() => { throw new Error('abort failed') })
    session.cancel()
    expect(last()).toMatchObject({ phase: 'error', transcript: '保留', error: expect.stringContaining('abort failed') })
    expect(recognition.stop).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('preserves the original failure alongside abort and stop cleanup failures', () => {
    const { recognition, last } = start()
    recognition.abort.mockImplementation(() => { throw new Error('abort failed') })
    recognition.stop.mockImplementation(() => { throw new Error('stop failed') })
    recognition.onerror?.({ error: 'network' })
    expect(last().phase).toBe('error')
    expect(last().error).toContain('network')
    expect(last().error).toContain('abort failed')
    expect(last().error).toContain('stop failed')
    expectClean(recognition)
  })

  it.each(['start', 'stop'] as const)('does not report success if native %s emits end then throws', action => {
    const finishAndThrow = (recognition: FakeRecognition) => {
      recognition.onstart?.()
      recognition.onresult?.(resultEvent(['你好']))
      recognition.onend?.()
      throw new Error(`${action} failed after end`)
    }
    if (action === 'start') FakeRecognition.begin.mockImplementation(finishAndThrow)
    const { recognition, session, last, listener } = start()
    if (action === 'stop') {
      recognition.stop.mockImplementation(() => finishAndThrow(recognition))
      session.stop()
    }
    expect(last()).toMatchObject({ phase: 'error', transcript: '你好', error: expect.stringContaining('failed after end') })
    expect(listener.mock.calls.some(([state]) => state.phase === 'finished')).toBe(false)
    expectClean(recognition)
  })

  it.each([false, true])('reports unexplained empty native end (started: %s)', started => {
    const { recognition, last } = start()
    if (started) recognition.onstart?.()
    recognition.onend?.()
    expect(last()).toMatchObject({ phase: 'error', error: expect.stringContaining(started ? 'No speech' : 'before listening started') })
    expectClean(recognition)
  })
})

describe('page and listener cleanup', () => {
  it.each(['visibility', 'pagehide', 'Escape'])('cancels capture for %s, retaining valid text', reason => {
    const { recognition, last } = start()
    recognition.onresult?.(resultEvent(['保留']))
    if (reason === 'visibility') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    } else if (reason === 'pagehide') {
      window.dispatchEvent(new Event('pagehide'))
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    expect(last()).toEqual({ phase: 'finished', transcript: '保留', cancelled: true })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('does not capture on an already hidden page', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const { last } = start()
    expect(last()).toEqual({ phase: 'finished', transcript: '', cancelled: true })
    expect(FakeRecognition.construct).not.toHaveBeenCalled()
    expectClean()
  })

  it('ignores non-Escape keys and visibility changes to visible', () => {
    const { recognition, last } = start()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(last().phase).toBe('starting')
    expect(recognition.abort).not.toHaveBeenCalled()
  })

  it.each(['end', 'error', 'cancel', 'start timeout', 'stop timeout'])('removes DOM and native listeners after %s', reason => {
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const { recognition, session, listener } = start()
    if (reason === 'end') {
      recognition.onstart?.()
      recognition.onresult?.(resultEvent(['结束']))
      recognition.onend?.()
    } else if (reason === 'error') {
      recognition.onerror?.({ error: 'network' })
    } else if (reason === 'cancel') {
      session.cancel()
    } else if (reason === 'start timeout') {
      vi.advanceTimersByTime(10_000)
    } else {
      session.stop()
      vi.advanceTimersByTime(5000)
    }
    for (const [type, callback, options] of addDocument.mock.calls) {
      expect(removeDocument).toHaveBeenCalledWith(...(options === undefined ? [type, callback] : [type, callback, options]))
    }
    for (const [type, callback] of addWindow.mock.calls) {
      expect(removeWindow).toHaveBeenCalledWith(type, callback)
    }
    const calls = listener.mock.calls.length
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new Event('pagehide'))
    expect(listener).toHaveBeenCalledTimes(calls)
    expectClean(recognition)
  })

  it('keeps only the latest capture when a starting listener reentrantly starts another', () => {
    let replacement: ReturnType<typeof start> | undefined
    const states: SpeechCaptureState[] = []
    const first = startSpeechCapture(state => {
      states.push(state)
      if (state.phase === 'starting') replacement = start()
    })
    sessions.push(first)
    expect(states).toEqual([{ phase: 'starting', transcript: '' }, { phase: 'finished', transcript: '', cancelled: true }])
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(replacement?.last().phase).toBe('starting')
  })

  it('does not start a superseded request when cancellation of its predecessor starts another request', () => {
    let replacement: ReturnType<typeof start> | undefined
    const first = startSpeechCapture(state => {
      if (state.phase === 'finished') replacement = start()
    })
    sessions.push(first)
    const second = start()
    expect(second.last()).toEqual({ phase: 'finished', transcript: '', cancelled: true })
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(replacement?.last().phase).toBe('starting')
  })

  it('cancels synchronously during native start without resurrecting timers or recognition', () => {
    FakeRecognition.begin.mockImplementation(recognition => {
      recognition.onstart?.()
      window.dispatchEvent(new Event('pagehide'))
    })
    const { recognition, last } = start()
    expect(last()).toEqual({ phase: 'finished', transcript: '', cancelled: true })
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('does not start recognition if the page hides inside its constructor', () => {
    FakeRecognition.construct.mockImplementation(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    const { recognition, last, listener } = start()
    expect(last()).toEqual({ phase: 'finished', transcript: '', cancelled: true })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(recognition.start).not.toHaveBeenCalled()
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('reports constructor errors even if the constructor first dispatches cancellation', () => {
    FakeRecognition.construct.mockImplementation(() => {
      window.dispatchEvent(new Event('pagehide'))
      throw new Error('constructor failed after cancellation')
    })
    const { last, listener } = start()
    expect(last()).toMatchObject({ phase: 'error', cancelled: true, error: expect.stringContaining('constructor failed after cancellation') })
    expect(listener.mock.calls.some(([state]) => state.phase === 'finished')).toBe(false)
    expectClean()
  })

  it('reports abort errors during constructor cancellation and falls back to Stop', () => {
    vi.stubGlobal('SpeechRecognition', class extends FakeRecognition {
      constructor() {
        super()
        this.abort.mockImplementation(() => { throw new Error('constructor cancellation failed') })
        window.dispatchEvent(new Event('pagehide'))
      }
    })
    const { recognition, last, listener } = start()
    expect(last()).toMatchObject({ phase: 'error', cancelled: true, error: expect.stringContaining('constructor cancellation failed') })
    expect(listener.mock.calls.some(([state]) => state.phase === 'finished')).toBe(false)
    expect(recognition.start).not.toHaveBeenCalled()
    expect(recognition.abort).toHaveBeenCalledOnce()
    expect(recognition.stop).toHaveBeenCalledOnce()
    expectClean(recognition)
  })

  it('does not reinstall listeners or start if cancellation occurs while configuring the native recognizer', () => {
    vi.stubGlobal('SpeechRecognition', class extends FakeRecognition {
      constructor() {
        super()
        Object.defineProperty(this, 'lang', {
          set() { window.dispatchEvent(new Event('pagehide')) },
        })
      }
    })
    const { recognition, last } = start()
    expect(last()).toEqual({ phase: 'finished', transcript: '', cancelled: true })
    expect(recognition.start).not.toHaveBeenCalled()
    expect(recognition.abort).toHaveBeenCalledOnce()
    expectClean(recognition)
  })
})
