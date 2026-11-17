// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache } from './catalog'
import { moduleOf, moduleProblem, modulesOf, unitIndexOf } from './modules'

const root = fileURLToPath(new URL('../../../', import.meta.url))
afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

const mod = (id: string, from: number, to: number, title = 'Title ' + id) => ({ id, title, from, to })

describe('the modules of each level', () => {
  for (const language of ['zh', 'ja'] as const) {
    it(`cover every unit of every ${language} level once, in order, with sizes 8 to 12 and unique titles`, async () => {
      setBuildLanguageForTests(language)
      const catalog = await loadCatalog()
      expect(catalog.bands.length).toBe(language === 'zh' ? 6 : 1)
      for (const data of catalog.bands) {
        const modules = modulesOf(data.band)
        expect(moduleProblem(modules, data.groups.length), data.alignment).toBeUndefined()
        expect(modules[0].from).toBe(1)
        expect(modules.at(-1)!.to).toBe(data.groups.length)
      }
    })
  }

  it('has the module counts the data was written with', async () => {
    const counts = (language: 'zh' | 'ja', bands: string[]) => { setBuildLanguageForTests(language); return bands.map(band => modulesOf(band as '1').length) }
    expect(counts('zh', ['1', '2', '3', '4', '5', '6'])).toEqual([10, 8, 16, 28, 46, 46])
    expect(counts('ja', ['1'])).toEqual([10])
  })

  it('has no modules in a pack without units (Korean) and none for a level that does not exist', () => {
    setBuildLanguageForTests('ko')
    expect(modulesOf('1')).toEqual([])
    setBuildLanguageForTests('zh')
    expect(modulesOf('1')).not.toEqual([])
  })

  it('titles say what is learned: 2 to 7 words, nothing generic or numbered, not a number, none repeated within a level', () => {
    setBuildLanguageForTests('zh')
    for (const band of ['1', '2', '3', '4', '5', '6'] as const) {
      const titles = modulesOf(band).map(module => module.title)
      expect(new Set(titles.map(title => title.toLowerCase())).size).toBe(titles.length)
      for (const title of titles) { expect(title.split(/\s+/).length).toBeGreaterThanOrEqual(2); expect(title.split(/\s+/).length).toBeLessThanOrEqual(7); expect(title).not.toMatch(/^module\s*\d+$/i); expect(title).not.toMatch(/mixed|vocabulary \d|patterns \d|words \d/i) }
    }
    expect(modulesOf('1')[0].title).toBe('Introductions, politeness and 吗 questions')
  })
})

describe('moduleProblem', () => {
  const good = [mod('a', 1, 10), mod('b', 11, 20), mod('c', 21, 26)]
  it('accepts a fitting level', () => { expect(moduleProblem(good, 26)).toBeUndefined() })
  it('refuses a gap, an overlap, a short or long module, a repeated title and a catalog that grew', () => {
    expect(moduleProblem([mod('a', 1, 10), mod('b', 12, 20)], 20)).toMatch(/starts at unit 12, expected 11/)
    expect(moduleProblem([mod('a', 1, 10), mod('b', 10, 20)], 20)).toMatch(/starts at unit 10, expected 11/)
    expect(moduleProblem([mod('a', 1, 7), mod('b', 8, 17)], 17)).toMatch(/a has 7 units/)
    expect(moduleProblem([mod('a', 1, 13), mod('b', 14, 23)], 23)).toMatch(/a has 13 units/)
    expect(moduleProblem([mod('a', 1, 10), mod('b', 11, 14)], 14)).toMatch(/b has 4 units/)
    expect(moduleProblem([mod('a', 1, 10, 'Same title'), mod('b', 11, 20, 'same title')], 20)).toMatch(/repeats the title/)
    expect(moduleProblem(good, 27)).toMatch(/end at unit 26 of 27/)
    expect(moduleProblem(good, 25)).toMatch(/end at unit 26 of 25/)
    expect(moduleProblem([mod('a', 1, 10, 'Module 3')], 10)).toMatch(/words|only a number/)
    for (const bad of ['Mixed vocabulary', 'Mixed everyday words', 'Everyday vocabulary 3', 'Grammar patterns 2', 'Common words 4']) expect(moduleProblem([mod('a', 1, 10, bad)], 10)).toMatch(/generic or numbered/)
  })
  it('lets the last module of a level have 5 units', () => { expect(moduleProblem([mod('a', 1, 10), mod('b', 11, 15)], 15)).toBeUndefined() })
})

describe('moduleOf', () => {
  it('finds the module of a unit and its place inside it', async () => {
    setBuildLanguageForTests('zh')
    const catalog = await loadCatalog()
    expect(moduleOf(catalog, '1', 1)).toMatchObject({ moduleNumber: 1, moduleCount: 10, position: 1, size: 8, module: { id: 'hsk-1-m1', title: 'Introductions, politeness and 吗 questions' } })
    expect(moduleOf(catalog, '1', 3)).toMatchObject({ moduleNumber: 1, position: 3, size: 8 })
    expect(moduleOf(catalog, '1', 8)).toMatchObject({ moduleNumber: 1, position: 8 })
    expect(moduleOf(catalog, '1', 9)).toMatchObject({ moduleNumber: 2, position: 1 })
    expect(moduleOf(catalog, '1', 87)).toMatchObject({ moduleNumber: 10, moduleCount: 10, position: 12, size: 12 })
    expect(moduleOf(catalog, '2', 1)).toMatchObject({ moduleNumber: 1, moduleCount: 8, module: { id: 'hsk-2-m1' } })
    expect(moduleOf(catalog, '1', 88)).toBeUndefined()
    expect(moduleOf(catalog, '1', 0)).toBeUndefined()
  })
  it('counts a group\'s place in its level', async () => {
    setBuildLanguageForTests('zh')
    const catalog = await loadCatalog()
    const second = catalog.orderedGroups.filter(entry => entry.band === '2')
    expect(unitIndexOf(catalog, '1', catalog.orderedGroups[0].group.id)).toBe(1)
    expect(unitIndexOf(catalog, '2', second[0].group.id)).toBe(1)
    expect(unitIndexOf(catalog, '2', second[4].group.id)).toBe(5)
    expect(unitIndexOf(catalog, '1', second[0].group.id)).toBe(0)
  })
})

describe('scripts/check-modules.mjs', () => {
  it('passes on the committed data', () => {
    const run = spawnSync(process.execPath, [root + 'scripts/check-modules.mjs'], { encoding: 'utf8' })
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toContain('zh hsk-6: 46 modules cover 448 units')
  })
})
