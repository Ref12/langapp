import { describe, expect, it } from 'vitest'
import { grade, needsConfirm, toneOnly, type Q } from './tasks'

const q = { key: 'pinyin-a', type: 'pinyin', refs: ['a'], data: { t: 'pinyin', item: { ref: 'a', kind: 'vocabulary', zh: '学习', py: 'xué xí', en: 'to study' } } } as unknown as Q
const marks = (typed: string, hinted = false) => { const result = grade(q, { text: typed, hinted }); return result === 'self' ? 'self' : result.marks.a }

describe('Say the pinyin grading', () => {
  it('accepts numbers or marks, spaces optional, any case, and neutral tones', () => {
    for (const typed of ['xue2 xi2', 'xue2xi2', 'xué xí', 'XUE2 XI2']) expect(marks(typed), typed).toBe('got')
  })
  it('right letters with missing or wrong tones are Needed a hint, decided at once and never self-marked', () => {
    expect(marks('xue xi')).toBe('hint'); expect(marks('xue2 xi4')).toBe('hint')
    expect(toneOnly(q, { text: 'xue xi' })).toBe(true)
    expect(toneOnly(q, { text: 'xue2 xi2' })).toBe(false)
    expect(toneOnly(q, { text: 'xie xi' })).toBe(false)
    expect(needsConfirm(q)).toBe(true)
  })
  it('different letters are missed (the learner still confirms)', () => { expect(marks('xie2 xi2')).toBe('missed') })
  it('a hint used turns a right answer into Needed a hint', () => { expect(marks('xue2 xi2', true)).toBe('hint') })
})
