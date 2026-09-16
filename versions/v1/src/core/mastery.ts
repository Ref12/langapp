import type { KnowledgeTier, ReviewActivity } from './domain'

const activityWeight: Record<ReviewActivity, number> = {
  matching: 0.12,
  'fill-blank': 0.18,
  sentence: 0.24,
}

export function applyReviewEvidence(
  confidence: number,
  activity: ReviewActivity,
  correct: boolean,
): { confidence: number; tier: KnowledgeTier } {
  const weight = activityWeight[activity]
  const nextConfidence = Math.max(
    0,
    Math.min(1, confidence + (correct ? weight : -weight * 0.8)),
  )
  const tier: KnowledgeTier =
    nextConfidence >= 0.85
      ? 'mastered'
      : nextConfidence >= 0.5
        ? 'familiar'
        : 'learning'

  return { confidence: nextConfidence, tier }
}
