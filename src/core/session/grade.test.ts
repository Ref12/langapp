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
    expect(grade.messages.join(' ')).toMatch(/word order: 我 comes before 你/)
  })
  it('ignores an optional 了 when another accepted answer lacks it', () => {
    expect(gradeChinese('我吃饭了', ['我吃饭', '我吃饭了'], forms).verdict).toBe('correct')
    expect(gradeChinese('我吃饭了', ['我吃饭'], forms).verdict).toBe('correct')
  })
})

describe('equivalent wordings', () => {
  const f = new Set(['你', '您', '休息', '吧', '他', '她', '它', '好', '不', '吗', '们', '他们', '她们', '它们', '是', '谢谢', '你们'])
  it('accepts 你 for 您 when the English does not say', () => {
    const grade = gradeChinese('你休息吧', ['您休息吧'], f, [], 'Please rest.')
    expect(grade.verdict).toBe('correct')
    expect(grade.note).toMatch(/polite/)
  })
  it('accepts 它 for 他 only for "it"', () => {
    expect(gradeChinese('它是好', ['他是好'], f, [], 'It is good.').verdict).toBe('correct')
    expect(gradeChinese('她是好', ['他是好'], f, [], 'He is good.').verdict).toBe('diff')
  })
  it('accepts 她们 for 他们 for "they"', () => {
    expect(gradeChinese('她们是好', ['他们是好'], f, [], 'They are good.').verdict).toBe('correct')
  })
  it('accepts A-not-A for 吗 in a plain yes/no question', () => {
    expect(gradeChinese('好不好', ['好吗'], f, [], 'Is that okay?').verdict).toBe('correct')
    expect(gradeChinese('好不好', ['好吗'], f, [], 'Why is that okay?').verdict).toBe('diff')
  })
  it('stays a difference when more than the swap differs', () => {
    expect(gradeChinese('你吧', ['您休息吧'], f, [], 'Please rest.').verdict).toBe('diff')
  })
  it('words a pure word-order difference plainly', () => {
    expect(gradeChinese('你们谢谢', ['谢谢你们'], f, [], 'Thank you all.').messages).toEqual(['word order: 谢谢 comes before 你们'])
  })
})

describe('English meaning grading', () => {
  const senses = sensesOf('to learn; to study')
  it('accepts a sense ignoring case, punctuation, articles and a leading to', () => {
    expect(gradeMeaning('Study!', senses).verdict).toBe('correct')
    expect(gradeMeaning('to learn', senses).verdict).toBe('correct')
    expect(gradeMeaning('the study', senses).verdict).toBe('correct')
  })
  it('accepts every sense of 学习 (to learn; to study), with or without "to"', () => {
    for (const answer of ['to study', 'study', 'learn', 'to learn']) expect(['correct', 'near']).toContain(gradeMeaning(answer, senses).verdict)
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
