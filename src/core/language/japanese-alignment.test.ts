// @vitest-environment node
// The per-character alignment of a word's kana to its kanji (japanese-alignment.ts): regular words, okurigana, and the irregular readings it will not guess.
import { describe, expect, it } from 'vitest'
import { alignWordReading, characterReadingIn, kanaSounds } from './japanese-alignment'

describe('alignWordReading', () => {
  it('splits a regular two-kanji word into its two sounds each', () => {
    expect(alignWordReading('学生', 'がくせい')).toEqual(['がく', 'せい'])
    expect(alignWordReading('学校', 'がっこう')).toEqual(['がっ', 'こう'])
    expect(alignWordReading('勉強', 'べんきょう')).toEqual(['べん', 'きょう'])
    expect(alignWordReading('先生', 'せんせい')).toEqual(['せん', 'せい'])
  })
  it('matches okurigana literally, hiragana and katakana alike', () => {
    expect(alignWordReading('食べる', 'たべる')).toEqual(['た', 'べ', 'る'])
    expect(alignWordReading('行く', 'いく')).toEqual(['い', 'く'])
    expect(alignWordReading('大きい', 'おおきい')).toEqual(['おお', 'き', 'い'])
    expect(alignWordReading('見つける', 'みつける')).toEqual(['み', 'つ', 'け', 'る'])
    expect(alignWordReading('食べ物', 'たべもの')?.[0]).toBe('た')
    expect(alignWordReading('食べる', 'タベル')).toEqual(['た', 'べ', 'る'])
  })
  it('gives a lone kanji the whole reading', () => {
    expect(alignWordReading('私', 'わたし')).toEqual(['わたし'])
    expect(alignWordReading('日', 'ひ')).toEqual(['ひ'])
  })
  it('does not guess the irregular readings', () => {
    for (const [word, reading] of [['今日', 'きょう'], ['大人', 'おとな'], ['一人', 'ひとり'], ['上手', 'じょうず'], ['明日', 'あした'], ['大丈夫', 'だいじょうぶ'], ['下手', 'へた']] as const)
      expect(alignWordReading(word, reading), word).toBeUndefined()
  })
  it('is uncertain when the reading does not fit the text, or the text has other characters', () => {
    expect(alignWordReading('食べる', 'のむ')).toBeUndefined()
    expect(alignWordReading('A学', 'がく')).toBeUndefined()
    expect(alignWordReading('学生', '')).toBeUndefined()
  })
})

describe('characterReadingIn', () => {
  it('reads one character of a word', () => {
    expect(characterReadingIn('学', '学生', 'がくせい')).toBe('がく')
    expect(characterReadingIn('生', '学生', 'がくせい')).toBe('せい')
    expect(characterReadingIn('食', '食べる', 'たべる')).toBe('た')
  })
  it('is undefined for an irregular word, a character the word lacks, or one read two ways in it', () => {
    expect(characterReadingIn('今', '今日', 'きょう')).toBeUndefined()
    expect(characterReadingIn('山', '学生', 'がくせい')).toBeUndefined()
    expect(characterReadingIn('日', '日日', 'にちにち')).toBe('にち')
    expect(characterReadingIn('日', '日日', 'ひにち')).toBeUndefined()
  })
})

describe('kanaSounds', () => {
  it('counts a small kana, a sokuon, ん and ー with the sound they belong to', () => {
    expect(kanaSounds('きょう')).toEqual(['きょ', 'う'])
    expect(kanaSounds('がっこう')).toEqual(['が', 'っ', 'こ', 'う'])
    expect(kanaSounds('べんきょう')).toHaveLength(4)
  })
})
