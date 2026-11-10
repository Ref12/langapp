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

describe("the Japanese pack's look-up words", () => {
  const catalogIds = () => new Set(units().map(unit => unit.record.id))
  const loadLookup = () => jaPack.dictionary.lookup!.load(id => catalogIds().has(id))
  const wordOf = (source: Awaited<ReturnType<typeof loadLookup>>, id: string) => source.words.find(word => word.id === id)!

  it('lists exactly the entries of the JLPT file that are not in the catalog', async () => {
    const source = await loadLookup()
    const all = await (await import('../dictionary/other')).loadDictionary('ja')
    expect(all.words).toHaveLength(7890)
    expect(source.words).toHaveLength(7598)
    expect(source.words.map(word => word.id).sort()).toEqual(all.words.filter(word => !catalogIds().has(word.id)).map(word => word.id).sort())
    expect(source.grammar.map(item => item.id).sort()).toEqual(['ja-par-g024', 'ja-par-g036'])
  })
  it('never lists a lesson word, and no word twice', async () => {
    const source = await loadLookup()
    const ids = source.words.map(word => word.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => catalogIds().has(id))).toEqual([])
    expect(source.grammar.filter(item => catalogIds().has(item.id))).toEqual([])
  })
  it('finds a look-up word by kana, kanji, romaji (long vowels ignored) and English', async () => {
    const source = await loadLookup()
    const lookup = source
    const word = source.words.find(item => item.form === '東京' ) ?? source.words.find(item => /^[\u4e00-\u9fff]{2}$/.test(item.form) && /^[\u3040-\u309f]+$/.test(item.reading))!
    const english = word.meaning.split(/ \| |; /)[0].replace(/\(.*?\)/g, '').trim().toLowerCase()
    const romaji = (await import('../reading/romaji')).kanaToRomaji(word.reading, jaPack.romaji)
    for (const query of [word.reading, word.form, romaji, romaji.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ou/g, 'o'), english]) {
      expect(lookup.search(query, jaPack.romaji).word(wordOf(source, word.id)), query).not.toBeUndefined()
    }
    expect(lookup.search('', jaPack.romaji).empty).toBe(true)
    expect(lookup.search('zzzzqqq', jaPack.romaji).word(word)).toBeUndefined()
  })
  it('scores a lesson word and a look-up word on one scale, so equal quality is a tie the page settles for the lesson word', async () => {
    const source = await loadLookup()
    const lesson = jaPack.dictionary.searchUnits('eat', jaPack.romaji).rank(catalog.units.get('vocabulary:taberu--eat')! as CatalogUnit)
    const lookupSearch = source.search('eat', jaPack.romaji)
    expect(lesson).toBe(2)
    expect(source.words.some(word => lookupSearch.word(word) === lesson)).toBe(true)
  })
  it('has no look-up source in the Chinese pack', () => {
    expect(zhPack.dictionary.lookup).toBeUndefined()
    expect(jaPack.dictionary.lookup).toBeDefined()
  })
  it('names its sources in the footnote, in one line', () => {
    expect(jaPack.dictionary.footnote).toMatch(/JMdict\/EDICT/)
    expect(jaPack.dictionary.footnote).toMatch(/Electronic Dictionary Research and Development Group/)
    expect(jaPack.dictionary.footnote).toMatch(/Jonathan Waller/)
    expect(jaPack.dictionary.footnote).not.toContain('\n')
  })
})
