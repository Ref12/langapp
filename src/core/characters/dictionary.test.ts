import { describe, expect, it } from 'vitest'
import { buildCatalog, type BandData } from '../study/catalog'
import type { KnowledgeEntry } from '../study/contracts'
import { characterKnowledge, dictionaryCharacters, wordCharacters } from './dictionary'

const data: BandData = {
  schemaVersion: 1, band: '1', alignment: 'Fixture', groups: [],
  vocabulary: [
    { id: 'v1', ch: '\u8336\u676f', pr: 'cha bei', ds: 'teacup', lb: 'teacup' },
    { id: 'v2', ch: '\u8336\u8336', pr: 'cha', ds: 'repeated', lb: 'repeat' },
    { id: 'v3', ch: '\u{20000}', pr: 'fixture', ds: 'exact scalar', lb: 'supplementary' },
  ],
  grammar: [{ id: 'g1', pt: '\u96e8', pr: 'yu', ds: 'grammar only', lb: 'grammar', ex: { segments: [], translation: '', grammar: [] } }],
}
const catalog = buildCatalog([data])
const entry = (kind: 'vocabulary' | 'grammar', lb: string): KnowledgeEntry => ({ ref: `${kind}:${lb}`, kind, lb, band: '1', addedAt: 1, source: 'dictionary' })

describe('dictionary character membership', () => {
  it('derives only exact Han spellings of current known vocabulary, deduplicating words and senses', () => {
    const set = characterKnowledge(catalog, [entry('vocabulary', 'teacup'), entry('vocabulary', 'repeat'), entry('grammar', 'grammar'), entry('vocabulary', 'deleted')], [])
    expect([...set.automatic]).toEqual(['\u8336', '\u676f'])
    expect(set.manual.size).toBe(0)
    expect(characterKnowledge(catalog, [entry('vocabulary', 'repeat')], []).all.has('\u676f')).toBe(false)
    expect(wordCharacters('A\u8336\u8336\uff11\u{20000}\uf900')).toEqual(['\u8336', '\u{20000}', '\uf900'])
  })
  it('unions manual additions without inferring knowledge from practice history', () => {
    const states = [
      { character: '\u96e8', manualAddedAt: 2, practiceCompletions: 0 },
      { character: '\u676f', practiceCompletions: 3, lastPracticedAt: 3 },
    ]
    expect([...characterKnowledge(catalog, [entry('vocabulary', 'repeat')], states).all]).toEqual(['\u8336', '\u96e8'])
    expect([...characterKnowledge(catalog, [], states).all]).toEqual(['\u96e8'])
  })
  it('keeps missing guides and manual-only characters visible; does not invent character meanings', () => {
    const results = dictionaryCharacters(catalog, [{ character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' }],
      [{ character: '\u6c34', manualAddedAt: 1, practiceCompletions: 0 }])
    expect(results.map(row => row.character)).toEqual(['\u4e00', '\u676f', '\u6c34', '\u8336', '\u{20000}'])
    expect(results.find(row => row.character === '\u8336')?.words).toHaveLength(2)
    expect(results.find(row => row.character === '\u8336')?.bands).toEqual(['1'])
    expect(results.find(row => row.character === '\u8336')?.asset).toBeUndefined()
    expect(results.find(row => row.character === '\u4e00')?.words).toEqual([])
  })
})
