import { describe, expect, it } from 'vitest'
import { parsePhraseIndex } from './index'

describe('phrase index', () => {
  it('totals the bands and keys the words as vocabulary refs', () => {
    const index = parsePhraseIndex({ schemaVersion: 1, bands: { '1': { count: 3, words: { a: 2 } }, '2': { count: 1, words: { a: 1, b: 1 } } } })
    expect(index?.total).toBe(4)
    expect(index?.byWord.get('vocabulary:a')).toBe(3)
  })
  it('is undefined when unreadable, so callers show no number', () => { expect(parsePhraseIndex({ nope: 1 })).toBeUndefined() })
})
