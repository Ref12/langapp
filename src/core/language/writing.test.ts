import { afterEach, describe, expect, it } from 'vitest'
import { characterAssetIndex } from '../characters/assets'
import { buildWritingRoute, hasGuide, isHan, isWritable, neighbourIndex } from '../characters/writing-route'
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
  it('has a guide for every dictionary syllable it was extended to (득, 흙, 쌍), and still for 학 and 생', () => {
    for (const character of ['\ub4dd', '\ud759', '\uc30d', '\ud559', '\uc0dd']) expect(writing.hasGuide(character)).toBe(true)
    expect(writing.strokeCount('\ud759')).toBe(8)
  })
  it('names its voice and its script, so no screen tests the language', () => {
    expect(writing.speechLocale).toBe('ko-KR')
    expect(jaPack.writing.speechLocale).toBe('ja-JP')
    expect(zhPack.writing.speechLocale).toBe('zh-Hans')
    expect(writing.writes('\ud55c')).toBe(true)
    expect(writing.writes('\u65e5')).toBe(false)
    expect(isWritable('\ud55c', 'ko')).toBe(true)
    expect(isWritable('\u3042', 'ja')).toBe(true)
    expect(isWritable('\u3042', 'ko')).toBe(false)
  })
  it('lists the letters first (24 basic, then doubled and combined), then the syllables by their first letter', () => {
    const groups = writing.listGroups()
    expect(groups.slice(0, 2).map(group => group.characters.join(''))).toEqual(['\u3131\u3134\u3137\u3139\u3141\u3142\u3145\u3147\u3148\u314a\u314b\u314c\u314d\u314e', '\u314f\u3151\u3153\u3155\u3157\u315b\u315c\u3160\u3161\u3163'])
    expect(groups[0].characters.length + groups[1].characters.length).toBe(24)
    expect(groups.slice(2, 4).map(group => group.id)).toEqual(['doubled-consonants', 'combined-vowels'])
    const firstSyllable = groups.findIndex(group => group.id.startsWith('syllables-'))
    expect(firstSyllable).toBeGreaterThanOrEqual(4)
    expect(groups.slice(0, firstSyllable).flatMap(group => group.characters).every(character => !isSyllableOf(character))).toBe(true)
    expect(groups.slice(firstSyllable).flatMap(group => group.characters).every(isSyllableOf)).toBe(true)
    expect(groups.flatMap(group => group.characters).filter(isSyllableOf).length).toBeGreaterThanOrEqual(1069)
  })
  it('breaks a syllable into its letters, with a final only when there is one', () => {
    expect(writing.breakdown('\ud559')).toEqual(['\u314e', '\u314f', '\u3131'])
    expect(writing.breakdown('\uac00')).toEqual(['\u3131', '\u314f'])
    expect(writing.breakdown('\ud759')).toEqual(['\u314e', '\u3161', '\u313a'])
    expect(writing.breakdown('\u3131')).toBeUndefined()
    expect(jaPack.writing.breakdown('\u3042')).toBeUndefined()
    expect(jaPack.writing.listGroups()).toEqual([])
  })
})
const isSyllableOf = (character: string) => character >= '\uac00' && character <= '\ud7a3'
