import { afterEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { languageOfSet, setsOfCurrentLanguage } from './set-language'

describe('languageOfSet', () => {
  it('Chinese refs and sets with no refs are Chinese', () => {
    expect(languageOfSet({ refs: ['vocabulary:hello', 'grammar:a-b', 'phrase:x', 'source:y'] })).toBe('zh')
    expect(languageOfSet({ refs: [] })).toBe('zh')
  })
  it('Japanese refs', () => {
    expect(languageOfSet({ refs: ['ja:w:ja-n5-1', 'ja:g:wa'] })).toBe('ja')
    expect(languageOfSet({ refs: ['ja:f:くる:masu'] })).toBe('ja')
  })
  it('Korean refs', () => { expect(languageOfSet({ refs: ['ko:w:ko-1'] })).toBe('ko') })
})

describe('setsOfCurrentLanguage', () => {
  afterEach(() => setBuildLanguageForTests(undefined))
  const zh = { refs: ['vocabulary:a'] }, ja = { refs: ['ja:w:ja-n5-1'] }
  it('the Chinese build keeps its own sets whatever an old currentLanguage says', () => {
    expect(setsOfCurrentLanguage([zh, ja], {})).toEqual([zh])
    expect(setsOfCurrentLanguage([zh, ja], { currentLanguage: 'ja' })).toEqual([zh])
  })
  it('a one-language build keeps every set', () => {
    setBuildLanguageForTests('ja')
    expect(setsOfCurrentLanguage([zh, ja], {})).toEqual([zh, ja])
  })
})
