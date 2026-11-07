import { describe, expect, it } from 'vitest'
import { gradeChinese, gradeMeaning, sensesOf } from './grade'

const forms = new Set(['我', '你', '都', '不', '了', '是', '学生', '喜欢', '吃', '饭'])
describe('gradeChinese', () => {
  it('accepts an alternative wording', () => {
    const grade = gradeChinese('我们都是学生', ['我们都是学生', '我们是学生'], forms)
    expect(grade.verdict).toBe('correct')
  })
  it('names a dropped 都', () => {
    const grade = gradeChinese('我是学生', ['我都是学生'], forms)
    expect(grade.verdict).toBe('diff')
    expect(grade.messages).toContain('missing 都')
  })
  it('names a missing 不', () => {
    const grade = gradeChinese('我喜欢吃饭', ['我不喜欢吃饭'], forms)
    expect(grade.messages).toContain('missing 不')
  })
  it('names swapped 你 and 我', () => {
    const grade = gradeChinese('你是我', ['我是你'], forms)
    expect(grade.messages.join(' ')).toMatch(/swapped/)
  })
  it('ignores an optional 了 when another accepted answer lacks it', () => {
    expect(gradeChinese('我吃饭了', ['我吃饭', '我吃饭了'], forms).verdict).toBe('correct')
    expect(gradeChinese('我吃饭了', ['我吃饭'], forms).verdict).toBe('correct')
  })
})

describe('English meaning grading', () => {
  const senses = sensesOf('to learn; to study')
  it('accepts a sense ignoring case, punctuation, articles and a leading to', () => {
    expect(gradeMeaning('Study!', senses).verdict).toBe('correct')
    expect(gradeMeaning('to learn', senses).verdict).toBe('correct')
    expect(gradeMeaning('the study', senses).verdict).toBe('correct')
  })
  it('accepts a typo or a plural with a note', () => {
    const typo = gradeMeaning('studdy', senses)
    expect(typo.verdict).toBe('near'); expect(typo.note).toBeTruthy()
    expect(gradeMeaning('studies', ['study']).verdict).toBe('near')
  })
  it('marks Chinese or unrelated answers wrong', () => {
    expect(gradeMeaning('我', senses).verdict).toBe('wrong')
    expect(gradeMeaning('banana', senses).verdict).toBe('wrong')
  })
  it('sends a partial overlap to self-marking, also for sentences', () => {
    expect(gradeMeaning('I study every day', ['I study Chinese']).verdict).toBe('self')
    expect(gradeMeaning('I am a teacher', ['I am a teacher.', 'I am the teacher']).verdict).toBe('correct')
  })
  it('splits senses on commas too', () => { expect(sensesOf('am, is; are')).toEqual(['am', 'is', 'are']) })
})
