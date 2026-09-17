import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech, subscribeSpeechInterruption } from './assistant/speech'
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
  const publish = (next: GuidedAudioState) => { state = next; changed(state) }
  const cancel = () => {
    ++version
    clearTimeout(timer)
    timer = undefined
    if (getPlaybackState().activeId === id) {
      cancelling = true
      stopBrowserSpeech()
      cancelling = false
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
    cancel()
    if (index >= steps.length) {
      publish({ status: 'completed', index: steps.length })
      return
    }
    const step = steps[index]
    const request = version
    publish({ status: step.kind === 'response' ? 'responding' : 'playing', index })
    if (step.kind === 'response') {
      timer = setTimeout(() => { if (request === version) play(index + 1) }, step.seconds * 1000)
    } else {
      playBrowserSpeech(id, step.text, step.locale, step.locale === 'zh-Hans' ? 0.85 : 1, result => {
        if (request !== version) return
        if (result.kind === 'ended') {
          // Yield out of the utterance callback so cancellation can invalidate the next segment.
          timer = setTimeout(() => { if (request === version) play(index + 1) }, 0)
        } else if (result.kind === 'error') {
          publish({ status: 'error', index, error: result.message })
        } else {
          publish({ status: 'paused', index })
        }
      })
    }
  }
  return {
    start: () => {
      if (!steps.length) {
        publish({ status: 'error', index: 0, error: 'This lesson has no audio content.' })
      } else play(0)
    },
    resume: () => play(state.index < steps.length ? state.index : 0),
    pause: () => { cancel(); publish({ status: 'paused', index: state.index }) },
    stop: () => { cancel(); publish({ status: 'idle', index: 0 }) },
    next: () => play(Math.min(state.index + 1, steps.length)),
    repeat: () => {
      const modelId = steps[Math.min(state.index, steps.length - 1)]?.modelId
      play(Math.max(0, steps.findIndex(step => step.modelId === modelId)))
    },
    dispose: () => { unsubscribe(); cancel() },
  }
}
