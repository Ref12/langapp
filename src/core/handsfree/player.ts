import { getPlaybackState, playBrowserSpeechToEnd, stopBrowserSpeech, subscribeSpeechInterruption } from '../assistant/speech'
import { acquireAudio, type AudioLease } from '../assistant/audio-owner'
import type { SpeechVoicePreference } from '../assistant/contracts'
import type { Script, Segment } from './script'

/** The voices a script's segments ask for; an unset one follows the saved voice for its language. */
export type HandsfreeVoices = Partial<Record<Extract<Segment, { kind: 'say' }>['voice'], SpeechVoicePreference>>
/** How long a pause lasts: its estimate, or when the model text just spoken was timed, that time x factor + gap if longer. */
export function pauseLength(segment: Extract<Segment, { kind: 'pause' }>, spokenMs?: number) {
  return segment.measure && spokenMs ? Math.max(segment.ms, Math.round(spokenMs * segment.measure.factor + segment.measure.gap)) : segment.ms
}

export interface HandsfreeState {
  status: 'idle' | 'playing' | 'paused' | 'completed' | 'error'
  /** Index of the prompt being played or resumed at. */
  prompt: number
  error?: string
}

/** Plays a script prompt by prompt with browser speech, holding the app's audio lease while it runs. Back and skip move by prompt. */
export function createHandsfreePlayer(id: string, getScript: () => Script, changed: (state: HandsfreeState) => void, startAt = 0, getVoices: () => HandsfreeVoices = () => ({}), onSpeak: (segment: Extract<Segment, { kind: 'say' }> | undefined) => void = () => undefined) {
  let state: HandsfreeState = { status: 'idle', prompt: startAt }
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0
  let cancelling = false
  let disposed = false
  /** When the script is swapped mid-prompt, the prompt after the current one is counted in the new script. */
  let shift = 0
  let lease: AudioLease | undefined
  const publish = (next: HandsfreeState) => {
    if (next.status !== 'playing') { lease?.release(); lease = undefined }
    state = next
    changed(state)
  }
  const cancel = (all = false) => {
    shift = 0
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
    if (!cancelling && nextId !== id && state.status === 'playing') {
      ++version
      clearTimeout(timer)
      timer = undefined
      publish({ status: 'paused', prompt: state.prompt })
    }
  })
  const promptEnd = (script: Script, prompt: number) => script.promptStarts[prompt + 1] ?? script.segments.length
  /** Plays segment `at` of the prompt, then the next, then the next prompt. */
  const play = (prompt: number, at?: number) => {
    const script = getScript()
    const error = cancel()
    if (error) { publish({ status: 'error', prompt: state.prompt, error }); return }
    if (disposed || !lease?.isCurrent()) return
    if (prompt >= script.promptStarts.length) { publish({ status: 'completed', prompt: script.promptStarts.length }); return }
    const request = version
    const first = script.promptStarts[prompt]
    const end = promptEnd(script, prompt)
    if (state.status !== 'playing' || state.prompt !== prompt) publish({ status: 'playing', prompt })
    if (request !== version || disposed || !lease?.isCurrent()) return
    let lastSpoken: number | undefined
    const step = (index: number) => {
      if (request !== version) return
      if (index >= end) { timer = setTimeout(() => { if (request === version) { const next = prompt + 1 + shift; shift = 0; play(next) } }, 0); return }
      const segment = script.segments[index]
      if (segment.kind === 'marker') { onSpeak(undefined); step(index + 1); return }
      if (segment.kind === 'pause') { timer = setTimeout(() => step(index + 1), pauseLength(segment, lastSpoken)); return }
      onSpeak(segment)
      const began = Date.now()
      void playBrowserSpeechToEnd(id, segment.text, segment.locale, segment.rate, { voice: getVoices()[segment.voice], anyRate: true, ...(segment.volume !== undefined ? { volume: segment.volume } : {}) }).then(result => {
        if (request !== version) return
        if (result.status === 'completed') { lastSpoken = Date.now() - began; timer = setTimeout(() => step(index + 1), 0) }
        else if (result.status === 'error') publish({ status: 'error', prompt, error: result.error })
        else publish({ status: 'paused', prompt })
      }).catch(cause => {
        if (request !== version) return
        publish({ status: 'error', prompt, error: cause instanceof Error ? cause.message : 'Hands-free audio could not be played.' })
      })
    }
    step(at ?? first)
  }
  const begin = (prompt: number) => {
    if (disposed) return
    if (lease?.isCurrent()) { play(prompt); return }
    const request = version
    try {
      const next = acquireAudio(() => {
        const error = cancel()
        publish(error ? { status: 'error', prompt: state.prompt, error } : { status: 'paused', prompt: state.prompt })
        if (error) throw new Error(error)
      })
      if (request !== version || !next.isCurrent()) { next.release(); return }
      lease = next
      const error = cancel(true)
      if (error) { publish({ status: 'error', prompt: state.prompt, error }); return }
      play(prompt)
    } catch (cause) {
      publish({ status: 'error', prompt: state.prompt, error: cause instanceof Error ? cause.message : 'Other audio could not be stopped.' })
    }
  }
  const last = () => Math.max(0, getScript().promptStarts.length - 1)
  const go = (prompt: number) => {
    const target = Math.max(0, Math.min(prompt, getScript().promptStarts.length))
    if (state.status === 'playing') play(target)
    else if (target >= getScript().promptStarts.length) publish({ status: 'completed', prompt: target })
    else publish({ status: 'paused', prompt: target })
  }
  return {
    play: () => begin(state.status === 'completed' ? 0 : Math.min(state.prompt, last())),
    pause: () => {
      const error = cancel()
      publish(error ? { status: 'error', prompt: state.prompt, error } : { status: 'paused', prompt: state.prompt })
    },
    /** One prompt back (or forward): the prompt starts over from its beginning. */
    back: () => go(state.prompt - 1),
    skip: () => go(state.prompt + 1),
    /** The script was rebuilt: this prompt is now number `prompt`. What is being said finishes as it is; the next prompt comes from the new script. */
    rebase: (prompt: number) => {
      if (disposed || state.status === 'completed' || state.status === 'idle' || prompt === state.prompt) return
      if (state.status === 'playing') shift += prompt - state.prompt
      publish({ ...state, prompt })
    },
    state: () => state,
    dispose: () => {
      disposed = true
      unsubscribe()
      const error = cancel()
      lease?.release()
      lease = undefined
      if (error) publish({ status: 'error', prompt: state.prompt, error })
    },
  }
}
