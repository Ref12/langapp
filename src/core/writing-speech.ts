/** When the writing practice says the character: at transitions (shown, a repetition completed), on every stroke, or never. */
export const WRITING_SPEECH = ['transitions', 'stroke', 'off'] as const
export type WritingSpeech = typeof WRITING_SPEECH[number]
export const WRITING_SPEECH_LABEL: Record<WritingSpeech, string> = { transitions: 'At transitions', stroke: 'Every stroke', off: 'Off' }

/** The mode in force. The older on/off preference (`writingAutoSpeak`) reads as At transitions, or Off when it was off. */
export function writingSpeechMode(preferences: { writingSpeech?: WritingSpeech; writingAutoSpeak?: boolean }): WritingSpeech {
  return preferences.writingSpeech ?? (preferences.writingAutoSpeak === false ? 'off' : 'transitions')
}

/** What the quick mute switches Off back to: the last non-Off choice. */
export function writingSpeechResume(preferences: { writingSpeechResume?: WritingSpeech }): Exclude<WritingSpeech, 'off'> {
  return preferences.writingSpeechResume === 'stroke' ? 'stroke' : 'transitions'
}
