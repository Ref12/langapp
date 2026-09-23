import type { Unit } from './catalog'
import type { StudyCard } from './contracts'

export function unitKindLabel(unit: Unit): string {
  return unit.kind === 'vocabulary' ? 'Vocabulary' : 'Grammar'
}

/** Learner-facing scheduling status. Being in the knowledge set is eligibility, not proficiency. */
export function cardStatus(card?: StudyCard, now?: number): string {
  if (!card) return 'Not in knowledge set'
  if (card.state === 'new') return 'Eligible for review'
  if (now !== undefined && card.due <= now) return 'Due now'
  return card.state === 'review' ? 'Scheduled' : 'Relearning'
}
