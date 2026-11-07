import { describe, expect, it } from 'vitest'
import { phraseCharReadings, phrasePinyin } from './phrase'

const readings = new Map([
  ['谢谢', 'xiè xie'], ['你们', 'nǐ men'], ['你', 'nǐ'], ['学生', 'xué sheng'], ['没关系', 'méi guān xi'],
  ['不', 'bù'], ['客气', 'kè qi'], ['一', 'yī'], ['点', 'diǎn'], ['儿', 'ér'], ['个', 'gè'], ['女儿', 'nǚ ér'], ['好', 'hǎo'],
  ['第', 'dì'],
])

describe('phrasePinyin', () => {
  it('keeps neutral tones from the catalog', () => {
    expect(phrasePinyin('谢谢你们', readings)).toBe('xiè xie nǐ men')
    expect(phrasePinyin('学生', readings)).toBe('xué sheng')
    expect(phrasePinyin('没关系', readings)).toBe('méi guān xi')
  })
  it('changes 一 and 不 by the next syllable, across words', () => {
    expect(phrasePinyin('不客气', readings)).toBe('bú kè qi')
    expect(phrasePinyin('一点儿', readings)).toBe('yì diǎnr')
    expect(phrasePinyin('一个', readings)).toBe('yí gè')
    expect(phrasePinyin('不好', readings)).toBe('bù hǎo')
    expect(phrasePinyin('第一个', readings)).toBe('dì yī gè')
  })
  it('joins 儿 to the syllable before it, except in 女儿', () => {
    expect(phrasePinyin('点儿', readings)).toBe('diǎnr')
    expect(phrasePinyin('女儿', readings)).toBe('nǚ ér')
  })
  it('drops punctuation and capitals', () => {
    expect(phrasePinyin('谢谢，你！', readings)).toBe('xiè xie nǐ')
  })
  it('falls back to pinyin-pro for the uncovered span only', () => {
    expect(phrasePinyin('谢谢你好龙', readings)).toBe('xiè xie nǐ hǎo lóng')
    const items = phraseCharReadings('谢谢龙', readings)
    expect(items.map(item => item.covered)).toEqual([true, true, false])
    expect(items[0]).toMatchObject({ wordLength: 2 })
  })
  it('reads text the catalog does not cover at all', () => {
    expect(phrasePinyin('龙', new Map())).toBe('lóng')
    expect(phrasePinyin('abc', new Map())).toBe('')
  })
})
