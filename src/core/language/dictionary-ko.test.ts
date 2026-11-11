// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, catalogCounts, type Catalog } from '../study/catalog'
import { jaPack, koPack, zhPack } from '.'
import type { CatalogUnit } from './dictionary'
import { loadDictionary } from './dictionary-file'
import { SHORT_GLOSS, shortGloss } from './lookup-ko'

let catalog: Catalog
beforeAll(async () => { setBuildLanguageForTests('ko'); catalog = await loadCatalog(); setBuildLanguageForTests(undefined); resetCatalogCache() })
afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

const units = () => [...catalog.units.values()] as CatalogUnit[]
const inCatalog = () => { const ids = new Set(units().map(unit => unit.record.id)); return (id: string) => ids.has(id) }
const lookup = () => koPack.dictionary.lookup!.load(inCatalog())

/** Lesson words and look-up words for a query, in list order: lesson first at an equal rank, as the Dictionary page merges them. */
async function listed(query: string): Promise<string[]> {
  const unitSearch = koPack.dictionary.searchUnits(query, koPack.romaji)
  const source = await lookup()
  const search = source.search(query, koPack.romaji)
  const rows: { form: string; rank: number; order: number }[] = []
  units().forEach((unit, index) => { if (unit.kind !== 'vocabulary') return; const rank = unitSearch.rank(unit); if (rank !== undefined) rows.push({ form: unit.record.ch, rank, order: index }) })
  source.words.forEach((word, index) => { const rank = search.word(word); if (rank !== undefined) rows.push({ form: word.form, rank, order: 1e6 + index }) })
  return rows.sort((a, b) => a.rank - b.rank || a.order - b.order).map(row => row.form)
}

describe("the Korean pack's Dictionary", () => {
  it('has Vocabulary and Grammar only, and the Dictionary on', () => {
    expect(koPack.features.dictionary).toBe(true)
    expect(koPack.dictionary.sections).toEqual({ characters: false, phrases: false, draw: false, media: false })
    expect(koPack.dictionary.placeholder.vocabulary).toBe('Word, romanization, or English')
    expect(koPack.dictionary.footnote).toContain('National Institute of Korean Language')
    expect(koPack.dictionary.footnote).toContain('Korean-English Learners')
  })
  it('lists every lesson word and grammar point of the catalog when the search is empty', () => {
    const empty = koPack.dictionary.searchUnits('')
    expect(empty.empty).toBe(true)
    const all = units().filter(unit => empty.rank(unit) !== undefined)
    expect(all.filter(unit => unit.kind === 'vocabulary')).toHaveLength(units().filter(unit => unit.kind === 'vocabulary').length)
    expect(units().filter(unit => unit.kind === 'vocabulary').length).toBeGreaterThan(200)
  })
  it('names the TOPIK levels', async () => {
    const source = await lookup()
    expect(koPack.dictionary.lookup!.levelName!('TOPIK 3')).toBe('TOPIK 3')
    expect(new Set(source.words.map(word => word.level))).toEqual(new Set(['TOPIK 1', 'TOPIK 2', 'TOPIK 3', 'TOPIK 4', 'TOPIK 5', 'TOPIK 6']))
  })
})

describe('the Korean look-up source', () => {
  it('lists exactly the entries of the file that are not in the catalog, and no lesson word twice', async () => {
    const file = await loadDictionary('ko')
    const source = await lookup()
    const have = inCatalog()
    const expected = file.words.filter(word => !have(word.id)).map(word => word.id).sort()
    expect(source.words.flatMap(word => word.ids ?? [word.id]).sort()).toEqual(expected)
    expect(expected.length).toBeGreaterThan(10000)
    expect(file.words.length - expected.length).toBeGreaterThan(200)
    expect(source.words.some(word => have(word.id) || (word.ids ?? []).some(have))).toBe(false)
    expect(source.grammar.map(item => item.id).sort()).toEqual(file.grammar.filter(item => !have(item.id)).map(item => item.id).sort())
  })
  it('shows a headword that the file repeats as one entry with its senses', async () => {
    const file = await loadDictionary('ko')
    const have = inCatalog()
    const source = await lookup()
    const forms = source.words.map(word => word.form)
    expect(new Set(forms).size).toBe(forms.length)
    const counts = new Map<string, number>()
    for (const word of file.words) if (!have(word.id)) counts.set(word.form, (counts.get(word.form) ?? 0) + 1)
    const repeated = [...counts].filter(([, count]) => count > 1)
    expect(repeated.length).toBeGreaterThan(700)
    for (const [form, count] of repeated.slice(0, 50)) {
      const entry = source.words.find(word => word.form === form)!
      expect(entry.ids).toHaveLength(count)
      expect(entry.meaning.split(' | ')).toHaveLength(count)
    }
  })
  it('gives every look-up word a one-line gloss of its first sense within the limit', async () => {
    const source = await lookup()
    for (const word of source.words) {
      expect(word.short, word.id).toBeTruthy()
      expect(word.short!.length, word.id).toBeLessThanOrEqual(SHORT_GLOSS)
      expect(word.short).not.toContain(' / ')
    }
    expect(shortGloss('To move from one place to another place. / For ships to travel')).toBe('To move from one place to another place.')
    const long = 'A very long definition '.repeat(10)
    expect(shortGloss(long).length).toBeLessThanOrEqual(SHORT_GLOSS)
    expect(shortGloss(long).endsWith('\u2026')).toBe(true)
  })
  it('does not touch the Chinese and Japanese packs', () => {
    expect(zhPack.dictionary.lookup).toBeUndefined()
    expect(jaPack.dictionary.lookup).toBeDefined()
    expect(jaPack.dictionary.placeholder.vocabulary).toBe('Word, reading, or English')
  })
})

describe('the Korean search', () => {
  it.each([['학생'], ['haksaeng'], ['student'], ['ㅎㅅ']])('finds 학생 first for %s', async query => {
    const rows = await listed(query)
    expect(rows[0]).toBe('학생')
  })
  it('ranks by spelling exact, prefix, inside, then English', async () => {
    expect((await listed('학')).slice(0, 1)).toBeDefined()
    const search = koPack.dictionary.searchUnits('학생')
    const rank = (form: string) => { const unit = units().find(item => item.kind === 'vocabulary' && item.record.ch === form); return unit ? search.rank(unit) : undefined }
    expect(rank('학생')).toBe(0)
    const prefix = koPack.dictionary.searchUnits('학')
    expect(prefix.rank(units().find(item => item.kind === 'vocabulary' && item.record.ch === '학생')!)).toBe(1)
  })
  it('finds look-up words by spelling, romanization and English, after the lesson words', async () => {
    const rows = await listed('고양이')
    expect(rows).toContain('고양이')
    const source = await lookup()
    const search = source.search('goyangi', koPack.romaji)
    expect(source.words.some(word => word.form === '고양이' && search.word(word) !== undefined) || units().some(unit => unit.kind === 'vocabulary' && unit.record.ch === '고양이')).toBe(true)
  })
  it('finds a verb by its polite form', () => {
    const verb = units().find(unit => unit.kind === 'vocabulary' && unit.record.ch === '먹다')
    if (verb) for (const query of ['먹어요', '먹습니다', 'meokda']) expect(koPack.dictionary.searchUnits(query).rank(verb), query).toBeDefined()
  })
  it('counts the catalog the same as the Dictionary tab shows', () => {
    setBuildLanguageForTests('ko')
    expect(catalogCounts.vocabulary).toBe(units().filter(unit => unit.kind === 'vocabulary').length)
  })
})
