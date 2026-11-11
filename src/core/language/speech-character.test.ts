// @vitest-environment node
// What the pack says for one character of the writing views (kind 'character'): Japanese from its reading in the word, Chinese and Korean unchanged.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPack } from '.'
import { noteJapaneseReadings, resetJapaneseReadings } from './speech-text'
import { setBuildLanguageForTests } from '../storage-names'
import { setKanjiReadings, type KanjiReadingTable } from './japanese-alignment'
import table from '../../data/packs/ja/kanji-readings.generated.json'

const say = (text: string, hint?: Parameters<ReturnType<typeof getPack>['speechText']>[1]) => getPack().speechText(text, { kind: 'character', ...hint })
beforeEach(() => { setBuildLanguageForTests('ja'); resetJapaneseReadings(); setKanjiReadings(table.kanji as unknown as KanjiReadingTable) })
afterEach(() => { setBuildLanguageForTests(undefined); resetJapaneseReadings(); setKanjiReadings(undefined) })

describe('Japanese: a character in the word being practised', () => {
  it('speaks the reading of the character within the word', () => {
    expect(say('学', { within: { text: '学生', reading: 'がくせい' } })).toBe('がく')
    expect(say('生', { within: { text: '学生', reading: 'がくせい' } })).toBe('せい')
    expect(say('食', { within: { text: '食べる', reading: 'たべる' } })).toBe('た')
  })
  it('speaks the whole word in kana when the alignment is uncertain', () => {
    expect(say('今', { within: { text: '今日', reading: 'きょう' } })).toBe('きょう')
    expect(say('大', { within: { text: '大人', reading: 'おとな' } })).toBe('おとな')
    expect(say('一', { within: { text: '一人', reading: 'ひとり' } })).toBe('ひとり')
  })
  it('takes the word\'s reading from what the pack knows when the caller has none', () => {
    noteJapaneseReadings('catalog', [['学生', 'がくせい']])
    expect(say('学', { within: { text: '学生' } })).toBe('がく')
  })
  it('a character that is the word itself says the word\'s reading', () => {
    expect(say('日', { within: { text: '日', reading: 'ひ' } })).toBe('ひ')
  })
  it('says kana as themselves, は included', () => {
    expect(say('は')).toBe('は')
    expect(say('へ', { within: { text: 'はは', reading: 'はは' } })).toBe('へ')
    expect(say('ア')).toBe('ア')
  })
})

describe('Japanese: no word known', () => {
  const lesson = [{ text: '今日', reading: 'きょう' }, { text: '学校', reading: 'がっこう' }, { text: '日本', reading: 'にほん' }]
  it('uses the first lesson word the character can be aligned in', () => {
    expect(say('学', { lesson })).toBe('がっ')
    expect(say('校', { lesson })).toBe('こう')
  })
  it('is the table\'s first on\'yomi when no lesson word reads it and the kanji is no word on its own', () => {
    expect(say('今', { lesson })).toBe('こん')
    expect(say('山', { lesson })).toBe('さん')
    expect(say('山')).toBe('さん')
  })
  it('is the table\'s first kun\'yomi when the kanji is a word on its own in the data', () => {
    noteJapaneseReadings('catalog', [['山', 'やま']])
    expect(say('山')).toBe('やま')
  })
  it('says the kanji of 中国語 with its own reading, with the word or without', () => {
    const within = { text: '中国語', reading: 'ちゅうごくご' }
    expect([say('中', { within }), say('国', { within }), say('語', { within })]).toEqual(['ちゅう', 'ごく', 'ご'])
    expect(say('中', { lesson: [within] })).toBe('ちゅう')
  })
  it('a word without a known reading falls through to the lesson words', () => {
    expect(say('学', { within: { text: '学ぶ?' }, lesson })).toBe('がっ')
  })
})

describe('Chinese and Korean speech is unchanged', () => {
  it('returns the character as it is, with or without a word', () => {
    setBuildLanguageForTests('zh')
    expect(say('学', { within: { text: '学生', reading: 'xué shēng' }, lesson: [{ text: '学校', reading: 'xué xiào' }] })).toBe('学')
    expect(getPack().speechText('学', { kind: 'word' })).toBe('学')
    setBuildLanguageForTests('ko')
    expect(say('가', { within: { text: '가다', reading: 'gada' } })).toBe('가')
    expect(getPack().speechText('학교', { kind: 'word' })).toBe('학교')
  })
})
