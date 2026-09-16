import { describe, expect, it } from 'vitest'
import { alignAssessmentWords } from './alignment'
import type { AssessmentWord } from './contracts'

const word = (text: string): AssessmentWord => ({
  text, accuracy: 85, errorType: 'None', phonemes: [{ text: 'sound', accuracy: 82 }],
})

describe('continuous assessment text alignment', () => {
  it('finds omissions and insertions without inventing omission scores', () => {
    expect(alignAssessmentWords('Please say hello now', [word('please'), word('hello'), word('today')], 'en-US')).toEqual([
      word('please'), { text: 'say', errorType: 'Omission' }, word('hello'),
      { text: 'now', errorType: 'Omission' }, { ...word('today'), errorType: 'Insertion' },
    ])
  })
  it('normalizes case, width, apostrophes and punctuation without changing acoustic detail', () => {
    const words = [word("don't"), { ...word('stop'), errorType: 'Mispronunciation' }]
    expect(alignAssessmentWords('ＤＯＮ’T, stop!', words, 'en-US')).toEqual(words)
  })
  it('aligns repeated words in order', () => {
    expect(alignAssessmentWords('go go home', [word('go'), word('home'), word('go')], 'en-US')).toEqual([
      word('go'), { text: 'go', errorType: 'Omission' }, word('home'), { ...word('go'), errorType: 'Insertion' },
    ])
  })
  it.each([
    ['zh-CN', '我喜欢喝茶。', ['我', '喜欢', '茶', '啊'], '喝', '啊'],
    ['ja-JP', '私はコーヒーを飲みます。', ['私', 'コーヒー', 'を', '飲みます', 'ね'], 'は', 'ね'],
    ['ko-KR', '저는 매일 차를 마셔요.', ['저는', '차를', '마셔요', '정말'], '매일', '정말'],
  ] as const)('handles %s boundaries and punctuation', (locale, reference, recognized, omitted, inserted) => {
    const words = recognized.map(word)
    const result = alignAssessmentWords(reference, words, locale)!
    expect(result).toContainEqual({ text: omitted, errorType: 'Omission' })
    expect(result).toContainEqual({ ...word(inserted), errorType: 'Insertion' })
    for (const value of words.slice(0, -1)) expect(result).toContainEqual(value)
  })
  it('does not assign whole-word measurements to split Chinese characters', () => {
    expect(alignAssessmentWords('我喝茶', [word('我'), word('喝绿茶')], 'zh-CN')).toEqual([
      word('我'), { text: '喝' }, { text: '绿', errorType: 'Insertion' }, { text: '茶' },
    ])
  })
  it('handles different Japanese provider word boundaries and embedded Latin text', () => {
    const words = [word('私は'), word('Azure'), word('です')]
    expect(alignAssessmentWords('私はAzureです。', words, 'ja-JP')).toEqual(words)
  })
  it('does not manufacture omissions from empty or excessive input', () => {
    expect(alignAssessmentWords('reference', [], 'en-US')).toBeUndefined()
    expect(alignAssessmentWords('!?', [word('hi')], 'en-US')).toBeUndefined()
    expect(alignAssessmentWords('字'.repeat(5000), [word('字'.repeat(5000))], 'zh-CN')).toBeUndefined()
  })
})
