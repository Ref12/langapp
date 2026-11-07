import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { db } from '../database'
import { makeMatcher } from '../dictionary-search'
import { catalogSentence, loadItems, unknownForms } from '../drills/items'
import { usableFor } from '../phrases/bank'
import { loadCatalog, type Catalog } from './catalog'

// App-authored weekday and month names: 星期一-六 and 一月-十二月 (HSK 1), 周一-周日 (HSK 2).
const root = resolve(__dirname, '..', '..', '..')
const authored = parse(readFileSync(resolve(root, 'curriculum', 'v2', 'chinese', 'app-authored.yaml'), 'utf8')) as { band: number; lb: string; topic: string; source: string; level_basis: string }[]
const ref = (lb: string) => `vocabulary:${lb}`
const search = (catalog: Catalog, query: string) => {
  const matcher = makeMatcher(query)
  return [...catalog.units.values()].flatMap(unit => unit.kind === 'vocabulary' && matcher.rank({ text: [unit.record.ch], pr: unit.record.pr, ds: unit.record.ds }) !== undefined ? [unit] : [])
}
const lessonOf = (catalog: Catalog, unitRef: string) => catalog.orderedGroups.findIndex(entry => entry.group.units.some(unit => `${unit.kind}:${unit.ref}` === unitRef))

beforeEach(async () => { await db.delete(); await db.open() })

describe('app-authored weekday and month words', () => {
  it('are searchable in the Dictionary by English, pinyin and characters, under their band', async () => {
    const catalog = await loadCatalog()
    for (const [query, ch, band] of [['Monday', '星期一', '1'], ['Tuesday', '星期二', '1'], ['January', '一月', '1'], ['December', '十二月', '1'], ['Monday', '周一', '2'], ['Sunday', '周日', '2']] as const) {
      const found = search(catalog, query)
      expect(found.map(unit => unit.record.ch), query).toContain(ch)
      expect(found.find(unit => unit.record.ch === ch)?.band).toBe(band)
    }
    expect(search(catalog, 'xing1qi1er4').map(unit => unit.record.ch)).toContain('星期二')
    expect(search(catalog, 'shí èr yuè').map(unit => unit.record.ch)).toContain('十二月')
    expect(search(catalog, '星期二').map(unit => unit.record.ch)).toContain('星期二')
    expect(search(catalog, '周三').map(unit => unit.record.ch)).toContain('周三')
  })

  it('are taught after their parts and each set is grouped together in consecutive lessons', async () => {
    const catalog = await loadCatalog()
    const weekdays = ['yi1', 'er4', 'san1', 'si4', 'wu3', 'liu4'].map(n => lessonOf(catalog, ref(`xing1-qi1-${n}--${['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][['yi1', 'er4', 'san1', 'si4', 'wu3', 'liu4'].indexOf(n)]}`)))
    const parts = ['xing1-qi1--weekday', 'yi1--one', 'er4--two', 'san1--three', 'si4--four', 'wu3--five', 'liu4--six'].map(lb => lessonOf(catalog, ref(lb)))
    expect(weekdays.every(index => index >= 0)).toBe(true)
    expect(Math.min(...weekdays)).toBeGreaterThanOrEqual(Math.max(...parts))
    expect(Math.max(...weekdays) - Math.min(...weekdays)).toBeLessThanOrEqual(1)
    const months = ['yi1-yue4--january', 'er4-yue4--february', 'shi2-yue4--october', 'shi2-yi1-yue4--november', 'shi2-er4-yue4--december'].map(lb => lessonOf(catalog, ref(lb)))
    const monthParts = ['yue4--month', 'yi1--one', 'shi2--ten', 'ba1--eight', 'jiu3--nine'].map(lb => lessonOf(catalog, ref(lb)))
    expect(Math.min(...months)).toBeGreaterThanOrEqual(Math.max(...monthParts))
    // twelve months need three groups of 4-6 units, consecutive
    expect(Math.max(...months) - Math.min(...months)).toBeLessThanOrEqual(2)
    const zhou = ['yi1', 'ri4'].map(n => lessonOf(catalog, ref(`zhou1-${n}--${n === 'yi1' ? 'monday' : 'sunday'}`)))
    expect(Math.min(...zhou)).toBeGreaterThan(lessonOf(catalog, ref('zhou1--week')))
    // every set is taught in its own band's groups
    expect(catalog.orderedGroups[weekdays[0]].band).toBe('1')
    expect(catalog.orderedGroups[zhou[0]].band).toBe('2')
  })

  it('count 星期二 as one word when a sentence is chosen from the known words', async () => {
    const catalog = await loadCatalog()
    const [item] = await loadItems([ref('xing1-qi1-er4--tuesday')], catalog)
    const sentence = catalogSentence(catalog, item)
    expect(sentence?.zh).toContain('星期二')
    const parts = ['wo3--me', 'xing1-qi1--weekday', 'er4--two', 'shang4-ke4--class', 'xiu1-xi5--rest', 'gong1-zuo4--work'].map(ref)
    // knowing 星期 and 二 is not knowing 星期二: the sentence is marked with the unknown form
    expect(unknownForms(catalog, [ref('xing1-qi1-er4--tuesday')], new Set(parts))).toEqual(['星期二'])
    expect(catalogSentence(catalog, item, new Set(parts))?.unknown).toEqual(['星期二'])
    // knowing the word itself and the rest of the sentence leaves nothing unknown
    const known = new Set([...parts, ref('xing1-qi1-er4--tuesday'), ...(catalogSentence(catalog, item)?.zh ? [] : [])])
    expect(catalogSentence(catalog, item, known)?.unknown).toBeUndefined()
  })

  it('are matched as one word by the phrase bank: 星期三我们上课 needs 星期三, not 星期 and 三', () => {
    const phrase = { words: ['xing1-qi1-san1--wednesday', 'wo3-men5--we', 'shang4-ke4--class'], source: 'ai' as const }
    const base = ['wo3-men5--we', 'shang4-ke4--class'].map(ref)
    expect(usableFor(phrase, new Set([...base, 'xing1-qi1--weekday', 'san1--three']))).toBe(false)
    expect(usableFor(phrase, new Set([...base.map(item => item.replace('vocabulary:', '')), 'xing1-qi1-san1--wednesday']))).toBe(true)
  })

  it('have a topic and app-authored provenance in app-authored.yaml, one row per record', async () => {
    const catalog = await loadCatalog()
    expect(authored).toHaveLength(25)
    for (const row of authored) {
      const unit = catalog.units.get(ref(row.lb))
      expect(unit?.kind, row.lb).toBe('vocabulary')
      expect(unit?.band).toBe(String(row.band))
      expect(unit?.kind === 'vocabulary' && unit.record.id.startsWith('zh-app-')).toBe(true)
      expect(row.topic).toBe('time-and-calendar')
      expect(row.source).toBe('app-authored')
      expect(row.level_basis).toMatch(/not in the official HSK list; derived from/)
    }
    expect(new Set(authored.map(row => row.lb)).size).toBe(25)
  })
})
