import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('generated character origins', () => {
  it('cover every built-in guide character, and 鸣 comes from the HSK 7-9 word 共鸣', () => {
    const origins = (JSON.parse(readFileSync('public/characters/chinese/origins.generated.json', 'utf8')) as { origins: Record<string, string[]> }).origins
    const index = JSON.parse(readFileSync('src/data/characters/index.generated.json', 'utf8')) as { characters: { character: string }[] }
    expect(index.characters.filter(entry => !origins[entry.character])).toEqual([])
    expect(origins['\u9e23']).toEqual(['7-9', '\u5171\u9e23', 'w'])
    expect(origins['\u4e00'][0]).toBe('1')
  })
})
