import { describe, expect, it } from 'vitest'
import type { Catalog } from '../study/catalog'
import { clampCount, proposeSpan, spanRange } from './span'

const lines = Array.from({ length: 8 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, text: '行'.repeat(i + 1) }))
const catalog = { units: new Map([['vocabulary:a', { kind: 'vocabulary', ref: 'vocabulary:a', band: '1', record: { lb: 'a', ch: '好', pr: 'hǎo', ds: 'good' } }], ['vocabulary:b', { kind: 'vocabulary', ref: 'vocabulary:b', band: '4', record: { lb: 'b', ch: '难', pr: 'nán', ds: 'hard' } }], ['grammar:g', { kind: 'grammar', ref: 'grammar:g', band: '1', record: { lb: 'g', pt: '把' } }]]) } as unknown as Catalog
const tok = (text: string) => ({ text, pinyin: 'p', meaning: 'm', trailing: '' })
const item = {
  lines,
  aligned: { sentences: [], upTo: 8, updatedAt: 1, tokens: [
    { line: 0, items: [tok('好')] }, { line: 1, items: [tok('好'), tok('难')] }, { line: 2, items: [tok('难')] }, { line: 3, items: [tok('把'), tok('词')] },
    { line: 4, items: [tok('词'), tok('好')] }, { line: 6, items: [tok('词')] }, { line: 7, items: [tok('已知')] },
  ] },
  entries: { links: { 好: 'vocabulary:a', 难: 'vocabulary:b', 把: 'grammar:g', 词: 'source:sci', 已知: 'vocabulary:k' }, skipped: [], counts: {}, total: 5, complete: true, updatedAt: 1 },
}

describe('spanRange', () => {
  it('cuts the item into whole, halves, quarters and a time range', () => {
    expect(spanRange('whole', lines)).toEqual({ from: 0, to: 7 })
    expect(spanRange('first-half', lines)).toEqual({ from: 0, to: 3 })
    expect(spanRange('second-half', lines)).toEqual({ from: 4, to: 7 })
    expect(spanRange('quarter-3', lines)).toEqual({ from: 4, to: 5 })
    expect(spanRange({ fromSec: 15, toSec: 42 }, lines)).toEqual({ from: 2, to: 4 })
    expect(spanRange({ fromSec: 500, toSec: 600 }, lines)).toBeUndefined()
    expect(spanRange('whole', [])).toBeUndefined()
  })
  it('clamps the adjustable count to 5-20', () => {
    expect([clampCount(1), clampCount(10), clampCount(99), clampCount(NaN)]).toEqual([5, 10, 20, 10])
  })
})

describe('proposeSpan', () => {
  it('proposes unknown vocabulary and source entries, never known words or grammar', () => {
    const rows = proposeSpan(item, new Set(['vocabulary:k']), catalog, { from: 0, to: 7 })
    expect(rows.map(row => row.ref).sort()).toEqual(['source:sci', 'vocabulary:a', 'vocabulary:b'])
  })
  it('skips known words and ranks by span frequency, recurrence and basicness', () => {
    const rows = proposeSpan(item, new Set(['vocabulary:a']), catalog, { from: 0, to: 7 })
    expect(rows.map(row => row.ref)).toEqual(['vocabulary:b', 'source:sci'])
    expect(rows[1].inSpan).toBe(3)
  })
  it('counts only the span, but recurrence across the item', () => {
    const rows = proposeSpan(item, new Set(), catalog, { from: 4, to: 7 })
    const word = rows.find(row => row.ref === 'source:sci')!
    expect([word.inSpan, word.inItem]).toEqual([2, 3])
    expect(rows.some(row => row.ref === 'vocabulary:b')).toBe(false)
  })
  it('gives each word the shortest line where it is the only unknown', () => {
    const rows = proposeSpan(item, new Set(), catalog, { from: 0, to: 7 })
    expect(rows.find(row => row.ref === 'vocabulary:b')!.example).toBe(2)
    expect(rows.find(row => row.ref === 'vocabulary:a')!.example).toBe(0)
    expect(rows.find(row => row.ref === 'source:sci')!.example).toBe(3)
  })
  it('returns at most the requested number', () => {
    expect(proposeSpan(item, new Set(), catalog, { from: 0, to: 7 }, 1)).toHaveLength(3) // asking for 1 is raised to the minimum of 5; only 3 exist
  })
})
