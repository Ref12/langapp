import type { TargetLanguage } from '../domain'

export type SpeechLocale = 'en-US' | 'zh-CN' | 'ja-JP' | 'ko-KR'
export const targetLocales: Record<TargetLanguage, SpeechLocale> = {
  zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
}
export interface SpeechSegment { text: string; locale: SpeechLocale }
export interface ProviderIdentity { provider: 'azure'; configurationVersion: number }
export interface SpeechConnection {
  id: 'default'
  region: string
  apiKey: string
  warningAcknowledged: boolean
  configurationVersion: number
  updatedAt: string
  lastTestStatus?: 'success' | 'failure'
}
export interface CaptureResult {
  audio: Blob
  durationMs: number
  recognizedTranscript: string
  segments: SpeechSegment[]
  provider: ProviderIdentity
  interruption?: string
}
export interface CaptureSession {
  stop(): Promise<CaptureResult>
  cancel(): void
}
export interface CaptureOptions {
  targetLocale: SpeechLocale
  recognitionLocale?: SpeechLocale
  mode: 'conversation' | 'practice'
  signal: AbortSignal
  onPartial?: (text: string) => void
  onTranscript?: (segments: SpeechSegment[]) => void
  onElapsed?: (seconds: number) => void
  onFinished?: (result: CaptureResult) => void
}
export interface AssessmentWord {
  text: string
  accuracy?: number
  errorType?: string
  phonemes?: { text: string; accuracy?: number }[]
}
export interface AssessmentResult {
  status: 'assessed' | 'no-speech' | 'incomplete'
  accuracy?: number
  fluency?: number
  completeness?: number
  words: AssessmentWord[]
}
export interface VoiceRecording {
  id: string
  profileId: string
  threadId: string
  messageId?: string
  purpose: 'conversation' | 'practice'
  locale: SpeechLocale
  durationMs: number
  mimeType: 'audio/wav'
  encoding: 'pcm-s16le-16000-mono'
  audio?: Blob
  audioUnavailable?: boolean
  recognizedTranscript: string
  submittedTranscript?: string
  transcriptSegments?: SpeechSegment[]
  provider: ProviderIdentity
  createdAt: string
}
export interface PronunciationAttempt {
  id: string
  profileId: string
  threadId: string
  recordingId: string
  referenceText: string
  locale: SpeechLocale
  provider: ProviderIdentity
  result?: AssessmentResult
  error?: string
  createdAt: string
}
export interface TranscriptionService {
  start(options: CaptureOptions): Promise<CaptureSession>
}
export interface PronunciationService {
  assess(audio: Blob, referenceText: string, locale: SpeechLocale, signal: AbortSignal):
    Promise<{ result: AssessmentResult; provider: ProviderIdentity }>
}
export const speechProviders = {
  azure: { transcription: true, continuousLanguageIdentification: true, scriptedAssessment: true },
  browser: { playback: true },
} as const
