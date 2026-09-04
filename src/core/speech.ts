export function canReadAloud(): boolean {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function readAloud(text: string, language: string): void {
  if (!canReadAloud()) {
    throw new Error('Read aloud is not supported by this browser.')
  }

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language
  utterance.rate = 0.9
  window.speechSynthesis.speak(utterance)
}
