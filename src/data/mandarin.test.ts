import { describe, expect, it } from 'vitest'
import { getLesson, getStory, getWord, lessons, retiredLessonIds, starterWords, stories, words } from './mandarin'

describe('authored Mandarin collection', () => {
  it('uses unique words and unambiguous answer choices', () => {
    expect(new Set(words.map(word => word.id)).size).toBe(words.length)
    expect(new Set(starterWords.map(word => word.native)).size).toBe(starterWords.length)
    expect(new Set(starterWords.map(word => word.meaning)).size).toBe(starterWords.length)
    for (const word of starterWords) {
      expect(word.id).toMatch(/^zh:/)
      expect(word.pinyin).not.toBe('')
      expect(word.native).toMatch(/\p{Script=Han}/u)
    }
    expect(getWord('zh:cup').native).toBe('\u676f\u5b50')
    expect(getWord('zh:cupful').native).toBe('\u676f')
  })

  it('aligns story annotations and curriculum references without inferred translations', () => {
    for (const story of stories) {
      expect(getStory(story.id)).toBe(story)
      expect(story.attribution).toContain('Original LinguaWeave')
      for (const passage of story.passages) {
        const ids = (segments: typeof passage.source) => segments.flatMap(segment => typeof segment === 'string' ? [] : [segment.wordId])
        expect(new Set(ids(passage.source))).toEqual(new Set(ids(passage.target)))
        ids(passage.source).forEach(id => expect(getWord(id)).toBeDefined())
      }
    }
    for (const lesson of lessons) {
      lesson.wordIds.forEach(id => expect(getWord(id)).toBeDefined())
    }
  })

  it('contains curriculum lessons only and cannot reopen the removed starters', () => {
    expect(lessons).toHaveLength(32)
    for (const id of retiredLessonIds) {
      expect(() => getLesson(id)).toThrow('not available')
      expect(lessons.some(lesson => lesson.id === id)).toBe(false)
    }
  })
})
