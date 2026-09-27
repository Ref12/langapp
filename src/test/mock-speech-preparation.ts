interface MockSpeechUtterance {
  volume?: number
  onstart?: (() => void) | null
  onend?: (() => void) | null
}

// For target-focused tests only. Raw preparation lifecycle tests must use the
// native queue directly so they assert both utterances and their real ordering.
export function withAutoCompletedSpeechPreparation<Utterance extends MockSpeechUtterance, Native>(
  native: Native & { speak: (utterance: Utterance) => void; paused?: boolean },
) {
  const speak = (utterance: Utterance) => {
    if (utterance.volume === 0) {
      utterance.onstart?.()
      utterance.onend?.()
    } else {
      native.speak(utterance)
    }
  }
  // Preserve prototype methods, live properties, and the original EventTarget:
  // fixtures dispatch voiceschanged on native, not on this adapter.
  return new Proxy(native, {
    get(target, property) {
      if (property === 'speak') return speak
      const value = Reflect.get(target, property, target)
      if (['addEventListener', 'removeEventListener', 'dispatchEvent'].includes(String(property)) && typeof value === 'function') {
        return value.bind(target)
      }
      return value
    },
  })
}
