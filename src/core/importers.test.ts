import { describe, expect, it } from 'vitest'
import { splitIntoChapters } from './importers'

describe('chapter splitting', () => {
  it('recognizes markdown headings', () => {
    const chapters = splitIntoChapters(
      '# Arrival\nThe train arrived.\n\n# Departure\nIt left again.',
    )

    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.title).toBe('Arrival')
    expect(chapters[1]?.content).toContain('left again')
  })

  it('keeps unstructured text as one chapter', () => {
    const chapters = splitIntoChapters('A short standalone article.', 'Article')

    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('Article')
  })
})
