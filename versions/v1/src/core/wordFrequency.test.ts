import { describe, expect, it } from 'vitest'
import { frequentContentWords } from './wordFrequency'

describe('frequent content words', () => {
  it('ranks content words and excludes common stopwords', () => {
    const words = frequentContentWords(
      'The garden gate opened. The garden was quiet. A gate creaked.',
    )

    expect(words.slice(0, 2).map(({ sourceText, count }) => ({
      sourceText: sourceText.toLowerCase(),
      count,
    }))).toEqual([
      { sourceText: 'garden', count: 2 },
      { sourceText: 'gate', count: 2 },
    ])
    expect(words.some((word) => word.sourceText.toLowerCase() === 'the')).toBe(
      false,
    )
  })

  it('excludes words already tracked by the learner', () => {
    const words = frequentContentWords('Garden garden gate gate.', 25, [
      'garden',
    ])

    expect(words).toHaveLength(1)
    expect(words[0]?.sourceText.toLowerCase()).toBe('gate')
  })

  it('excludes title-case-only proper names', () => {
    const words = frequentContentWords(
      'Arthur greeted Rose. Arthur asked Rose about the garden. The garden bloomed.',
    )

    expect(words.some((word) => word.sourceText === 'Arthur')).toBe(false)
    expect(words.some((word) => word.sourceText === 'Rose')).toBe(false)
    expect(words.some((word) => word.sourceText === 'garden')).toBe(true)
  })
})
