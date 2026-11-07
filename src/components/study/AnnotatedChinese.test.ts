import { describe, expect, it } from 'vitest'
import { isPunctuation } from './AnnotatedChinese'

describe('isPunctuation', () => {
  it('recognises Chinese punctuation, not words', () => {
    for (const mark of ['，', '。', '？', '！', '、', '，。']) expect(isPunctuation(mark)).toBe(true)
    for (const word of ['谢谢', 'ok', '我']) expect(isPunctuation(word)).toBe(false)
  })
})
