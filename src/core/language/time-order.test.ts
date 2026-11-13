import { describe, expect, it } from 'vitest'
import { gradeChinese } from '../session/grade'
import { gradeJapaneseSentence, JA_RULE, KO_RULE } from './japanese-sentence'
import type { SpelledToken } from './sentence-forms'

const forms = new Set(['我', '你', '晚上', '今天', '喝', '牛奶', '学习', '中文', '吃', '饭', '了'])
const owner = '我晚上喝牛奶。'
const word = (text: string, grammar = false): SpelledToken => ({ text, reading: text, grammar })
const tiles = (...texts: string[]) => texts.map(text => word(text, /^(は|が|を|に|で|는|은|를|에|도)$/.test(text)))

describe('a time word before or after the subject (Chinese)', () => {
  it('accepts the owner answer with no word-order note', () => {
    const grade = gradeChinese('我晚上喝牛奶。', ['晚上我喝牛奶。'], forms, [], 'I drink milk in the evening.')
    expect(grade.verdict).toBe('correct')
    expect(grade.messages).toEqual([])
    expect(grade.differences).toEqual([])
    expect(grade.note).toBeUndefined()
  })
  it('accepts the reverse', () => {
    const grade = gradeChinese('晚上我喝牛奶。', [owner], forms)
    expect(grade.verdict).toBe('correct')
    expect(grade.messages).toEqual([])
  })
  it('still catches a time word at the end', () => {
    const grade = gradeChinese('我喝牛奶晚上', [owner], forms)
    expect(grade.verdict).toBe('diff')
    expect(grade.messages.join(' ')).toMatch(/word order/i)
  })
  it('still catches a scrambled sentence', () => {
    const grade = gradeChinese('牛奶我喝晚上', [owner], forms)
    expect(grade.verdict).toBe('diff')
    expect(grade.messages.join(' ')).toMatch(/word order/i)
  })
  it('does not take a verb for a subject', () => {
    expect(gradeChinese('喝晚上牛奶', ['晚上喝牛奶'], forms).verdict).toBe('diff')
  })
  it('treats a date like a time word', () => {
    expect(gradeChinese('我2026年学习中文', ['2026年我学习中文'], forms).verdict).toBe('correct')
    expect(gradeChinese('2026年我学习中文', ['我2026年学习中文'], forms).verdict).toBe('correct')
    expect(gradeChinese('我学习中文2026年', ['2026年我学习中文'], forms).verdict).toBe('diff')
  })
  it('keeps an optional 了 working beside the move', () => {
    expect(gradeChinese('我今天吃饭了', ['今天我吃饭', '今天我吃饭了'], forms).verdict).toBe('correct')
  })
})

describe('a time topic before or after the subject topic (Japanese, Korean)', () => {
  const ja = { accepted: ['今日は私は学校に行きます。'], spelled: [tiles('今日', 'は', '私', 'は', '学校', 'に', '行きます')], forms: new Set<string>() }
  it('accepts the subject first in Japanese, and the reverse', () => {
    expect(gradeJapaneseSentence(JA_RULE, { ...ja, text: '私は今日は学校に行きます。' }).verdict).toBe('correct')
    expect(gradeJapaneseSentence(JA_RULE, { ...ja, text: '', placed: ['私', 'は', '今日', 'は', '学校', 'に', '行きます'] }).verdict).toBe('correct')
    const back = { accepted: ['私は今日学校に行きます。'], spelled: [tiles('私', 'は', '今日', '学校', 'に', '行きます')], forms: new Set<string>() }
    expect(gradeJapaneseSentence(JA_RULE, { ...back, text: '今日私は学校に行きます。' }).verdict).toBe('correct')
  })
  it('still catches a Japanese time word at the end', () => {
    expect(gradeJapaneseSentence(JA_RULE, { ...ja, text: '私は学校に行きます今日は。' }).verdict).toBe('diff')
  })
  const ko = { accepted: ['오늘 저는 학교에 가요.'], spelled: [tiles('오늘', '저', '는', '학교', '에', '가요')], forms: new Set<string>() }
  it('accepts the subject first in Korean', () => {
    expect(gradeJapaneseSentence(KO_RULE, { ...ko, text: '저는 오늘 학교에 가요.' }).verdict).toBe('correct')
  })
  it('still catches a Korean time word at the end', () => {
    expect(gradeJapaneseSentence(KO_RULE, { ...ko, text: '저는 학교에 가요 오늘.' }).verdict).toBe('diff')
  })
})
