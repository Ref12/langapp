import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { combineMeanings } from './meanings'
import { parseUnihan, shortMeaning } from '../../../scripts/generate-character-meanings.mjs'

describe('character meanings', () => {
  it('puts the dictionary senses first and appends the curriculum meaning unless already among them', () => {
    expect(combineMeanings('hulled or husked uncooked rice', 'meter (unit of length)')).toBe('hulled or husked uncooked rice; meter (unit of length)')
    expect(combineMeanings('one; a, an; alone', 'One')).toBe('one; a, an; alone')
    expect(combineMeanings(undefined, 'meter')).toBe('meter')
    expect(combineMeanings('rice', undefined)).toBe('rice')
    expect(combineMeanings(undefined, undefined)).toBeUndefined()
  })
  it('keeps the first three senses', () => {
    expect(shortMeaning('one; a, an; alone; single; sole')).toBe('one; a, an; alone')
    expect(shortMeaning('rice')).toBe('rice')
  })
  it('reads the first Mandarin reading and the definition, only for wanted characters, and skips those without a definition', () => {
    const text = ['# comment', 'U+7C73\tkDefinition\thulled or husked uncooked rice', 'U+7C73\tkMandarin\tm\u01d0', 'U+4E00\tkMandarin\ty\u012b', 'U+4E8C\tkDefinition\ttwo', 'U+4E8C\tkMandarin\t\u00e8r er'].join('\n')
    expect(parseUnihan(text, ['\u7c73', '\u4e00', '\u4e8c'])).toEqual({ '\u4e8c': ['\u00e8r', 'two'], '\u7c73': ['m\u01d0', 'hulled or husked uncooked rice'] })
  })
  it('the generated table covers the stroke-guide characters', () => {
    const file = JSON.parse(readFileSync('public/characters/chinese/meanings.generated.json', 'utf8')) as { meanings: Record<string, [string, string]> }
    expect(file.meanings['\u7c73']).toEqual(['m\u01d0', 'hulled or husked uncooked rice'])
    expect(Object.keys(file.meanings).length).toBeGreaterThan(2900)
  })
})
