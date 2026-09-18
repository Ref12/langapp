import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareRecordingCue, type RecordingCue } from './recording-cue'

function pending() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakeOscillator {
  type = 'square'
  frequency = { setValueAtTime: vi.fn() }
  onended: (() => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class FakeGain {
  gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeContext {
  static instances: FakeContext[] = []
  static construct = vi.fn<() => void>()
  static resume = vi.fn<(context: FakeContext) => Promise<void>>()
  static close = vi.fn<(context: FakeContext) => Promise<void>>()
  state: AudioContextState = 'suspended'
  currentTime = 42
  destination = {}
  oscillator = new FakeOscillator()
  gain = new FakeGain()
  createOscillator = vi.fn(() => this.oscillator)
  createGain = vi.fn(() => this.gain)
  resume = vi.fn(() => FakeContext.resume(this))
  close = vi.fn(() => FakeContext.close(this))

  constructor() {
    FakeContext.construct()
    FakeContext.instances.push(this)
  }
}

const cues: RecordingCue[] = []
const prepare = () => {
  const cue = prepareRecordingCue()
  cues.push(cue)
  return { cue, context: FakeContext.instances[FakeContext.instances.length - 1] }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  FakeContext.instances = []
  FakeContext.construct.mockReset()
  FakeContext.resume.mockReset().mockImplementation(async context => {
    context.state = 'running'
  })
  FakeContext.close.mockReset().mockImplementation(async context => {
    context.state = 'closed'
  })
  vi.stubGlobal('AudioContext', FakeContext)
})

afterEach(async () => {
  const cleanup = Promise.allSettled(cues.splice(0).map(cue => cue.cancel()))
  await vi.runAllTimersAsync()
  await cleanup
  expect(vi.getTimerCount()).toBe(0)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('recording cue preparation and playback', () => {
  it('constructs and resumes synchronously without tone, microphone access, or network requests', async () => {
    const fetch = vi.fn()
    const getUserMedia = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const { context } = prepare()
    expect(FakeContext.construct).toHaveBeenCalledOnce()
    expect(context.resume).toHaveBeenCalledExactlyOnceWith()
    expect(context.createOscillator).not.toHaveBeenCalled()
    await flush()
    await vi.advanceTimersByTimeAsync(10000)
    expect(context.createOscillator).not.toHaveBeenCalled()
    expect(context.createGain).not.toHaveBeenCalled()
    expect(context.close).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('plays one gentle sine envelope only on request, then waits for actual end and cleanup', async () => {
    const closing = pending()
    FakeContext.close.mockImplementation(() => closing.promise)
    const { cue, context } = prepare()
    await flush()
    const playback = cue.play()
    const resolved = vi.fn()
    void playback.then(resolved)
    expect(cue.play()).toBe(playback)
    expect(context.createOscillator).toHaveBeenCalledOnce()
    expect(context.createGain).toHaveBeenCalledOnce()
    expect(context.oscillator.type).toBe('sine')
    expect(context.oscillator.frequency.setValueAtTime).toHaveBeenCalledExactlyOnceWith(880, 42)
    expect(context.oscillator.connect).toHaveBeenCalledExactlyOnceWith(context.gain)
    expect(context.gain.connect).toHaveBeenCalledExactlyOnceWith(context.destination)
    expect(context.gain.gain.setValueAtTime.mock.calls).toEqual([[0, 42], [0.1, 42.09]])
    expect(context.gain.gain.linearRampToValueAtTime.mock.calls).toEqual([[0.1, 42.015], [0, 42.14]])
    expect(context.oscillator.start).toHaveBeenCalledExactlyOnceWith(42)
    expect(context.oscillator.stop).toHaveBeenCalledExactlyOnceWith(42.14)
    await vi.advanceTimersByTimeAsync(140)
    expect(resolved).not.toHaveBeenCalled()
    expect(context.close).not.toHaveBeenCalled()
    const ended = context.oscillator.onended!
    ended()
    ended()
    expect(context.oscillator.onended).toBeNull()
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
    expect(context.gain.disconnect).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(context.oscillator.stop).toHaveBeenCalledOnce()
    await flush()
    expect(resolved).not.toHaveBeenCalled()
    context.state = 'closed'
    closing.resolve()
    await playback
    expect(resolved).toHaveBeenCalledOnce()
    expect(cue.play()).toBe(playback)
    const cancelled = cue.cancel()
    expect(cue.cancel()).toBe(cancelled)
    await cancelled
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('waits for pending resume even if play was requested immediately', async () => {
    const resuming = pending()
    FakeContext.resume.mockImplementation(() => resuming.promise)
    const { cue, context } = prepare()
    const playback = cue.play()
    expect(context.createOscillator).not.toHaveBeenCalled()
    context.state = 'running'
    resuming.resolve()
    await flush()
    expect(context.oscillator.start).toHaveBeenCalledOnce()
    context.oscillator.onended?.()
    await playback
  })

  it('handles synchronous end callbacks without completing before a throwing stop call returns', async () => {
    const { cue, context } = prepare()
    await flush()
    context.oscillator.stop.mockImplementation(() => {
      context.oscillator.onended?.()
      throw new Error('private native details')
    })
    await expect(cue.play()).rejects.toThrow('Recording cue could not be played.')
    expect(context.close).toHaveBeenCalledOnce()
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
  })

  it('accepts a synchronous end callback when scheduling succeeds', async () => {
    const { cue, context } = prepare()
    await flush()
    context.oscillator.stop.mockImplementation(() => context.oscillator.onended?.())
    await expect(cue.play()).resolves.toBeUndefined()
    expect(context.close).toHaveBeenCalledOnce()
  })
})

describe('recording cue cancellation', () => {
  it.each([false, true])('cancels pending resume promptly with play requested: %s', async requested => {
    const resuming = pending()
    const closing = pending()
    FakeContext.resume.mockImplementation(() => resuming.promise)
    FakeContext.close.mockImplementation(() => closing.promise)
    const { cue, context } = prepare()
    const playback = requested ? cue.play() : undefined
    const cancelled = cue.cancel()
    expect(cue.cancel()).toBe(cancelled)
    await expect(playback ?? cue.play()).rejects.toMatchObject({ name: 'AbortError' })
    expect(context.close).toHaveBeenCalledOnce()
    context.state = 'running'
    resuming.resolve()
    await flush()
    expect(context.createOscillator).not.toHaveBeenCalled()
    context.state = 'closed'
    closing.resolve()
    await cancelled
  })

  it('cancels an already prepared cue before play and safely observes a late resume rejection', async () => {
    const resuming = pending()
    FakeContext.resume.mockImplementation(() => resuming.promise)
    const { cue, context } = prepare()
    await cue.cancel()
    resuming.reject(new Error('private permission error'))
    await flush()
    await expect(cue.play()).rejects.toMatchObject({ name: 'AbortError' })
    expect(context.createOscillator).not.toHaveBeenCalled()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('cancels a ready cue without starting it', async () => {
    const { cue, context } = prepare()
    await flush()
    await cue.cancel()
    await expect(cue.play()).rejects.toMatchObject({ name: 'AbortError' })
    expect(context.oscillator.start).not.toHaveBeenCalled()
  })

  it('stops, disconnects, and rejects promptly during playback, ignoring late or reentrant ends', async () => {
    const closing = pending()
    FakeContext.close.mockImplementation(() => closing.promise)
    const { cue, context } = prepare()
    await flush()
    const playback = cue.play()
    const ended = context.oscillator.onended!
    context.oscillator.stop.mockImplementation(() => {
      ended()
      void cue.cancel()
    })
    const cancelled = cue.cancel()
    await expect(playback).rejects.toMatchObject({ name: 'AbortError' })
    expect(context.oscillator.stop).toHaveBeenCalledTimes(2)
    expect(context.oscillator.stop).toHaveBeenLastCalledWith()
    expect(context.oscillator.onended).toBeNull()
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
    expect(context.gain.disconnect).toHaveBeenCalledOnce()
    ended()
    expect(cue.play()).toBe(playback)
    expect(context.createOscillator).toHaveBeenCalledOnce()
    context.state = 'closed'
    closing.resolve()
    await cancelled
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('defers cleanup during reentrant node creation and never starts a cancelled tone', async () => {
    const { cue, context } = prepare()
    await flush()
    context.createOscillator.mockImplementation(() => {
      void cue.cancel()
      return context.oscillator
    })
    await expect(cue.play()).rejects.toMatchObject({ name: 'AbortError' })
    await cue.cancel()
    expect(context.oscillator.start).not.toHaveBeenCalled()
    expect(context.createGain).not.toHaveBeenCalled()
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })
})

describe('recording cue failures', () => {
  it('reports missing AudioContext without touching hardware', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(prepareRecordingCue).toThrow('Recording cues are not supported by this browser.')
    expect(FakeContext.construct).not.toHaveBeenCalled()
  })

  it('sanitizes constructor failures', () => {
    FakeContext.construct.mockImplementation(() => {
      throw new Error('private device details')
    })
    expect(prepareRecordingCue).toThrow('Recording cue audio could not be initialized. Try Practice again.')
    expect(FakeContext.instances).toHaveLength(0)
  })

  it.each(['throw', 'reject', 'missing'])('sanitizes %s resume failures, closes, and keeps failure observable before play', async mode => {
    if (mode === 'missing') {
      vi.stubGlobal('AudioContext', class extends FakeContext {
        constructor() {
          super()
          Object.defineProperty(this, 'resume', { value: undefined })
        }
      })
    } else {
      FakeContext.resume.mockImplementation(() => {
        if (mode === 'throw') throw new Error('secret device or permission details')
        return Promise.reject(new Error('secret device or permission details'))
      })
    }
    const { cue, context } = prepare()
    await flush()
    expect(context.close).toHaveBeenCalledOnce()
    expect(context.createOscillator).not.toHaveBeenCalled()
    expect(() => cue.takeContext()).toThrow('only be transferred')
    await expect(cue.play()).rejects.toThrow(
      'Recording cue audio could not be enabled. Check browser audio permissions and try again.',
    )
  })

  it('times out a hung resume and never starts after its late success', async () => {
    const resuming = pending()
    FakeContext.resume.mockImplementation(() => resuming.promise)
    const { cue, context } = prepare()
    await vi.advanceTimersByTimeAsync(5000)
    await expect(cue.play()).rejects.toThrow('Recording cue audio did not become ready.')
    expect(context.close).toHaveBeenCalledOnce()
    context.state = 'running'
    resuming.resolve()
    await flush()
    expect(context.createOscillator).not.toHaveBeenCalled()
  })

  it.each(['suspended', 'closed'])('rejects resume that resolves with a %s context', async state => {
    FakeContext.resume.mockImplementation(async context => {
      context.state = state as AudioContextState
    })
    const { cue, context } = prepare()
    await expect(cue.play()).rejects.toThrow('Recording cue audio is not running.')
    expect(context.createOscillator).not.toHaveBeenCalled()
  })

  it('does not start if audio became suspended between preparation and play', async () => {
    const { cue, context } = prepare()
    await flush()
    context.state = 'suspended'
    await expect(cue.play()).rejects.toThrow('Recording cue audio is not running.')
    expect(context.createOscillator).not.toHaveBeenCalled()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects missing onended instead of treating the duration timer as success', async () => {
    const { cue, context } = prepare()
    await flush()
    const playback = cue.play()
    const ended = context.oscillator.onended!
    await vi.advanceTimersByTimeAsync(1500)
    await expect(playback).rejects.toThrow('Recording cue did not finish.')
    expect(context.oscillator.stop).toHaveBeenCalledTimes(2)
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
    expect(context.gain.disconnect).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    ended()
    await expect(cue.play()).rejects.toThrow('Recording cue did not finish.')
  })

  it.each(['createOscillator', 'createGain', 'start', 'stop', 'connect', 'envelope'])('cleans up after a %s failure without leaking native details', async operation => {
    const { cue, context } = prepare()
    await flush()
    const fail = () => { throw new Error('private native details') }
    if (operation === 'createOscillator') context.createOscillator.mockImplementation(fail)
    if (operation === 'createGain') context.createGain.mockImplementation(fail)
    if (operation === 'start') context.oscillator.start.mockImplementation(fail)
    if (operation === 'stop') context.oscillator.stop.mockImplementation(fail)
    if (operation === 'connect') context.gain.connect.mockImplementation(fail)
    if (operation === 'envelope') context.gain.gain.linearRampToValueAtTime.mockImplementation(fail)
    const playback = cue.play()
    await expect(playback).rejects.toThrow('Recording cue could not be played.')
    await expect(playback).rejects.not.toThrow('private')
    expect(context.close).toHaveBeenCalledOnce()
    if (operation !== 'createOscillator') expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
    if (!['createOscillator', 'createGain'].includes(operation)) expect(context.gain.disconnect).toHaveBeenCalledOnce()
  })

  it.each(['throw', 'reject', 'not-closed', 'hang'])('reports %s close failures after actual tone end', async mode => {
    FakeContext.close.mockImplementation(() => {
      if (mode === 'throw') throw new Error('private close details')
      if (mode === 'reject') return Promise.reject(new Error('private close details'))
      if (mode === 'not-closed') return Promise.resolve()
      return new Promise(() => undefined)
    })
    const { cue, context } = prepare()
    await flush()
    const playback = cue.play()
    context.oscillator.onended?.()
    await vi.advanceTimersByTimeAsync(1000)
    const message = mode === 'hang' ? 'Recording cue audio cleanup timed out.' : 'Recording cue audio could not be closed.'
    await expect(playback).rejects.toThrow(message)
    await expect(cue.cancel()).rejects.toThrow(message)
    expect(context.close).toHaveBeenCalledOnce()
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
  })

  it('reports disconnect and stop failures while still releasing other resources', async () => {
    const { cue, context } = prepare()
    await flush()
    const playback = cue.play()
    context.oscillator.stop.mockImplementation(() => { throw new Error('private stop details') })
    context.oscillator.disconnect.mockImplementation(() => { throw new Error('private disconnect details') })
    const cancelled = cue.cancel()
    await expect(playback).rejects.toMatchObject({ name: 'AbortError' })
    await expect(cancelled).rejects.toThrow('Recording cue tone could not be stopped. Recording cue tone could not be disconnected.')
    expect(context.gain.disconnect).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects cancellation cleanup when close hangs, and ignores late close rejection', async () => {
    const closing = pending()
    FakeContext.close.mockImplementation(() => closing.promise)
    const { cue, context } = prepare()
    const cancelled = cue.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    await expect(cancelled).rejects.toThrow('Recording cue audio cleanup timed out.')
    closing.reject(new Error('private late close details'))
    await flush()
    await expect(cue.play()).rejects.toMatchObject({ name: 'AbortError' })
    expect(context.close).toHaveBeenCalledOnce()
  })
})

describe('recording cue context ownership', () => {
  it('transfers the real context synchronously while resume is pending and never closes it after playback', async () => {
    const resuming = pending()
    FakeContext.resume.mockImplementation(() => resuming.promise)
    const { cue, context } = prepare()
    expect(cue.takeContext()).toBe(context)
    expect(() => cue.takeContext()).toThrow('only be transferred once')
    const playback = cue.play()
    context.state = 'running'
    resuming.resolve()
    await flush()
    context.oscillator.onended?.()
    await playback
    await cue.cancel()
    expect(context.close).not.toHaveBeenCalled()
    expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
    expect(context.gain.disconnect).toHaveBeenCalledOnce()
    expect(context.state).toBe('running')
  })

  it.each(['resume-pending', 'playing', 'resume-failed', 'tone-timeout'])('leaves transferred context cleanup to its owner when %s', async phase => {
    const resuming = pending()
    FakeContext.resume.mockImplementation(() => resuming.promise)
    const { cue, context } = prepare()
    cue.takeContext()
    const playback = cue.play()
    if (phase === 'resume-failed') {
      resuming.reject(new Error('private permission details'))
      await expect(playback).rejects.toThrow('could not be enabled')
    } else if (phase !== 'resume-pending') {
      context.state = 'running'
      resuming.resolve()
      await flush()
    }
    if (phase === 'tone-timeout') {
      await vi.advanceTimersByTimeAsync(1500)
      await expect(playback).rejects.toThrow('did not finish')
    }
    await cue.cancel()
    if (phase === 'resume-pending' || phase === 'playing') {
      await expect(playback).rejects.toMatchObject({ name: 'AbortError' })
    }
    if (phase === 'resume-pending') {
      context.state = 'running'
      resuming.resolve()
      await flush()
      expect(context.oscillator.start).not.toHaveBeenCalled()
    }
    expect(context.close).not.toHaveBeenCalled()
    if (phase === 'playing' || phase === 'tone-timeout') {
      expect(context.oscillator.disconnect).toHaveBeenCalledOnce()
      expect(context.gain.disconnect).toHaveBeenCalledOnce()
    }
  })

  it.each(['play', 'cancel', 'closed'])('rejects ownership transfer after %s', async phase => {
    const { cue, context } = prepare()
    if (phase === 'play') cue.play()
    if (phase === 'cancel') await cue.cancel()
    if (phase === 'closed') context.state = 'closed'
    expect(() => cue.takeContext()).toThrow('only be transferred once')
  })
})
