import { describe, expect, it, vi } from 'vitest'
import { withAutoCompletedSpeechPreparation } from './mock-speech-preparation'

interface Utterance {
  text: string
  volume?: number
  onstart?: (() => void) | null
  onend?: (() => void) | null
}

describe('target-focused speech preparation adapter', () => {
  it('completes muted preparation synchronously and forwards unchanged targets to the original spy', () => {
    const native = { speak: vi.fn<(utterance: Utterance) => void>() }
    const wrapped = withAutoCompletedSpeechPreparation(native)
    const order: string[] = []
    const prep: Utterance = {
      text: '准备好了。',
      onstart: () => { order.push('start') },
      onend: () => { order.push('end') },
    }
    Object.assign(prep, { volume: 0 })
    wrapped.speak(prep)
    expect(order).toEqual(['start', 'end'])
    expect(native.speak).not.toHaveBeenCalled()
    const target = { text: '你好' }
    wrapped.speak(target)
    expect(native.speak).toHaveBeenCalledExactlyOnceWith(target)
  })

  it('keeps event registration, original dispatch, and removal on the same EventTarget', () => {
    const native = Object.assign(new EventTarget(), { speak: vi.fn<(utterance: Utterance) => void>() })
    const wrapped = withAutoCompletedSpeechPreparation(native)
    const listener = vi.fn((event: Event) => { expect(event.currentTarget).toBe(native) })
    wrapped.addEventListener('voiceschanged', listener)
    native.dispatchEvent(new Event('voiceschanged'))
    expect(listener).toHaveBeenCalledOnce()
    wrapped.dispatchEvent(new Event('voiceschanged'))
    expect(listener).toHaveBeenCalledTimes(2)
    wrapped.removeEventListener('voiceschanged', listener)
    native.dispatchEvent(new Event('voiceschanged'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('preserves prototype getters, their receiver, and live native properties and spies', () => {
    class Native extends EventTarget {
      #paused = false
      speak = vi.fn<(utterance: Utterance) => void>()
      cancel = vi.fn()
      get paused() { return this.#paused }
      set paused(value: boolean) { this.#paused = value }
    }
    const native = new Native()
    const wrapped = withAutoCompletedSpeechPreparation(native)
    expect(wrapped.paused).toBe(false)
    native.paused = true
    expect(wrapped.paused).toBe(true)
    expect(wrapped.cancel).toBe(native.cancel)
    wrapped.cancel()
    expect(native.cancel).toHaveBeenCalledOnce()
  })
})
