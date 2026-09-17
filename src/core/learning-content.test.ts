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
        expected.push({ kind: 'grammar', section })
        for (const example of section.examples) expected.push({ kind: 'grammar', section, example })
      } else {
        for (const model of section.models) expected.push({ kind: 'model', section, model })
      }
    }
    expected.push({ kind: 'practice' })
    expect(buildLessonPages(lesson)).toEqual(expected)
  })
})
