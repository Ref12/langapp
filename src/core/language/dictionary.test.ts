// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, catalogCounts, type Catalog } from '../study/catalog'
import { getPack, jaPack, zhPack } from '.'
import type { CatalogUnit } from './dictionary'
import { makeMatcher } from '../dictionary-search'

let catalog: Catalog
beforeAll(async () => { setBuildLanguageForTests('ja'); catalog = await loadCatalog(); setBuildLanguageForTests(undefined); resetCatalogCache() })
afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

const units = () => [...catalog.units.values()] as CatalogUnit[]
const found = (query: string, kind: 'vocabulary' | 'grammar' = 'vocabulary') => {
  const search = jaPack.dictionary.searchUnits(query, jaPack.romaji)
  return units().filter(unit => unit.kind === kind && search.rank(unit) !== undefined).map(unit => unit.record.lb)
}

describe("the Japanese pack's Dictionary", () => {
  it('has the Vocabulary and Grammar sections only, and the Chinese pack all of them', () => {
    expect(jaPack.features.dictionary).toBe(true)
    expect(jaPack.dictionary.sections).toEqual({ characters: false, phrases: false, draw: false, media: false })
    expect(zhPack.dictionary.sections).toEqual({ characters: true, phrases: true, draw: true, media: true })
  })
  it('lists every word and grammar point of the pack catalog and nothing else', () => {
    const empty = jaPack.dictionary.searchUnits('')
    expect(empty.empty).toBe(true)
    const listed = units().filter(unit => empty.rank(unit) !== undefined)
    expect(listed.filter(unit => unit.kind === 'vocabulary')).toHaveLength(292)
    expect(listed.filter(unit => unit.kind === 'grammar')).toHaveLength(115)
    setBuildLanguageForTests('ja')
    expect(getPack().id).toBe('ja')
    expect(catalogCounts.vocabulary).toBe(292)
    expect(catalogCounts.grammar).toBe(115)
  })
  it('finds 食べる by kana, kanji, romaji, English and both of its forms', () => {
    for (const query of ['たべ', '食', 'taberu', 'eat', '食べます', '食べる', 'タベ', 'ＴＡＢＥＲＵ', ' Taberu ', 'tabemasu', 'たべます']) expect(found(query), query).toContain('taberu--eat')
  })
  it('ignores long-vowel marks in romaji', () => {
    for (const query of ['benkyou', 'benkyo', 'benkyō', 'BENKYOU', 'benkyousuru', 'benkyoushimasu']) expect(found(query), query).toContain('benkyousuru--study')
  })
  it('ranks an exact match before a partial one', () => {
    const search = jaPack.dictionary.searchUnits('taberu', jaPack.romaji)
    const eat = catalog.units.get('vocabulary:taberu--eat')! as CatalogUnit
    expect(search.rank(eat)).toBe(0)
    expect(jaPack.dictionary.searchUnits('tabe', jaPack.romaji).rank(eat)).toBe(1)
  })
  it('finds a grammar point by its pattern and its reading', () => {
    expect(found('desu', 'grammar')).toContain('n-desu--noun')
    expect(found('です', 'grammar')).toContain('n-desu--noun')
  })
  it('keeps the Chinese search exactly the plain matcher', () => {
    const unit = { kind: 'vocabulary', ref: 'vocabulary:x', band: '1', record: { id: 'x', ch: '你好', pr: 'nǐ hǎo', ds: 'hello', lb: 'x' } } as unknown as CatalogUnit
    for (const query of ['nihao', 'ni3hao3', '你', 'hello', 'zzz', '']) {
      const matcher = makeMatcher(query)
      expect(zhPack.dictionary.searchUnits(query).rank(unit)).toBe(matcher.empty ? 0 : matcher.rank({ text: ['你好'], pr: 'nǐ hǎo', ds: 'hello' }))
    }
  })
})
