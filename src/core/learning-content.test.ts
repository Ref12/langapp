import { describe, expect, it } from 'vitest'
import { buildLessonPages, type LessonPage } from './learning-content'
import { learningContent } from '../data/learning-content'

describe('whole-lesson pagination', () => {
  it.each(learningContent.lessons)('preserves every authored section and item in order for $title', lesson => {
    const expected: LessonPage[] = [{ kind: 'overview' }]
    for (const section of lesson.sections) {
      if (section.kind === 'vocabulary') {
        for (const word of section.words) expected.push({ kind: 'vocabulary', section, word })
      } else if (section.kind === 'grammar') {
        if (section.examples.length === 0) expected.push({ kind: 'grammar', section })
        for (const example of section.examples) expected.push({ kind: 'grammar', section, example })
      } else {
        for (const model of section.models) expected.push({ kind: 'model', section, model })
      }
    }
    expected.push({ kind: 'practice' })
    expect(buildLessonPages(lesson)).toEqual(expected)
  })

  it.each([0, 1, 2])('uses only the needed grammar pages for %i examples', count => {
    const lesson = learningContent.lessons[0]
    const source = lesson.sections.find(section => section.kind === 'grammar')!
    const section = {
      ...source,
      examples: Array.from({ length: count }, (_, index) => ({ ...source.examples[0], translation: `Example ${index + 1}` })),
    }
    const pages = buildLessonPages({ ...lesson, sections: [section] }).filter(page => page.kind === 'grammar')
    expect(pages).toHaveLength(Math.max(count, 1))
    expect(pages[0].section.description).toBe(source.description)
    expect(pages.flatMap(page => page.example ? [page.example] : [])).toEqual(section.examples)
  })
})
