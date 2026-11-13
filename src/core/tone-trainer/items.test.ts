// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPairs, buildSingles, buildToneItems, fullToneBases, PAIR_WORDS_PER_GROUP } from './items'

const bands = [1, 2, 3, 4, 5, 6].map(n => (JSON.parse(readFileSync(join('src', 'data', 'v2', 'hsk-' + n + '.generated.json'), 'utf8')) as { vocabulary: { ch: string; lb: string }[] }).vocabulary)
const chars = JSON.parse(readFileSync(join('scripts', 'tone-single-chars.json'), 'utf8')) as Record<string, string[]>

describe('the tone trainer item list', () => {
  it('has 62 syllable bases that occur in all four tones, so 248 singles', () => {
    expect(fullToneBases(bands)).toHaveLength(62)
    const singles = buildSingles(bands, chars)
    expect(singles).toHaveLength(248)
    expect(new Set(singles.map(item => item.id)).size).toBe(248)
    expect(singles.every(item => item.tones.length === 1 && item.pinyin === item.id.slice(2))).toBe(true)
  })
  it('has groups of 12 two-syllable words per tone pair, with no 3-3 words, no 一 or 不 and no neutral first syllable', () => {
    const pairs = buildPairs(bands)
    const groups = new Map<string, number>()
    for (const item of pairs) groups.set(item.tones.join(''), (groups.get(item.tones.join('')) ?? 0) + 1)
    expect(groups.size).toBeGreaterThanOrEqual(19)
    expect([...groups.values()].every(count => count === PAIR_WORDS_PER_GROUP)).toBe(true)
    expect(pairs.some(item => item.tones[0] === 3 && item.tones[1] === 3)).toBe(false)
    expect(pairs.some(item => /[一不]/.test(item.chars))).toBe(false)
    expect(pairs.every(item => item.tones[0] !== 5 && [...item.chars].length === 2)).toBe(true)
  })
  it('is the same list every time', () => {
    expect(JSON.stringify(buildToneItems(bands, chars))).toBe(JSON.stringify(buildToneItems(bands, chars)))
  })
})
