// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { AREAS, areaOfRoute, getPack, isAreaOn, jaPack, koPack, packFor, zhPack, buildDisplayName } from './index'
import { labApps } from './apps'
import { setBuildLanguageForTests } from '../storage-names'

afterEach(() => setBuildLanguageForTests(undefined))

describe('language packs', () => {
  it('builds as Chinese by default and follows the build language', () => {
    expect(getPack()).toBe(zhPack)
    setBuildLanguageForTests('ja')
    expect(getPack()).toBe(jaPack)
    setBuildLanguageForTests('ko')
    expect(getPack()).toBe(koPack)
  })

  it('names the languages', () => {
    expect([zhPack, jaPack, koPack].map(pack => [pack.id, pack.name, pack.nativeName])).toEqual([['zh', 'Chinese', '\u4E2D\u6587'], ['ja', 'Japanese', '\u65E5\u672C\u8A9E'], ['ko', 'Korean', '\uD55C\uAD6D\uC5B4']])
    expect(buildDisplayName('lab', jaPack)).toBe('LinguaWeave Lab Japanese')
    expect(buildDisplayName('lab', zhPack)).toBe('LinguaWeave Lab')
    expect(buildDisplayName('stable', zhPack)).toBe('LinguaWeave')
    expect(() => packFor('xx' as never)).toThrow(/Unknown language/)
  })

  it('switches everything on for Chinese, the Dictionary and writing for Japanese and writing for Korean', () => {
    expect(AREAS.every(area => zhPack.features[area])).toBe(true)
    expect(AREAS.filter(area => koPack.features[area])).toEqual(['writing'])
    // Japanese: the Dictionary (of the lessons) and the writing area (its own stroke data); everything else stays off.
    expect(AREAS.filter(area => jaPack.features[area])).toEqual(['dictionary', 'writing'])
    expect(jaPack.features.games).toBe(false)
  })

  it('lists Chinese, Japanese and Korean as the published Lab apps', () => {
    expect(labApps().map(app => app.id)).toEqual(['zh', 'ja', 'ko'])
    expect(koPack.published).toBe(true)
  })

  it('maps routes to areas, and leaves Lessons, Practice, Overview and Settings always on', () => {
    const expected: Record<string, string | undefined> = {
      overview: undefined, lessons: undefined, 'lessons/list': undefined, 'lessons/group/g1': undefined, 'lessons/ja/3': undefined, practice: undefined, 'practice/set/abc': undefined, settings: undefined,
      library: 'library', 'book/b1': 'library', 'reader/r1': 'library', media: 'media', 'media/x': 'media', collections: 'collections', 'collections/c': 'collections',
      games: 'games', 'games/sudoku': 'games', 'practice/mahjong': 'games', conversation: 'assistant', 'conversation/t1': 'assistant', history: 'history', 'history?q=1': 'history',
      dictionary: 'dictionary', 'dictionary/words?q=x': 'dictionary', writing: 'writing', 'writing/4e00': 'writing', 'practice/handsfree/r1': 'handsFree',
      curriculum: 'wordLists', 'level/hsk1': 'wordLists', 'lesson/l1': 'wordLists', review: 'wordLists', 'practice/s1': 'wordLists', nonsense: undefined,
    }
    for (const [route, area] of Object.entries(expected)) expect(areaOfRoute(route), route).toBe(area)
    expect(new Set(Object.values(expected).filter(Boolean))).toEqual(new Set(AREAS))
    expect(isAreaOn(jaPack, undefined)).toBe(true)
    expect(isAreaOn(jaPack, 'games')).toBe(false)
    expect(isAreaOn(zhPack, 'games')).toBe(true)
  })
})
