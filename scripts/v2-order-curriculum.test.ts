// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  buildOrderedLessonInventories,
  sortInventoryText,
} from './v2-order-curriculum.mjs'

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

  it('matches the generated files on disk', () => {
    for (const output of buildOrderedLessonInventories()) {
      expect(readFileSync(output.path, 'utf8')).toBe(output.content)
    }
  })
})
