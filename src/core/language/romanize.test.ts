import { describe, expect, it } from 'vitest'
import { readingFor, romanizeJapanese, romanizeKorean, toKatakana } from './romanize'

describe('romanization', () => {
  it('Hepburn romaji', () => {
    expect(romanizeJapanese('がくせい')).toBe('gakusei')
    expect(romanizeJapanese('きょう')).toBe('kyou')
    expect(romanizeJapanese('ちゃ')).toBe('cha')
    expect(romanizeJapanese('ざっし')).toBe('zasshi')
    expect(romanizeJapanese('まっちゃ')).toBe('matcha')
    expect(romanizeJapanese('コーヒー')).toBe('koohii')
    expect(romanizeJapanese('ファイル')).toBe('fairu')
  })
  it('Revised Romanization', () => {
    expect(romanizeKorean('학생')).toBe('haksaeng')
    expect(romanizeKorean('공부해요')).toBe('gongbuhaeyo')
  })
  it('the pinyin slot: romaji or kana, katakana kept for katakana words', () => {
    expect(readingFor('ja', '学生', 'がくせい', 'romaji')).toBe('gakusei')
    expect(readingFor('ja', '学生', 'がくせい', 'kana')).toBe('がくせい')
    expect(readingFor('ja', 'コーヒー', undefined, 'kana')).toBe('コーヒー')
    expect(readingFor('ja', 'コーヒー', 'こーひー', 'kana')).toBe('コーヒー')
    expect(readingFor('ja', 'です', undefined, 'romaji')).toBe('desu')
    expect(readingFor('ja', '。', undefined, 'romaji')).toBeUndefined()
    expect(readingFor('ko', '학생', undefined, 'romaji')).toBe('haksaeng')
    expect(toKatakana('がくせい')).toBe('ガクセイ')
  })
})
