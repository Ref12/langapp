import { describe, expect, it } from 'vitest'
import { charReadings, lineUnits } from './readings'

const readings = new Map([['你', new Set(['nǐ'])], ['别', new Set(['bié'])], ['等', new Set(['děng'])]])

describe('per-character fallback', () => {
  it('reads each character of a run in context', () => {
    expect(charReadings('白眼狼')).toEqual(['bái', 'yǎn', 'láng'])
    expect(charReadings('等了')).toHaveLength(2)
  })
  it('gives every Han character outside the catalog its own reading and keeps punctuation plain', () => {
    const units = lineUnits('你就别等了。', readings)
    expect(units.map(unit => unit.text)).toEqual(['你', '就', '别', '等', '了', '。'])
    expect(units.filter(unit => /\p{Script=Han}/u.test(unit.text)).every(unit => !!unit.pinyin)).toBe(true)
    expect(units[0]).toMatchObject({ known: true, pinyin: 'nǐ' })
    expect(units[1]).toMatchObject({ known: false })
    expect(units[5]).toEqual({ text: '。', known: false })
  })
  it('never leaves a word such as 白眼狼 or 守寡 without readings', () => {
    for (const word of ['白眼狼', '守寡', '含辛茹苦', '撒手']) {
      const units = lineUnits(word, new Map())
      expect(units).toHaveLength(Array.from(word).length)
      expect(units.every(unit => !!unit.pinyin)).toBe(true)
    }
  })
})
