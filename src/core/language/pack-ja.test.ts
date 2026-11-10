// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildJaPack, REGISTRY_FILE } from '../../../scripts/generate-pack-ja.mjs'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, renderExample, resetCatalogCache, catalogBandList, catalogCounts, type BandData, type Catalog } from '../study/catalog'
import { unitLabelSchema, unitRef } from '../study/contracts'
import { loadPhraseIndex } from '../phrases'
import { shippedPhrases } from '../phrases/bank'
import { loadPracticeData, loadPracticeIndex } from '../practice-data'
import { getPack } from '.'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const onDisk = (path: string) => readFileSync(root + path, 'utf8').replace(/\r\n/g, '\n')
const pack = buildJaPack(root)
const band = pack.band as BandData & { schemaVersion: 1 }

afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the Japanese pack generator', () => {
  it('is deterministic and its output equals the committed files', () => {
    const again = buildJaPack(root)
    expect([...again.files.keys()]).toEqual([...pack.files.keys()])
    for (const [path, text] of pack.files) {
      expect(again.files.get(path) === text, path + ' is deterministic').toBe(true)
      expect(onDisk(path) === text, path + ' equals the committed file').toBe(true)
    }
  })

  it('keeps a label registry that agrees with the data, with valid unique labels', () => {
    const registry = JSON.parse(onDisk(REGISTRY_FILE)) as { vocabulary: Record<string, string>; grammar: Record<string, string> }
    for (const [kind, records] of [['vocabulary', band.vocabulary], ['grammar', band.grammar]] as const) {
      const labels = records.map(record => record.lb)
      expect(new Set(labels).size, kind + ' labels are unique').toBe(labels.length)
      for (const record of records) {
        expect(unitLabelSchema.safeParse(record.lb).success, record.lb).toBe(true)
        expect(registry[kind][record.id], record.id).toBe(record.lb)
      }
      expect(Object.keys(registry[kind]).sort()).toEqual(records.map(record => record.id).sort())
    }
  })

  it('does not read or carry Chinese data', () => {
    const text = [...pack.files.values()].join('')
    expect(text).not.toContain('"zh-hsk')
    expect(JSON.stringify(pack.phrases[0])).not.toContain('我是学生')
    const source = readFileSync(root + 'scripts/generate-pack-ja.mjs', 'utf8')
    expect(source).not.toMatch(/from '[^']*(?:core\/parallel|data\/parallel)/)
  })
})

describe('the Japanese build language', () => {
  let catalog: Catalog
  beforeAll(async () => { setBuildLanguageForTests('ja'); catalog = await loadCatalog(); setBuildLanguageForTests(undefined); resetCatalogCache() })
  const ja = () => { setBuildLanguageForTests('ja'); expect(getPack().id).toBe('ja') }

  it('loads 87 groups, 291 vocabulary and 108 grammar units, and counts them from the index', () => {
    ja()
    expect(catalogBandList()).toEqual(['1'])
    expect(catalogCounts).toMatchObject({ vocabulary: 291, grammar: 108, groups: 87 })
    expect(catalog.orderedGroups).toHaveLength(87)
    expect([...catalog.units.values()].filter(unit => unit.kind === 'vocabulary')).toHaveLength(291)
    expect([...catalog.units.values()].filter(unit => unit.kind === 'grammar')).toHaveLength(108)
  })

  it('resolves every unit of every group, none is empty, each has 2 or 3 examples', () => {
    for (const { group } of catalog.orderedGroups) {
      expect(group.units.length, group.id).toBeGreaterThan(0)
      for (const unit of group.units) expect(catalog.units.has(unitRef(unit.kind, unit.ref)), unit.ref).toBe(true)
      expect(group.examples.length, group.id).toBeGreaterThanOrEqual(2)
      expect(group.examples.length, group.id).toBeLessThanOrEqual(3)
    }
  })

  it('renders every example, grammar example and bank phrase to exactly its own text and reading', async () => {
    ja()
    const phrases = Object.values(await shippedPhrases('1')).flat()
    const unique = new Set(phrases)
    expect(unique.size).toBe(817)
    const source = new Map(pack.phrases.map(phrase => [phrase.id, phrase]))
    for (const phrase of unique) {
      const rendered = renderExample(catalog, { segments: phrase.tokens ?? [] })
      expect(rendered.text, 'phrase ' + phrase.id).toBe(phrase.zh)
      expect(rendered.pinyin, 'phrase ' + phrase.id).toBe(phrase.py)
      for (const ref of [...phrase.words, ...(phrase.grammar ?? [])]) expect(catalog.units.has(ref), ref).toBe(true)
      expect(source.get(phrase.id)).toBeDefined()
    }
    const byId = new Map([...unique].map(phrase => ['phrase-' + phrase.id, phrase]))
    for (const { group } of catalog.orderedGroups) for (const example of group.examples) {
      const bank = byId.get(example.id)!
      const rendered = renderExample(catalog, example)
      expect([rendered.text, rendered.pinyin], group.id).toEqual([bank.zh, bank.py])
    }
    for (const unit of catalog.units.values()) if (unit.kind === 'grammar') {
      const rendered = renderExample(catalog, unit.record.ex)
      expect(rendered.text, unit.ref).not.toBe('')
      expect(unit.record.ex.grammar, unit.ref).toContain(unit.record.lb)
    }
  })

  it('has a phrase index and no practice dataset (the dataset is empty, not an error)', async () => {
    ja()
    expect((await loadPhraseIndex())?.total).toBe(817)
    const { data, problems } = await loadPracticeData()
    expect(problems).toEqual([])
    expect(data.counts).toEqual({ accepted: 0, exchanges: 0, grammarPoints: 0, nearMisses: 0, conversations: 0 })
    expect((await loadPracticeIndex()).totals.exchanges).toBe(0)
  })

  it('has an empty catalog and phrase bank for the Korean placeholder', async () => {
    setBuildLanguageForTests('ko')
    expect(catalogBandList()).toEqual([])
    expect((await loadCatalog()).orderedGroups).toEqual([])
    expect(await shippedPhrases('1')).toEqual({})
    expect(await loadPhraseIndex()).toBeUndefined()
    expect((await loadPracticeData()).data.counts.exchanges).toBe(0)
  })
})

describe('the Chinese build language', () => {
  it('still reads the v2 catalog, the shipped phrases and the practice dataset', async () => {
    expect(getPack().id).toBe('zh')
    expect(catalogCounts).toMatchObject({ vocabulary: 7122, grammar: 673, groups: 1491 })
    expect((await loadCatalog()).orderedGroups).toHaveLength(1491)
    expect(Object.keys(await shippedPhrases('1')).length).toBeGreaterThan(300)
    expect((await loadPracticeIndex()).totals.exchanges).toBeGreaterThan(0)
  })
})
