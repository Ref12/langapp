import { describe, expect, it } from 'vitest'
import { kanaInput, pinyinInput, romanizationInput } from './reading-input'

describe('the Hint of the older reading drill, by pack', () => {
  it('Chinese: the letters without tones, labelled as before', () => {
    expect(pinyinInput.hint?.label).toBe('Letters only:')
    expect(pinyinInput.hint?.of('nǐ hǎo')).toBe('ni hao')
    expect(pinyinInput.hint?.of('lǜ')).toBe('lu')
  })
  it('Japanese: the first kana and an ellipsis, dakuten kept', () => {
    expect(kanaInput.hint?.label).toBe('Starts with:')
    expect(kanaInput.hint?.of('べんきょう')).toBe('べ…')
    expect(kanaInput.hint?.of('がっこう')).toBe('が…')
  })
  it('Korean: no hint, so no button', () => {
    expect(romanizationInput.hint).toBeUndefined()
  })
})

describe('a typed romanization', () => {
  const grade = (answer: string, ...accepted: string[]) => romanizationInput.grade(answer, accepted).verdict
  it('is right with the sound changes, as spelled, with or without spaces and hyphens, in any case', () => {
    for (const text of ['gongbuhaeyo', 'Gongbuhaeyo', 'gong-bu-hae-yo', 'gong bu hae yo', "gong-bu-hae'yo"]) expect(grade(text, '공부해요'), text).toBe('correct')
    for (const text of ['haksaeng', 'hak-saeng']) expect(grade(text, '학생'), text).toBe('correct')
    expect(grade('annyeonghi gaseyo', '안녕히 가세요')).toBe('correct')
    expect(grade('annyeonghigaseyo', '안녕히 가세요')).toBe('correct')
    expect(grade('hangugeo', '한국어')).toBe('correct')
    expect(grade('hangukeo', '한국어')).toBe('correct')
  })
  it('is wrong when it reads as another word, and says what was meant', () => {
    expect(grade('gongbuhae', '공부해요')).toBe('wrong')
    expect(romanizationInput.grade('ilhaeyo', ['공부해요'])).toEqual({ verdict: 'wrong', kana: '공부해요' })
  })
  it('takes the Hangul spelling too, and leaves other characters to the learner', () => {
    expect(grade('공부해요', '공부해요')).toBe('correct')
    expect(grade('공부 해요', '공부해요')).toBe('correct')
    expect(grade('일해요', '공부해요')).toBe('wrong')
    expect(grade('', '공부해요')).toBe('self')
    expect(grade('\u3053\u3093', '공부해요')).toBe('self')
  })
  it('keeps the Hear button and the marked result', () => {
    expect([romanizationInput.audioIsAnswer, romanizationInput.takesLearningScript, romanizationInput.marks]).toEqual([false, false, true])
  })
})
