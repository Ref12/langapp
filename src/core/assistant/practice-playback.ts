import { acquireAudio, type AudioLease } from './audio-owner'
import { speechRateSchema, type SpeechRate } from './contracts'
import { getPlaybackState, playBrowserSpeechToEnd, stopBrowserSpeech, subscribeSpeechInterruption, type PlaybackOutcome } from './speech'

export interface PracticePlaybackOptions {
  pacing: 'self-paced' | 'guided'
  rate: SpeechRate
  pauseSeconds: number
  repetitions: number
}

export interface PracticePlaybackState {
  status: 'idle' | 'playing' | 'responding' | 'paused' | 'completed' | 'error'
  index: number
  repetition: number
  error?: string
}

function validate(texts: string[], options: PracticePlaybackOptions, index?: number): string | undefined {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 80
    || Array.from(texts).some(text => typeof text !== 'string' || !text.trim() || text.length > 3000)) {
    return 'Choose 1–80 non-empty practice phrases, each at most 3,000 characters.'
  }
  if (!options || !['self-paced', 'guided'].includes(options.pacing)) {
    return 'Choose self-paced or guided practice.'
  }
  if (!speechRateSchema.safeParse(options.rate).success) return 'Choose a supported Mandarin speech rate.'
  if (!Number.isFinite(options.pauseSeconds) || options.pauseSeconds < 1 || options.pauseSeconds > 30) {
    return 'The response pause must be between 1 and 30 seconds.'
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 5) {
    return 'Choose between 1 and 5 repetitions.'
  }
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= texts.length)) {
    return 'Choose an existing practice phrase.'
  }
}

function requiresReload(error: string) {
  return error.includes('Close this page before playing more audio.') || error.includes('Reload before playing more audio.')
}

function cancellationFailed(error: string) {
  return error.includes('The browser could not stop speech playback.') || requiresReload(error)
}

