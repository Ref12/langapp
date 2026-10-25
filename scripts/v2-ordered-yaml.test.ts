// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { appBands } from './generate-v2-app-data.mjs'
import { repositoryRoot } from './v2-curriculum-io.mjs'

const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8')

describe('ordered v2 curriculum YAML', () => {
  for (const band of appBands) {
    for (const kind of ['vocabulary', 'grammar'] as const) {
      it(`hsk-${band} ordered-${kind}.yaml lists every record once, in generated JSON order`, () => {
        const json = JSON.parse(read(`src/data/v2/hsk-${band}.generated.json`))
        const dir = `curriculum/v2/chinese/hsk-${band}`
        const canonicalText = read(`${dir}/${kind}.yaml`)
        const canonical = new Map((parse(canonicalText) as { lb: string }[]).map(record => [record.lb, record]))
        const orderedText = read(`${dir}/ordered-${kind}.yaml`)
        const ordered = parse(orderedText) as { lb: string }[]
        const expected = json.groups.flatMap((group: { units: { kind: string; ref: string }[] }) =>
          group.units.filter(unit => unit.kind === kind).map(unit => unit.ref))
        expect(ordered.map(record => record.lb)).toEqual(expected)
        expect(new Set(expected).size).toBe(canonical.size)
        expect(expected).toHaveLength(json[kind].length)
        for (const record of ordered) expect(record).toEqual(canonical.get(record.lb))
        // Entries are copied verbatim (flow style, quoting), not re-serialised.
        const canonicalLines = new Set(canonicalText.split('\n'))
        for (const line of orderedText.split('\n').filter(line => line.length && !line.startsWith('#'))) {
          expect(canonicalLines.has(line)).toBe(true)
        }
        // Lesson headers follow the app's group order and numbering.
        const headers = orderedText.split('\n').filter(line => line.startsWith('# Lesson '))
        const groups = json.groups
          .map((group: { id: string; units: { kind: string }[] }, index: number) => ({ group, index }))
          .filter(({ group }: { group: { units: { kind: string }[] } }) => group.units.some(unit => unit.kind === kind))
        expect(headers).toEqual(groups.map(({ group, index }: { group: { id: string }; index: number }) =>
          `# Lesson ${String(index + 1).padStart(4, '0')}: ${group.id}`))
      })
    }
  }
})
