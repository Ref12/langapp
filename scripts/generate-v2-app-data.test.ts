// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appBands, buildAppData } from './generate-v2-app-data.mjs'
import { repositoryRoot } from './v2-curriculum-io.mjs'

describe('v2 app data', () => {
  const data = buildAppData()

  it('places every HSK 1-6 unit exactly once in the generated group order', () => {
    expect(data.bands.map(band => band.band)).toEqual(appBands)
    for (const band of data.bands) {
      const units = new Set([...band.vocabulary.map(record => `vocabulary:${record.lb}`), ...band.grammar.map(record => `grammar:${record.lb}`)])
      const placed = band.groups.flatMap(group => group.units.map(unit => `${unit.kind}:${unit.ref}`))
      expect(new Set(placed).size).toBe(placed.length)
      expect(new Set(placed)).toEqual(units)
      for (const group of band.groups) {
        expect(group.units.length).toBeGreaterThanOrEqual(4)
        expect(group.units.length).toBeLessThanOrEqual(6)
        expect(group.examples.length).toBeGreaterThan(0)
      }
      for (const record of band.grammar) expect(record.ex.grammar).toContain(record.lb)
    }
    expect(data.bands[0].groups[0].units.map(unit => unit.ref)).toContain('wo3--me')
  })

  it('matches the committed generated files', () => {
    const outputs = [['index.generated.json', data.index], ...data.bands.map(band => [`hsk-${band.band}.generated.json`, band] as const)] as const
    for (const [name, value] of outputs) {
      const committed = readFileSync(resolve(repositoryRoot, 'src', 'data', 'v2', name), 'utf8')
      expect(JSON.parse(committed)).toEqual(value)
    }
  })
})
