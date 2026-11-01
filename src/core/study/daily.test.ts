import { beforeEach, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog'
import { clampCount, countItems, describeCounts, fillByWords, loadNewCount, saveNewCount } from './daily'

beforeEach(() => localStorage.clear())

describe('new words per set', () => {
  it('defaults to 5, clamps to 1-20 and is remembered', () => {
    expect(loadNewCount()).toBe(5)
    expect([0, -3, 7.4, 99, 'x', ''].map(clampCount)).toEqual([1, 1, 7, 20, 5, 1])
    saveNewCount(15)
    expect(loadNewCount()).toBe(15)
    saveNewCount(500)
    expect(loadNewCount()).toBe(20)
  })

  it('fills across groups, counts only words, and skips known items', async () => {
    const catalog = await loadCatalog()
    const refs = fillByWords(catalog, new Set(), 15)
    const counts = countItems(refs.map(ref => ({ kind: ref.startsWith('grammar:') ? 'grammar' as const : 'vocabulary' as const })))
    expect(counts.words).toBeGreaterThanOrEqual(15)
    expect(counts.words).toBeLessThanOrEqual(17)
    expect(counts.grammar).toBeGreaterThan(0)
    const rest = fillByWords(catalog, new Set(refs), 3)
    expect(rest.some(ref => refs.includes(ref))).toBe(false)
  })

  it('writes the counts line with words first', () => {
    expect(describeCounts({ words: 312, grammar: 48 }, 220)).toBe('312 words · 48 grammar · 220 characters')
    expect(describeCounts({ words: 1, grammar: 0 }, 1)).toBe('1 word · 0 grammar · 1 character')
  })
})