export function createPracticePlayback(
  id: string,
  texts: string[],
  options: PracticePlaybackOptions,
  changed: (state: PracticePlaybackState) => void,
) {
  const idError = typeof id !== 'string' || !id.trim() ? 'Practice playback needs a non-empty identifier.' : undefined
  let validationError = idError ?? validate(texts, options)
  let phrases = validationError ? [] : [...texts]
  let settings = { ...options }
  let state: PracticePlaybackState = {
    status: validationError ? 'error' : 'idle', index: 0, repetition: 1,
    ...(validationError ? { error: validationError } : {}),
  }
  let version = 0
  let disposed = false
  let acquiring = false
  let stopping = false
  let startingSpeech = false
  let externalInterruption = 0
  let stopRequired = false
  let fatalStopError: string | undefined
  let lease: AudioLease | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let activeRun: { version: number } | undefined

  const release = () => {
    lease?.release()
    lease = undefined
  }
  const invalidate = () => {
    ++version
    clearTimeout(timer)
    timer = undefined
    return version
  }
  const publish = (next: PracticePlaybackState) => {
    state = next
    changed({ ...state })
  }
  const current = (request: number) => !disposed && request === version && lease?.isCurrent() === true
  const report = (error: string) => {
    // Edge cleanup errors explicitly require closing/reloading: the shared
    // engine has discarded that Audio handle, so a browser cancel cannot retry it.
    if (requiresReload(error)) {
      fatalStopError = error
      stopRequired = true
    }
    if (!stopping && !stopRequired && !activeRun) release()
    publish({ ...state, status: 'error', error })
  }

  // Keep failed cancellation as an ownership barrier until a later Stop succeeds.
  const cancel = (all = false): string | undefined => {
    if (fatalStopError) return fatalStopError
    if (stopping) return
    const playback = getPlaybackState()
    if (activeRun && playback.error && requiresReload(playback.error)) {
      fatalStopError = playback.error
      stopRequired = true
      return fatalStopError
    }
    if (!all && !stopRequired && !startingSpeech && playback.activeId !== id
      && !(activeRun && playback.error && cancellationFailed(playback.error))) {
      activeRun = undefined
      return
    }
    stopping = true
    let error: string | undefined
    try {
      error = stopBrowserSpeech()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Speech playback could not be stopped.'
    } finally {
      stopping = false
    }
    stopRequired = Boolean(error)
    if (!error) activeRun = undefined
    return error
  }

  const halt = (error?: string) => {
    const request = invalidate()
    const cancelError = externalInterruption ? (stopRequired ? state.error : undefined) : cancel()
    if (cancelError) { report(cancelError); return }
    if (request !== version) return
    if (!stopping && !stopRequired && !activeRun) release()
    if (stopRequired && state.error) report(state.error)
    else if (error) report(error)
    else publish({ status: 'paused', index: state.index, repetition: state.repetition })
  }

  const unsubscribe = subscribeSpeechInterruption(nextId => {
    if (disposed || stopping || nextId === id || (!activeRun && !stopRequired && state.status !== 'responding' && state.status !== 'playing')) return
    invalidate()
    // The shared engine notifies BEFORE cancelling. A subscriber must not start
    // another utterance inside that notification or inside the native cancel.
    ++externalInterruption
    queueMicrotask(() => { --externalInterruption })
    if (!activeRun && !stopRequired) release()
    if (stopRequired && state.error) report(state.error)
    else publish({ status: 'paused', index: state.index, repetition: state.repetition })
  })

  const finished = (run: { version: number }, outcome: PlaybackOutcome) => {
    if (activeRun !== run) return
    activeRun = undefined
    if (outcome.status === 'error') {
      stopRequired = stopRequired || cancellationFailed(outcome.error) || getPlaybackState().activeId === id
      invalidate()
      report(outcome.error)
      return
    }
    if (!current(run.version)) {
      if (!stopRequired) release()
      return
    }
    if (outcome.status === 'cancelled') {
      release()
      publish({ status: 'paused', index: state.index, repetition: state.repetition })
      return
    }
    if (settings.pacing === 'self-paced') {
      release()
      publish({ status: 'idle', index: state.index, repetition: state.repetition })
      return
    }
    publish({ status: 'responding', index: state.index, repetition: state.repetition })
    if (!current(run.version)) return
    timer = setTimeout(() => {
      timer = undefined
      if (!current(run.version)) return
      if (state.repetition < settings.repetitions) speak(state.index, state.repetition + 1)
      else if (state.index < phrases.length - 1) speak(state.index + 1, 1)
      else {
        release()
        publish({ status: 'completed', index: state.index, repetition: state.repetition })
      }
    }, settings.pauseSeconds * 1000)
  }

  const speak = (index: number, repetition: number) => {
    const request = invalidate()
    if (!current(request)) return
    publish({ status: 'playing', index, repetition })
    if (!current(request)) return
    const run = { version: request }
    activeRun = run
    startingSpeech = true
    // Do not defer this call: Automatic must reach native speak in the tap stack.
    const playback = playBrowserSpeechToEnd(id, phrases[index], 'zh-Hans', settings.rate)
    startingSpeech = false
    void playback.then(outcome => finished(run, outcome), cause => {
      finished(run, { status: 'error', error: cause instanceof Error ? cause.message : 'Practice speech could not be played.' })
    })
  }

  const begin = (index: number) => {
    if (disposed) return
    if (validationError) { halt(validationError); return }
    if (acquiring || stopping || startingSpeech || externalInterruption) {
      halt('Audio is still changing. Wait for it to stop, then tap Play again.')
      return
    }
    const request = invalidate()
    const error = cancel()
    if (error) { report(error); return }
    if (disposed || request !== version) return
    if (!lease?.isCurrent()) {
      acquiring = true
      try {
        const nextLease = acquireAudio(() => {
          const interrupted = invalidate()
          if (stopping || externalInterruption) {
            const error = 'Audio is still stopping. Wait for it to stop before starting other audio.'
            report(error)
            throw new Error(error)
          }
          const cancelError = cancel()
          if (cancelError) {
            report(cancelError)
            throw new Error(cancelError)
          }
          if (interrupted !== version) return
          release()
          publish({ status: 'paused', index: state.index, repetition: state.repetition })
        })
        acquiring = false
        if (disposed || request !== version || !nextLease.isCurrent()) {
          nextLease.release()
          return
        }
        lease = nextLease
      } catch (cause) {
        // acquireAudio cannot return the failed previous owner's cancellation
        // handle. Do not pretend browser speech cancellation can recover it.
        fatalStopError = cause instanceof Error ? cause.message : 'Other audio could not be stopped.'
        stopRequired = true
        report(fatalStopError)
        return
      } finally {
        acquiring = false
      }
    }
    const cancelError = cancel(true)
    if (cancelError) { report(cancelError); return }
    if (current(request)) speak(index, 1)
  }

  return {
    play: () => begin(state.index),
    pause: () => { if (!disposed) halt() },
    previous: () => begin(Math.max(0, state.index - 1)),
    next: () => begin(Math.min(phrases.length - 1, state.index + 1)),
    select: (index: number) => {
      if (disposed) return
      if (!Number.isInteger(index) || index < 0 || index >= phrases.length) halt('Choose an existing practice phrase.')
      else begin(index)
    },
    configure: (nextTexts: string[], nextOptions: PracticePlaybackOptions, index?: number) => {
      if (disposed) return
      const error = idError ?? validate(nextTexts, nextOptions, index)
      if (error) { halt(error); return }
      const request = invalidate()
      const cancelError = externalInterruption ? undefined : cancel()
      if (cancelError) { report(cancelError); return }
      if (request !== version || disposed) return
      phrases = [...nextTexts]
      settings = { ...nextOptions }
      validationError = undefined
      if (!stopping && !stopRequired && !activeRun) release()
      publish({ status: 'paused', index: index ?? Math.min(state.index, phrases.length - 1), repetition: 1 })
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      invalidate()
      const error = externalInterruption ? (stopRequired ? state.error : undefined) : cancel()
      if (!error && !activeRun) release()
      if (error) report(error)
      else publish({ status: 'paused', index: state.index, repetition: state.repetition })
    },
    getState: (): PracticePlaybackState => ({ ...state }),
  }
}
