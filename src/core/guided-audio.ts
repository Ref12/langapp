import { getPlaybackState, playBrowserSpeechToEnd, stopBrowserSpeech, subscribeSpeechInterruption } from './assistant/speech'
import { acquireAudio, type AudioLease } from './assistant/audio-owner'
import type { AudioStep } from './learning-content'

export interface GuidedAudioState {
  status: 'idle' | 'playing' | 'responding' | 'paused' | 'completed' | 'error'
  index: number
  error?: string
}

// The script is a presentation of authored content, never learner assessment.
export function createGuidedAudio(id: string, steps: AudioStep[], changed: (state: GuidedAudioState) => void) {
  let state: GuidedAudioState = { status: 'idle', index: 0 }
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0
  let cancelling = false
  let disposed = false
  let lease: AudioLease | undefined
  const publish = (next: GuidedAudioState) => {
    if (!['playing', 'responding'].includes(next.status)) {
      lease?.release()
      lease = undefined
    }
    state = next
    changed(state)
  }
  const cancel = (all = false) => {
    ++version
    clearTimeout(timer)
    timer = undefined
    if (all || getPlaybackState().activeId === id) {
      cancelling = true
      const error = stopBrowserSpeech()
      cancelling = false
      return error
    }
  }
  const unsubscribe = subscribeSpeechInterruption(nextId => {
    if (!cancelling && nextId !== id && ['playing', 'responding'].includes(state.status)) {
      ++version
      clearTimeout(timer)
      timer = undefined
      publish({ status: 'paused', index: state.index })
    }
  })
  const play = (index: number) => {
    const error = cancel()
    if (error) { publish({ status: 'error', index: state.index, error }); return }
    if (disposed || !lease?.isCurrent()) return
    if (index >= steps.length) {
      publish({ status: 'completed', index: steps.length })
      return
    }
    const step = steps[index]
    const request = version
    publish({ status: step.kind === 'response' ? 'responding' : 'playing', index })
    if (request !== version || disposed || !lease?.isCurrent()) return
    if (step.kind === 'response') {
      timer = setTimeout(() => { if (request === version) play(index + 1) }, step.seconds * 1000)
    } else {
      void playBrowserSpeechToEnd(id, step.text, step.locale, step.locale === 'zh-Hans' ? 0.85 : 1).then(result => {
        if (request !== version) return
        if (result.status === 'completed') {
          // Yield out of the utterance callback so cancellation can invalidate the next segment.
          timer = setTimeout(() => { if (request === version) play(index + 1) }, 0)
        } else if (result.status === 'error') {
          publish({ status: 'error', index, error: result.error })
        } else {
          publish({ status: 'paused', index })
        }
      }).catch(cause => {
        if (request !== version) return
        publish({ status: 'error', index, error: cause instanceof Error ? cause.message : 'Lesson audio could not be played.' })
      })
    }
  }
  const begin = (index: number) => {
    if (disposed) return
    if (lease?.isCurrent()) { play(index); return }
    const request = version
    try {
      const nextLease = acquireAudio(() => {
        const error = cancel()
        publish(error ? { status: 'error', index: state.index, error } : { status: 'paused', index: state.index })
        if (error) throw new Error(error)
      })
      if (request !== version || !nextLease.isCurrent()) {
        nextLease.release()
        return
      }
      lease = nextLease
      const error = cancel(true)
      if (error) { publish({ status: 'error', index: state.index, error }); return }
      play(index)
    } catch (cause) {
      publish({ status: 'error', index: state.index, error: cause instanceof Error ? cause.message : 'Other audio could not be stopped.' })
    }
  }
  const halt = (status: 'idle' | 'paused') => {
    const error = cancel()
    publish(error ? { status: 'error', index: state.index, error } : { status, index: status === 'idle' ? 0 : state.index })
  }
  return {
    start: () => {
      if (!steps.length) {
        publish({ status: 'error', index: 0, error: 'This lesson has no audio content.' })
      } else begin(0)
    },
    resume: () => begin(state.index < steps.length ? state.index : 0),
    pause: () => halt('paused'),
    stop: () => halt('idle'),
    next: () => lease?.isCurrent() ? play(Math.min(state.index + 1, steps.length)) : begin(Math.min(state.index + 1, steps.length)),
    repeat: () => {
      const modelId = steps[Math.min(state.index, steps.length - 1)]?.modelId
      const index = Math.max(0, steps.findIndex(step => step.modelId === modelId))
      if (lease?.isCurrent()) play(index)
      else begin(index)
    },
    dispose: () => {
      disposed = true
      unsubscribe()
      const error = cancel()
      lease?.release()
      lease = undefined
      if (error) publish({ status: 'error', index: state.index, error })
    },
  }
}
