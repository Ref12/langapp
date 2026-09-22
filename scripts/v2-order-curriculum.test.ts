// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  buildOrderedLessonInventories,
  sortInventoryText,
  validateComponentBindings,
} from './v2-order-curriculum.mjs'
import { buildComponentCandidateFile, buildComponentCandidates } from './v2-vocabulary-components.mjs'

const readYaml = (path: string) => parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

describe('v2 curriculum ordering', () => {
  it('sorts canonical records by lb without changing their values', () => {
    const input = [
      '# Header',
      '- {id: two, ch: 二, pr: èr, ds: two, lb: er4--two}',
      '- {id: one, ch: 一, pr: yī, ds: one, lb: yi1--one}',
      '',
    ].join('\n')
    const output = sortInventoryText(input, 'test.yaml')
    expect(parse(output).map((entry: { lb: string }) => entry.lb)).toEqual(['er4--two', 'yi1--one'])
    expect(parse(output)).toEqual(expect.arrayContaining(parse(input)))
    expect(output).toContain('# Record order: ascending lb')
    expect(output).toContain('# Comments retain original source/editorial context')
  })

  it('keeps comments attached to the following record while sorting', () => {
    const input = [
      '# Header',
      '# Comment for z',
      '- {id: z, ch: 字, pr: zì, ds: character, lb: zi4--character}',
      '',
      '# Comment for a',
      '- {id: a, ch: 爱, pr: ài, ds: love, lb: ai4--love}',
      '',
    ].join('\n')
    const output = sortInventoryText(input, 'test.yaml')
    expect(output.indexOf('# Comment for a')).toBeLessThan(output.indexOf('ai4--love'))
    expect(output.indexOf('# Comment for z')).toBeLessThan(output.indexOf('zi4--character'))
  })

  it('generates separate vocabulary and grammar projections in lesson order', () => {
    const outputs = buildOrderedLessonInventories()
    const vocabulary = outputs.find(output => output.path.endsWith('ordered-vocabulary.yaml'))
    const grammar = outputs.find(output => output.path.endsWith('ordered-grammar.yaml'))
    expect(parse(vocabulary!.content).map((entry: { lb: string }) => entry.lb).slice(0, 4)).toEqual([
      'ni3-hao3--hello', 'wo3--me', 'shi4--identity', 'xue2-sheng5--student',
    ])
    expect(parse(grammar!.content).map((entry: { lb: string }) => entry.lb)).toEqual([
      's-shi4-n--identity', 'stmt-ma5--yes-no', 'np-ne5--followup',
    ])
    expect(vocabulary!.content).toContain('13 of 361 vocabulary records')
  })

  it('reuses vocabulary data where possible and retains reviewed morphemes otherwise', () => {
    const result = validateComponentBindings()
    expect(result.resolved.get('ni3-hao3--hello')?.map(position => position.sense?.lb))
      .toEqual(['ni3--you', 'hao3--good'])
    expect(result.resolved.get('lao3-shi1--teacher')?.[0].sense?.ds)
      .toMatch(/venerable/)
    expect(result.resolved.get('ba4-ba5--dad')?.map(position => position.sense?.id))
      .toEqual(['zh-hsk1-00004-s001', 'zh-hsk1-00004-s001'])
    expect(result.resolved.get('duo1-shao5--quantity')?.map(position => position.sense?.lb))
      .toEqual(['duo1--many', 'shao3--few'])
    expect(result.resolved.get('er2-zi5--son')?.[1].sense?.lb).toBe('zi5--suffix')
    expect(result.resolved.get('zhong1-guo2--china')?.map(position => position.sense?.lb))
      .toEqual(['zhong1--middle', 'guo2--country'])
  })

  it('indexes characters by word and sense without duplicating vocabulary data', () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const candidates = buildComponentCandidates(repositoryRoot)
    const words = new Map(Object.values(candidates).flat().map(word => [word.lb, word.ch]))
    expect(words.size).toBe(176)
    expect([...words.values()].reduce((total, word) => total + [...word].length, 0)).toBe(373)
    expect(candidates['爸']).toEqual([{ ch: '爸爸', lb: 'ba4-ba5--dad' }])
    expect(candidates['读']).toEqual([
      { ch: '读书', lb: 'du2-shu1--read' },
      { ch: '读书', lb: 'du2-shu1--study' },
    ])
    for (const [character, usages] of Object.entries(candidates)) {
      expect([...character]).toHaveLength(1)
      expect(new Set(usages.map(word => word.lb)).size).toBe(usages.length)
      for (const word of usages) {
        expect(word.ch).toContain(character)
        expect(Object.keys(word)).toEqual(['ch', 'lb'])
      }
    }
    expect(readFileSync(new URL('../curriculum/v2/chinese/hsk-1/component-candidates.yaml',
      import.meta.url), 'utf8')).toBe(buildComponentCandidateFile(repositoryRoot, candidates))
  })

  it('requires reviewed decisions for every generated component position', () => {
    const result = validateComponentBindings()
    const candidates: ReturnType<typeof buildComponentCandidates> = readYaml(
      '../curriculum/v2/chinese/hsk-1/component-candidates.yaml')
    expect(result.vocabularyCount).toBe(176)
    expect(result.positionCount).toBe(373)
    const words = new Map(Object.values(candidates).flat().map(word => [word.lb, word.ch]))
    expect(result.bindings.map(binding => binding.vocabulary)).toEqual([...words.keys()].sort())
    for (const [label, written] of words) {
      const positions = result.resolved.get(label)!
      expect(positions.map(position => position.ch)).toEqual([...written])
      for (const character of new Set(written)) {
        expect(candidates[character]).toContainEqual({ ch: written, lb: label })
      }
    }
  })

  it('keeps definitions reusable and retires unused supplemental senses', () => {
    const result = validateComponentBindings()
    const used = new Set(result.bindings.flatMap(binding => binding.components)
      .flatMap(component => 'ref' in component ? [component.ref] : []))
    for (const record of readYaml('../curriculum/v2/chinese/hsk-1/components.yaml')) {
      expect(used.has(record.lb), record.lb).toBe(true)
      expect(record.ds).not.toMatch(/\p{Script=Han}|element in|element of|normally neutral/iu)
      expect(['free', 'bound', 'grammatical']).toContain(record.usage)
    }
    for (const record of readYaml('../curriculum/v2/chinese/hsk-1/component-vocabulary.yaml')) {
      expect(used.has(record.lb), record.lb).toBe(true)
    }
    expect(result.byVocabulary.get('dong1-xi5--thing')?.formation).toBe('opaque')
    expect(result.resolved.get('dong1-xi5--thing')?.map(position => position.sense)).toEqual([null, null])
  })

  it('matches the generated files on disk', () => {
    for (const output of buildOrderedLessonInventories()) {
      expect(readFileSync(output.path, 'utf8')).toBe(output.content)
    }
  })
})
