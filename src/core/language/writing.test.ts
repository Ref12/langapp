import { afterEach, describe, expect, it } from 'vitest'
import { characterAssetIndex } from '../characters/assets'
import { buildWritingRoute, hasGuide, isHan, neighbourIndex } from '../characters/writing-route'
import { guidedChars, introducedChars, newCharacters } from '../drills/write-queue'
import { setBuildLanguageForTests } from '../storage-names'
import { getPack } from './index'
import { jaPack, koPack, zhPack } from './packs'

afterEach(() => setBuildLanguageForTests(undefined))

// A sample with a guide-less Han character: 鱝 is in no set; 〇 is not Han script but is guided in neither.
const sample = Array.from('\u4e00\u5b66\u4eec\u8fd9\u9c1d\u3042A')
const chineseToday = (character: string) => characterAssetIndex.some(asset => asset.character === character)

describe('the Chinese pack writing entry', () => {
  const writing = zhPack.writing
  it('answers exactly what the bundled Chinese index says', () => {
    expect(writing.language).toBe('zh')
    for (const character of sample) {
      expect(writing.hasGuide(character)).toBe(chineseToday(character))
      expect(writing.strokeCount(character)).toBe(characterAssetIndex.find(asset => asset.character === character)?.strokeCount)
    }
    expect(writing.hasGuide('\u9c1d')).toBe(false)
    expect(writing.hasGuide('\u3042')).toBe(false)
    expect(writing.guideCharacters()).toHaveLength(characterAssetIndex.length)
  })
  it('takes the Han characters with a guide in a word, and introduces the same ones', () => {
    const word = '\u5b66\u9c1d\u4eec\u3042x'
    expect(writing.guidedChars(word)).toEqual(Array.from(word).filter(character => isHan(character) && chineseToday(character)))
    expect(writing.introducedChars(word)).toEqual(writing.guidedChars(word))
  })
  it('keeps the Chinese routes without a lang', () => {
    expect(buildWritingRoute('\u4e00', 'all', { word: '\u4e00\u4e8c' })).toBe('writing/4e00/all?word=%E4%B8%80%E4%BA%8C')
    expect(guidedChars('\u5b66\u751f')).toEqual(['\u5b66', '\u751f'])
  })
})

describe('the Japanese pack writing entry', () => {
  const writing = jaPack.writing
  it('has a guide for shared kanji, Japanese-only kanji and kana, from the Japanese index', () => {
    expect(writing.language).toBe('ja')
    for (const character of ['\u65e5', '\u50cd', '\u8fbc', '\u3042', '\u30a2']) expect(writing.hasGuide(character)).toBe(true)
    expect(writing.strokeCount('\u3042')).toBe(3)
    expect(writing.strokeCount('\u50cd')).toBe(13)
  })
  it('has no guide for a Chinese-only simplified form or for the accepted gap', () => {
    expect(writing.hasGuide('\u8fd9')).toBe(false)
    expect(writing.hasGuide('\u9c1d')).toBe(false)
    expect(writing.strokeCount('\u8fd9')).toBeUndefined()
  })
  it('writes every guided character of a word, kanji and kana', () => {
    expect(writing.guidedChars('\u98df\u3079\u307e\u3059')).toEqual(['\u98df', '\u3079', '\u307e', '\u3059'])
    expect(writing.guidedChars('\u9c1d\u3042x')).toEqual(['\u3042'])
  })
  it('introduces kanji only: one rule, kana are written but not taught', () => {
    expect(writing.introduces('\u65e5')).toBe(true)
    expect(writing.introduces('\u3042')).toBe(false)
    expect(writing.introduces('\u30a2')).toBe(false)
    expect(writing.introducedChars('\u98df\u3079\u307e\u3059')).toEqual(['\u98df'])
  })
  it('the queue, the routes and the neighbours follow the build language', () => {
    setBuildLanguageForTests('ja')
    expect(getPack().writing.language).toBe('ja')
    expect(hasGuide('\u50cd')).toBe(true)
    expect(hasGuide('\u8fd9')).toBe(false)
    expect(guidedChars('\u98df\u3079')).toEqual(['\u98df', '\u3079'])
    expect(introducedChars('\u98df\u3079')).toEqual(['\u98df'])
    expect(newCharacters(['\u98df\u3079\u307e\u3059'], [])).toEqual(['\u98df'])
    expect(buildWritingRoute('\u98df', 'all')).toBe('writing/98df/all?lang=ja')
    expect(neighbourIndex(Array.from('\u98df\u3079'), 0, 1)).toBe(1)
  })
})

describe('the Korean pack writing entry', () => {
  const writing = koPack.writing
  it('uses its own index for Hangul', () => {
    expect(writing.language).toBe('ko')
    const [first] = writing.guideCharacters()
    expect(writing.hasGuide(first)).toBe(true)
    expect(writing.introduces(first)).toBe(true)
    expect(writing.hasGuide('\u65e5')).toBe(false)
    expect(writing.hasGuide('.')).toBe(false)
  })
})
