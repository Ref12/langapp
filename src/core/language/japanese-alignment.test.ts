// @vitest-environment node
// The per-character alignment of a word's kana to its kanji (japanese-alignment.ts): regular words, okurigana, and the irregular readings it will not guess.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import band from '../../data/packs/ja/band-1.generated.json'
import table from '../../data/packs/ja/kanji-readings.generated.json'
import strokes from '../../../public/characters/japanese/index.generated.json'
import { alignWordReading, characterReadingIn, kanaSounds, setKanjiReadings, type KanjiReadingTable } from './japanese-alignment'

beforeAll(() => setKanjiReadings(table.kanji as unknown as KanjiReadingTable))
afterAll(() => setKanjiReadings(undefined))

describe('the kanji reading table', () => {
  it('has an entry for every kanji with stroke data', () => {
    const kanji = Object.keys(strokes.characters).filter(char => /\p{Script=Han}/u.test(char) && char !== '\u3005' && char !== '\u3007')
    const entries = table.kanji as Record<string, string[][]>
    expect(kanji.length).toBeGreaterThan(2000)
    expect(kanji.filter(char => !(char in entries))).toEqual([])
    expect(kanji.filter(char => !entries[char][0].length && !entries[char][1].length)).toEqual([])
  })
})

describe('alignment with the table', () => {
  it('splits words by each kanji\'s own readings, with rendaku and gemination', () => {
    expect(alignWordReading('中国語', 'ちゅうごくご')).toEqual(['ちゅう', 'ごく', 'ご'])
    expect(alignWordReading('学生', 'がくせい')).toEqual(['がく', 'せい'])
    expect(alignWordReading('学校', 'がっこう')).toEqual(['がっ', 'こう'])
    expect(alignWordReading('日本語', 'にほんご')).toEqual(['に', 'ほん', 'ご'])
    expect(alignWordReading('一日', 'いちにち')).toEqual(['いち', 'にち'])
    expect(alignWordReading('食べる', 'たべる')).toEqual(['た', 'べ', 'る'])
    expect(alignWordReading('大学', 'だいがく')).toEqual(['だい', 'がく'])
    expect(alignWordReading('東京', 'とうきょう')).toEqual(['とう', 'きょう'])
  })
  it('keeps the whole word for jukujikun', () => {
    for (const [word, reading] of [['今日', 'きょう'], ['大人', 'おとな'], ['一人', 'ひとり'], ['明日', 'あした'], ['上手', 'じょうず'], ['下手', 'へた']] as const) expect(alignWordReading(word, reading), word).toBeUndefined()
  })
  it('reports how many of the lesson words with kanji split with certainty', () => {
    const words = (band as { vocabulary: { ch: string; pr: string }[] }).vocabulary.filter(word => /\p{Script=Han}/u.test(word.ch))
    const certain = words.filter(word => alignWordReading(word.ch, word.pr)).length
    console.log('lesson words with kanji: ' + words.length + ', certain split now: ' + certain + ' (before the table: 175)')
    expect(certain).toBeGreaterThanOrEqual(220)
  })
})

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
    for (const [word, reading] of [['今日', 'きょう'], ['大人', 'おとな'], ['一人', 'ひとり'], ['上手', 'じょうず'], ['明日', 'あした'], ['下手', 'へた']] as const)
      expect(alignWordReading(word, reading), word).toBeUndefined()
  })
  it('reads a regular on\'yomi word of uneven sounds from the table', () => {
    expect(alignWordReading('大丈夫', 'だいじょうぶ')).toEqual(['だい', 'じょう', 'ぶ'])
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
