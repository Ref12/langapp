import { alignAssessmentWords } from './alignment'

export type SpeechLocale = 'en-US' | 'zh-CN' | 'ja-JP' | 'ko-KR'
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

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const score = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
const shortText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined

/** No provider defaults: absent or invalid acoustic measurements stay absent. */
export function parseAssessment(payload: unknown): AssessmentResult {
  const root = object(payload)
  if (root?.RecognitionStatus === 'NoMatch' || root?.RecognitionStatus === 'InitialSilenceTimeout') {
    return { status: 'no-speech', words: [] }
  }
  if (root?.RecognitionStatus !== 'Success') return { status: 'incomplete', words: [] }
  const best = Array.isArray(root.NBest) ? object(root.NBest[0]) : undefined
  const assessment = object(best?.PronunciationAssessment)
  const words: AssessmentWord[] = []
  if (Array.isArray(best?.Words)) {
    for (const item of best.Words.slice(0, 1000)) {
      const word = object(item)
      const text = shortText(word?.Word)
      if (!text) continue
      const detail = object(word?.PronunciationAssessment)
      const entry: AssessmentWord = { text }
      const accuracy = score(detail?.AccuracyScore)
      if (accuracy !== undefined) entry.accuracy = accuracy
      if (typeof detail?.ErrorType === 'string' &&
        ['None', 'Omission', 'Insertion', 'Mispronunciation', 'UnexpectedBreak', 'MissingBreak', 'Monotone'].includes(detail.ErrorType)) {
        entry.errorType = detail.ErrorType
      }
      if (Array.isArray(word?.Phonemes)) {
        const phonemes = word.Phonemes.slice(0, 256).flatMap(value => {
          const phoneme = object(value)
          const text = shortText(phoneme?.Phoneme)
          if (!text) return []
          const accuracy = score(object(phoneme?.PronunciationAssessment)?.AccuracyScore)
          return [{ text, ...(accuracy === undefined ? {} : { accuracy }) }]
        })
        if (phonemes.length) entry.phonemes = phonemes
      }
      words.push(entry)
    }
  }
  const result: AssessmentResult = { status: 'incomplete', words }
  const accuracy = score(assessment?.AccuracyScore)
  const fluency = score(assessment?.FluencyScore)
  const completeness = score(assessment?.CompletenessScore)
  if (accuracy !== undefined) result.accuracy = accuracy
  if (fluency !== undefined) result.fluency = fluency
  if (completeness !== undefined) result.completeness = completeness
  if (accuracy !== undefined && fluency !== undefined && completeness !== undefined) result.status = 'assessed'
  return result
}

/** Phrase-level acoustic metrics cannot honestly be averaged into reference scores. */
export function combineAssessments(
  reference: string, results: AssessmentResult[], locale: SpeechLocale,
): AssessmentResult {
  let result: AssessmentResult = results.length === 0 ? { status: 'no-speech', words: [] }
    : results.length === 1 ? results[0]
      : { status: 'incomplete', words: results.flatMap(result => result.words) }
  if (results.length && results.every(result => result.words.length > 0)) {
    const words = alignAssessmentWords(reference, result.words, locale)
    result = words ? { ...result, words } : { ...result, status: 'incomplete' }
  }
  return result
}

export function assessmentTranscript(payload: unknown): string | undefined {
  const root = object(payload)
  const best = Array.isArray(root?.NBest) ? object(root.NBest[0]) : undefined
  for (const value of [root?.DisplayText, best?.Display, best?.Lexical]) {
    if (typeof value === 'string' && value.trim() && value.length <= 12_000) return value.trim()
  }
}
