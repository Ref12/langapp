import type { PronunciationService, TranscriptionService } from './contracts'
import { startCapture } from './capture'
import { assessPronunciation } from './azure'

// Replace these narrow adapters for a future token broker or server transport.
export const transcriptionService: TranscriptionService = { start: startCapture }
export const pronunciationService: PronunciationService = { assess: assessPronunciation }
