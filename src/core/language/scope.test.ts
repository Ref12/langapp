import { afterEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { languageInUse, languageOfRefs, rowsOfCurrentLanguage } from './scope'

describe('languageOfRefs', () => {
  it('unmarked refs and no refs are Chinese', () => {
    expect(languageOfRefs(['vocabulary:a', 'grammar:b', 'phrase:c', 'source:d'])).toBe('zh')
    expect(languageOfRefs([])).toBe('zh')
  })
  it('Japanese and Korean marks', () => {
    expect(languageOfRefs(['ja:w:ja-n5-1'])).toBe('ja')
    expect(languageOfRefs(['vocabulary:a', 'ja:g:wa'])).toBe('ja')
    expect(languageOfRefs(['ja:f:くる:masu'])).toBe('ja')
    expect(languageOfRefs(['ko:g:x'])).toBe('ko')
  })
})

describe('rowsOfCurrentLanguage', () => {
  afterEach(() => setBuildLanguageForTests(undefined))
  const zh = { refs: ['vocabulary:a'] }, ja = { refs: ['ja:w:ja-n5-1'] }, ko = { refs: ['ko:w:ko-1'] }, bare = { refs: [] as string[] }
  const all = [zh, ja, ko, bare]
  const refs = (row: { refs: string[] }) => row.refs
  it('the Chinese build keeps the Chinese rows whatever an old currentLanguage says', () => {
    expect(rowsOfCurrentLanguage(all, refs, {})).toEqual([zh, bare])
    expect(rowsOfCurrentLanguage(all, refs, { currentLanguage: 'ja' })).toEqual([zh, bare])
    expect(rowsOfCurrentLanguage(all, refs, { currentLanguage: 'ko' })).toEqual([zh, bare])
  })
  it('a one-language build filters nothing', () => {
    setBuildLanguageForTests('ja')
    expect(rowsOfCurrentLanguage(all, refs, {})).toEqual(all)
    expect(rowsOfCurrentLanguage(all, refs, { currentLanguage: 'ko' })).toEqual(all)
  })
})

describe('languageInUse', () => {
  afterEach(() => setBuildLanguageForTests(undefined))
  it('is always the build language; an old currentLanguage preference chooses nothing', () => {
    expect(languageInUse({})).toBe('zh')
    expect(languageInUse({ currentLanguage: 'ko' })).toBe('zh')
    setBuildLanguageForTests('ja')
    expect(languageInUse({ currentLanguage: 'ko' })).toBe('ja')
    setBuildLanguageForTests('ko')
    expect(languageInUse({})).toBe('ko')
  })
})
