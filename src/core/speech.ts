let activeUtterance: SpeechSynthesisUtterance | undefined

export function canReadAloud(): boolean {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

function matchingVoice(
  voices: SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice | undefined {
  const normalized = language.toLocaleLowerCase()
  const prefix = normalized.split('-')[0]
  return (
    voices.find((voice) => voice.lang.toLocaleLowerCase() === normalized) ??
    voices.find((voice) =>
      voice.lang.toLocaleLowerCase().startsWith(`${prefix}-`),
    )
  )
}

export async function loadSpeechVoice(
  language: string,
  timeoutMs = 2_000,
): Promise<SpeechSynthesisVoice> {
  if (!canReadAloud()) {
    throw new Error('Read aloud is not supported by this browser.')
  }

  const synthesis = window.speechSynthesis
  const immediate = matchingVoice(synthesis.getVoices(), language)
  if (immediate) return immediate

  const voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synthesis.removeEventListener('voiceschanged', finish)
      resolve(synthesis.getVoices())
    }
    synthesis.addEventListener('voiceschanged', finish)
    window.setTimeout(finish, timeoutMs)
  })

  const voice = matchingVoice(voices, language)
  if (!voice) {
    throw new Error(
      `No ${language} speech voice is installed or available in this browser.`,
    )
  }
  return voice
}

export async function readAloud(
  text: string,
  language: string,
  rate: number,
): Promise<string> {
  const voice = await loadSpeechVoice(language)
  const synthesis = window.speechSynthesis

  if (activeUtterance) {
    activeUtterance.onend = null
    activeUtterance.onerror = null
  }
  synthesis.cancel()
  if (synthesis.paused) synthesis.resume()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language
  utterance.voice = voice
  utterance.rate = Math.max(0.25, Math.min(1, rate))
  utterance.volume = 1
  activeUtterance = utterance

  return new Promise((resolve, reject) => {
    utterance.onend = () => {
      activeUtterance = undefined
      resolve(voice.name)
    }
    utterance.onerror = (event) => {
      activeUtterance = undefined
      reject(
        new Error(
          event.error
            ? `Speech playback failed: ${event.error}.`
            : 'Speech playback failed.',
        ),
      )
    }
    synthesis.speak(utterance)
    window.setTimeout(() => {
      if (synthesis.paused) synthesis.resume()
    }, 100)
  })
}
