export interface RecordingCue {
  play(): Promise<void>
  cancel(): Promise<void>
  takeContext(): AudioContext
}

const RESUME_TIMEOUT_MS = 5000
const END_TIMEOUT_MS = 1500
const CLEANUP_TIMEOUT_MS = 1000
const TONE_SECONDS = 0.14

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  // Preparation can fail before the caller reaches play(); preserve the rejection
  // for that caller without reporting an unhandled background rejection.
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

export function prepareRecordingCue(): RecordingCue {
  if (typeof globalThis.AudioContext !== 'function') {
    throw new Error('Recording cues are not supported by this browser.')
  }

  let context: AudioContext
  try {
    context = new AudioContext()
  } catch {
    throw new Error('Recording cue audio could not be initialized. Try Practice again.')
  }

  const completion = deferred()
  let state: 'prepared' | 'playing' | 'finished' | 'failed' | 'cancelled' = 'prepared'
  let transferred = false
  let ready = false
  let requested = false
  let configuring = false
  let started = false
  let ended = false
  let failure: Error | undefined
  let oscillator: OscillatorNode | undefined
  let gain: GainNode | undefined
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let cleanupTask: ReturnType<typeof deferred> | undefined
  let cleanupStarted = false
  let cancellation: Promise<void> | undefined

  const terminal = () => state !== 'prepared' && state !== 'playing'
  const clearWaits = () => {
    clearTimeout(resumeTimer)
    clearTimeout(endTimer)
  }

  const performCleanup = () => {
    if (!cleanupTask || cleanupStarted || configuring) return
    cleanupStarted = true
    clearWaits()
    const task = cleanupTask
    const errors: string[] = []
    const attempt = (action: () => void, message: string) => {
      try {
        action()
      } catch {
        errors.push(message)
      }
    }
    if (oscillator) {
      const source = oscillator
      source.onended = null
      if (started && !ended) {
        attempt(() => source.stop(), 'Recording cue tone could not be stopped.')
      }
      attempt(() => source.disconnect(), 'Recording cue tone could not be disconnected.')
      oscillator = undefined
    }
    if (gain) {
      const volume = gain
      attempt(() => volume.disconnect(), 'Recording cue volume control could not be disconnected.')
      gain = undefined
    }

    let settled = false
    const settle = (message?: string) => {
      if (settled) return
      settled = true
      clearTimeout(closeTimer)
      if (message) errors.push(message)
      if (errors.length) task.reject(new Error(errors.join(' ')))
      else task.resolve()
    }
    const closeTimer = setTimeout(() => settle('Recording cue audio cleanup timed out.'), CLEANUP_TIMEOUT_MS)
    if (transferred || context.state === 'closed') {
      settle()
      return
    }
    try {
      void Promise.resolve(context.close()).then(
        () => settle(context.state === 'closed' ? undefined : 'Recording cue audio could not be closed.'),
        () => settle('Recording cue audio could not be closed.'),
      )
    } catch {
      settle('Recording cue audio could not be closed.')
    }
  }

  const cleanup = () => {
    cleanupTask ??= deferred()
    performCleanup()
    return cleanupTask.promise
  }

  const finish = (error?: Error) => {
    if (terminal()) return
    state = error ? 'failed' : 'finished'
    failure = error
    clearWaits()
    void cleanup().then(
      () => {
        if (error) completion.reject(error)
        else completion.resolve()
      },
      cleanupError => {
        failure = new Error([error?.message, (cleanupError as Error).message].filter(Boolean).join(' '))
        if (state !== 'cancelled') state = 'failed'
        completion.reject(failure)
      },
    )
  }

  const startTone = () => {
    if (!requested || !ready || state !== 'prepared') return
    if (context.state !== 'running') {
      finish(new Error('Recording cue audio is not running. Try Practice again.'))
      return
    }
    state = 'playing'
    configuring = true
    try {
      oscillator = context.createOscillator()
      if (terminal()) return
      gain = context.createGain()
      if (terminal()) return
      oscillator.type = 'sine'
      oscillator.onended = () => {
        if (state !== 'playing') return
        ended = true
        if (!configuring) finish()
      }
      oscillator.connect(gain)
      gain.connect(context.destination)
      const now = context.currentTime
      oscillator.frequency.setValueAtTime(880, now)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.1, now + 0.015)
      gain.gain.setValueAtTime(0.1, now + 0.09)
      gain.gain.linearRampToValueAtTime(0, now + TONE_SECONDS)
      if (terminal()) return
      endTimer = setTimeout(() => {
        finish(new Error('Recording cue did not finish. Try Practice again.'))
      }, END_TIMEOUT_MS)
      started = true
      oscillator.start(now)
      if (terminal()) return
      oscillator.stop(now + TONE_SECONDS)
    } catch {
      finish(new Error('Recording cue could not be played. Try Practice again.'))
    } finally {
      configuring = false
      performCleanup()
      // A browser callback may arrive reentrantly during start/stop. Do not
      // report success until those calls have returned without throwing.
      if (ended && state === 'playing') finish()
    }
  }

  const cue: RecordingCue = {
    play() {
      requested = true
      startTone()
      return completion.promise
    },
    cancel() {
      if (cancellation) return cancellation
      state = 'cancelled'
      clearWaits()
      completion.reject(failure ?? new DOMException('Recording cue was cancelled.', 'AbortError'))
      cancellation = cleanup()
      return cancellation
    },
    takeContext() {
      if (transferred || state !== 'prepared' || requested || context.state === 'closed') {
        throw new Error('Recording cue audio can only be transferred once, before playback or cancellation.')
      }
      transferred = true
      return context
    },
  }

  // Both construction and resume must occur in the actual click's call stack.
  const resumeTimer = setTimeout(() => {
    finish(new Error('Recording cue audio did not become ready. Try Practice again.'))
  }, RESUME_TIMEOUT_MS)
  try {
    void Promise.resolve(context.resume()).then(
      () => {
        if (terminal()) return
        clearTimeout(resumeTimer)
        if (context.state !== 'running') {
          finish(new Error('Recording cue audio is not running. Try Practice again.'))
          return
        }
        ready = true
        startTone()
      },
      () => finish(new Error('Recording cue audio could not be enabled. Check browser audio permissions and try again.')),
    )
  } catch {
    finish(new Error('Recording cue audio could not be enabled. Check browser audio permissions and try again.'))
  }
  return cue
}
