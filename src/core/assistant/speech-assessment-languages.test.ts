import { describe, expect, it } from 'vitest'
import { pronunciationScored, recognitionLanguage } from './speech-assessment'

describe('speech assessment languages', () => {
  it('recognises each locale in its own language', () => {
    expect(recognitionLanguage).toEqual({ 'en-US': 'en-US', 'zh-Hans': 'zh-CN', 'ja-JP': 'ja-JP', 'ko-KR': 'ko-KR' })
  })
  it('keeps pronunciation scoring for Mandarin and English and falls back to transcript-only grading for Japanese and Korean', () => {
    expect(pronunciationScored('zh-Hans')).toBe(true)
    expect(pronunciationScored('en-US')).toBe(true)
    expect(pronunciationScored('ja-JP')).toBe(false)
    expect(pronunciationScored('ko-KR')).toBe(false)
  })
})
