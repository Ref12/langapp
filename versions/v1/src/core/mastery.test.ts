import { describe, expect, it } from 'vitest'
import { applyReviewEvidence } from './mastery'

describe('mastery projection', () => {
  it('weights production evidence more strongly than matching', () => {
    const matching = applyReviewEvidence(0.4, 'matching', true)
    const sentence = applyReviewEvidence(0.4, 'sentence', true)

    expect(sentence.confidence).toBeGreaterThan(matching.confidence)
    expect(sentence.tier).toBe('familiar')
  })

  it('regresses confidence after an incorrect answer', () => {
    const result = applyReviewEvidence(0.9, 'fill-blank', false)

    expect(result.confidence).toBeLessThan(0.9)
  })
})
