import { describe, expect, it } from 'vitest'
import type { LearningItem } from '../core/domain'
import {
  annotationsForLearningItem,
  removeOverlaps,
} from './diglotWeave'

describe('diglot weave overlap selection', () => {
  it('prefers the longest span at the same position', () => {
    const base = {
      id: 'a',
      itemId: 'item',
      targetText: '目标',
      romanization: 'mùbiāo',
      gloss: 'target',
      tier: 'learning' as const,
    }
    const result = removeOverlaps([
      { ...base, sourceText: 'take', start: 0, end: 4 },
      { ...base, id: 'b', sourceText: 'take care', start: 0, end: 9 },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.sourceText).toBe('take care')
  })

  describe('library-wide item matching', () => {
    const item: LearningItem = {
      id: 'door',
      targetLanguage: 'zh',
      sourceText: 'door',
      targetText: '门',
      romanization: 'mén',
      gloss: 'door',
      itemType: 'word',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    it('matches every whole-word occurrence regardless of casing', () => {
      const annotations = annotationsForLearningItem(
        'The door opened. Another Door closed.',
        item,
        'learning',
      )

      expect(annotations.map(({ start }) => start)).toEqual([4, 25])
    })

    it('does not match inside another word', () => {
      const annotations = annotationsForLearningItem(
        'The door was near the outdoor path.',
        item,
        'learning',
      )

      expect(annotations).toHaveLength(1)
      expect(annotations[0]?.sourceText).toBe('door')
    })
  })
})
