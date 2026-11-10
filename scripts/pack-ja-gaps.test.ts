import { describe, expect, it } from 'vitest'
import { applyCorrections, checkGaps, computeGaps, gapList } from './generate-pack-ja.mjs'

// A small fixture: two lessons, one pattern and one word that no sentence of lesson 1 uses, one form tag.
const lessons = () => [
  { number: 1, words: [{ entry: 'w1' }, { entry: 'w2' }], grammar_intro: ['g1', 'g2'], phrases: [{ id: 1, text: 'a', tokens: [{ t: 'a', w: 'w1' }, { t: 'b', g: 'g1' }], words: ['w1'], grammar: ['g1'] }] },
  { number: 2, words: [{ entry: 'w3' }], grammar_intro: [], phrases: [{ id: 2, text: 'c', tokens: [{ t: 'c', w: 'w3' }], words: ['w3'], grammar: [] }] },
]
const context = (tags = new Map()) => ({
  tags, taught: { words: new Map(), grammar: new Map([['g1', 1], ['g2', 1]]) }, formsOfPattern: new Map(),
  patternTitle: (id: string) => 'pattern ' + id, wordTitle: (id: string) => 'word ' + id,
})

describe('the content-gap check', () => {
  it('finds a pattern and a word that no sentence of the lesson uses', () => {
    const gaps = computeGaps(lessons(), context())
    expect(gapList(gaps)).toEqual([{ lesson: 1, kind: 'pattern', id: 'g2' }, { lesson: 1, kind: 'word', id: 'w2' }])
  })

  it('fails on a gap that is not in the accepted list and passes once each is listed with a reason', () => {
    const gaps = computeGaps(lessons(), context())
    expect(checkGaps(gaps, []).unaccepted).toHaveLength(2)
    const accepted = [
      { lesson: 1, kind: 'pattern', id: 'g2', reason: 'a pattern of the lesson that only a later lesson shows' },
      { lesson: 1, kind: 'word', id: 'w2', reason: 'a word the lesson only names' },
    ]
    expect(checkGaps(gaps, accepted)).toEqual({ unaccepted: [], stale: [] })
  })

  it('fails on an accepted entry that is no gap any more, or has no reason', () => {
    const gaps = computeGaps(lessons(), context())
    const accepted = [
      { lesson: 1, kind: 'pattern', id: 'g2', reason: 'ok' },
      { lesson: 1, kind: 'word', id: 'w2', reason: ' ' },
      { lesson: 2, kind: 'word', id: 'w3', reason: 'not a gap' },
    ]
    const result = checkGaps(gaps, accepted)
    expect(result.unaccepted).toEqual([])
    expect(result.stale.map(item => item.id)).toEqual(['w2', 'w3'])
  })

  it('finds a form whose pattern is taught in a later lesson, and a listed pattern whose forms no sentence shows', () => {
    const tags = new Map([['2:2:0', { lesson: 2, phrase: 2, form: 'f1', grammar: 'g9' }]])
    const ctx = { ...context(tags), taught: { words: new Map(), grammar: new Map([['g9', 5], ['g1', 1], ['g2', 1]]) }, formsOfPattern: new Map([['g2', new Set(['fx'])]]) }
    const gaps = computeGaps(lessons(), ctx)
    expect(gapList(gaps)).toEqual(expect.arrayContaining([{ lesson: 2, kind: 'form-later', id: 'f1:g9' }, { lesson: 1, kind: 'form-unused', id: 'g2' }]))
  })
})

describe('the corrections of the lesson lists', () => {
  it('moves a word and a pattern, removes a pattern, adds a word and a Japanese-only phrase', () => {
    const data = lessons()
    applyCorrections(data, {
      moves: [{ word: 'w2', from: 1, to: 2 }, { grammar: 'g2', from: 1, to: 2 }],
      removals: [{ grammar: 'g1', lesson: 1 }],
      additions: [{ lesson: 1, word: { entry: 'w9', form: '九', gloss: 'nine' } }],
      added: [{ id: 3, lesson: 2, extra: true, reading: 'd', en: 'd', tokens: [{ t: 'd', w: 'w3' }], words: ['w3'], grammar: [] }],
      phrases: { 1: { grammar: { add: ['g5'], remove: ['g1'] } }, 2: { rewrite: { tokens: [{ t: 'e', w: 'w3' }], reading: 'e', words: ['w3'], grammar: [] } } },
    })
    expect(data[0].words.map((row: { entry: string }) => row.entry)).toEqual(['w1', 'w9'])
    expect(data[0].words[1]).toMatchObject({ extra: true, status: 'word' })
    expect(data[1].words.map((row: { entry: string }) => row.entry)).toEqual(['w3', 'w2'])
    expect(data[0].grammar_intro).toEqual([])
    expect(data[1].grammar_intro).toEqual(['g2'])
    expect(data[0].phrases[0].grammar).toEqual(['g5'])
    expect(data[1].phrases[0]).toMatchObject({ text: 'e', reading: 'e', rewritten: true })
    expect(data[1].phrases[1]).toMatchObject({ id: 3, text: 'd', extra: true, added: true })
    expect(data[1].phrases[1].zh).toBeUndefined()
  })

  it('throws, naming the lesson or phrase, when what it refers to is not there', () => {
    expect(() => applyCorrections(lessons(), { moves: [{ word: 'w3', from: 1, to: 2 }] })).toThrow(/lesson 1 does not list that word/)
    expect(() => applyCorrections(lessons(), { moves: [{ word: 'w1', from: 1, to: 7 }] })).toThrow(/there is no lesson 7/)
    expect(() => applyCorrections(lessons(), { moves: [{ grammar: 'g7', from: 1, to: 2 }] })).toThrow(/lesson 1 does not list that pattern/)
    expect(() => applyCorrections(lessons(), { removals: [{ grammar: 'g7', lesson: 2 }] })).toThrow(/lesson 2/)
    expect(() => applyCorrections(lessons(), { additions: [{ lesson: 1, grammar: 'g1' }] })).toThrow(/lists that pattern already/)
    expect(() => applyCorrections(lessons(), { phrases: { 1: { grammar: { remove: ['g8'] } } } })).toThrow(/phrase 1 does not list the pattern g8/)
    expect(() => applyCorrections(lessons(), { phrases: { 9: { grammar: { add: ['g8'] } } } })).toThrow(/unknown phrase 9/)
    expect(() => applyCorrections(lessons(), { phrases: { 1: { rewrite: { tokens: [{ t: 'x', w: 'w5' }], reading: 'x', words: [], grammar: [] } } } })).toThrow(/rewrite of phrase 1.*w5/)
    expect(() => applyCorrections(lessons(), { added: [{ id: 2, lesson: 1, extra: true, reading: 'x', en: 'x', tokens: [{ t: 'x' }], words: [], grammar: [] }] })).toThrow(/new id after the last one/)
    expect(() => applyCorrections(lessons(), { added: [{ id: 3, lesson: 1, reading: 'x', en: 'x', tokens: [{ t: 'x' }], words: [], grammar: [] }] })).toThrow(/extra: true/)
    expect(() => applyCorrections(lessons(), { added: [{ id: 3, lesson: 4, extra: true, reading: 'x', en: 'x', tokens: [{ t: 'x' }], words: [], grammar: [] }] })).toThrow(/there is no lesson 4/)
  })
})
