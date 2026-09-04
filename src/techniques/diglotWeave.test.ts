import { describe, expect, it } from 'vitest'
import { removeOverlaps } from './diglotWeave'

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
})
