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
  it('Revised Romanization with the sound changes (the table is in korean-reading.test.ts)', () => {
    expect(romanizeKorean('학생')).toBe('haksaeng')
    expect(romanizeKorean('공부해요')).toBe('gongbuhaeyo')
    expect(romanizeKorean('감사합니다')).toBe('gamsahamnida')
    expect(romanizeKorean('좋아요')).toBe('joayo')
    expect(romanizeKorean('읽어요')).toBe('ilgeoyo')
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
