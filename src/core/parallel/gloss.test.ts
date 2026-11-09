import { describe, expect, it } from 'vitest'
import { glossOf, loadParallel } from './data'

describe('Short glosses on Japanese and Korean cards', () => {
  it('gives every word of the lessons a card gloss that is short, while english keeps the full definition', async () => {
    for (const language of ['ja', 'ko'] as const) {
      const data = await loadParallel(language)
      const ids = new Set(data.lessons.flatMap(lesson => lesson.words.map(word => word.entry)))
      for (const id of ids) expect(glossOf(data.entries[id]).length, id).toBeLessThanOrEqual(40)
    }
  })

  it('reads 저 as I; me (polite) and 학생 as student; the definition stays on the entry', async () => {
    const data = await loadParallel('ko')
    const find = (target: string) => Object.values(data.entries).find(entry => entry.target === target)!
    expect(glossOf(find('저'))).toBe('I; me (polite)')
    expect(glossOf(find('학생'))).toBe('student')
    expect(find('저').english).toContain('humble form')
  })
})
