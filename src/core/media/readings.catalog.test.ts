import { describe, expect, it } from 'vitest'
import { lineUnits } from './readings'

describe('line readings use catalog tones across words', () => {
  const readings = new Map([['谢谢', new Set(['xiè xie'])], ['不', new Set(['bù'])], ['客气', new Set(['kè qi'])]])
  it('keeps the neutral tone of a word and changes 不 before a fourth tone', () => {
    const units = lineUnits('谢谢，不客气', readings)
    expect(units.filter(unit => unit.pinyin).map(unit => [unit.text, unit.pinyin])).toEqual([['谢谢', 'xiè xie'], ['不', 'bú'], ['客气', 'kè qi']])
  })
})
