import { beforeEach, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog'
import { clampCount, clampUnits, describeCounts, fillByItems, fillByUnits, loadLength, loadReviewCount, loadUnitsPerSet, pickReviews, saveLength, saveReviewCount, saveUnitsPerSet, unitCount, unitsFromItems } from './daily'
import { storageNames } from '../storage-names'

beforeEach(() => localStorage.clear())

describe('units per set', () => {
  it('defaults to 1, clamps to 1-4 and is remembered', () => {
    expect(loadUnitsPerSet()).toBe(1)
    expect([0, -3, 2.4, 99, 'x', ''].map(clampUnits)).toEqual([1, 1, 2, 4, 1, 1])
    expect([0, -3, 7.4, 99, 'x', ''].map(clampCount)).toEqual([1, 1, 7, 20, 5, 1])
    saveUnitsPerSet(3)
    expect(loadUnitsPerSet()).toBe(3)
    saveUnitsPerSet(500)
    expect(loadUnitsPerSet()).toBe(4)
  })

  it('migrates the stored item count: 5, 10, 15, 20 become 1, 2, 3, 4 and anything else the nearest', () => {
    expect([5, 10, 15, 20].map(unitsFromItems)).toEqual([1, 2, 3, 4])
    expect([1, 3, 7, 8, 12, 13, 17, 18, 99, 'x'].map(unitsFromItems)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, 1])
    for (const [items, units] of [['5', 1], ['10', 2], ['15', 3], ['20', 4], ['12', 2], ['3', 1]] as const) {
      localStorage.clear()
      localStorage.setItem(storageNames().local.newItems, items)
      expect(loadUnitsPerSet()).toBe(units)
    }
    localStorage.clear()
    localStorage.setItem(storageNames().local.legacyNewItems, '15')
    expect(loadUnitsPerSet()).toBe(3)
    // a units choice made since wins over the old item count
    localStorage.setItem(storageNames().local.newItems, '20')
    saveUnitsPerSet(2)
    expect(loadUnitsPerSet()).toBe(2)
  })

  it('remembers the Length chosen on the Practice page, Standard until then', () => {
    expect(loadLength()).toBe('standard')
    saveLength('long')
    expect(loadLength()).toBe('long')
    localStorage.setItem(storageNames().local.practiceLength, 'huge')
    expect(loadLength()).toBe('standard')
  })

  it('fills by whole units: the next N units that still have new items', async () => {
    const catalog = await loadCatalog()
    const unitRefs = (at: number) => catalog.orderedGroups[at].group.units.map(unit => `${unit.kind}:${unit.ref.replace(/^[a-z]+:/, '')}`)
    for (const units of [1, 2, 3, 4]) {
      const refs = fillByUnits(catalog, new Set(), units)
      expect(unitCount(catalog, refs)).toBe(units)
      expect(refs).toEqual(Array.from({ length: units }, (_, at) => unitRefs(at)).flat())
    }
    // units whose items are all known are skipped; a half-known unit counts and keeps only its new items
    const known = new Set([...unitRefs(0), unitRefs(1)[0]])
    const two = fillByUnits(catalog, known, 2)
    expect(two).toEqual([...unitRefs(1).slice(1), ...unitRefs(2)])
    expect(unitCount(catalog, two)).toBe(2)
  })

  it('fills by items, a minimum, with whole lessons only', async () => {
    const catalog = await loadCatalog()
    const groups = catalog.orderedGroups.map(entry => entry.group.units.map(unit => `${unit.kind}:${unit.ref.replace(/^[a-z]+:/, '')}`))
    const size = (at: number) => catalog.orderedGroups[at].group.units.length
    // N smaller than one group: the first group, whole
    const one = fillByItems(catalog, new Set(), 1)
    expect(one).toHaveLength(size(0))
    expect(unitCount(catalog, one)).toBe(1)
    // N spanning several groups: stops at the first group boundary at or past N, never mid-group
    for (const count of [5, 10, 15, 20]) {
      const refs = fillByItems(catalog, new Set(), count)
      expect(refs.length).toBeGreaterThanOrEqual(count)
      let taken = 0
      const boundaries: number[] = []
      for (let at = 0; taken < refs.length; at++) { taken += size(at); boundaries.push(taken) }
      expect(boundaries.at(-1)).toBe(refs.length)
      expect(boundaries.at(-2) ?? 0).toBeLessThan(count)
    }
    expect(groups.length).toBeGreaterThan(3)
    // grammar patterns come along and count as items; known items are skipped but the rest of a group stays whole
    const refs = fillByItems(catalog, new Set(), 10)
    expect(refs.some(ref => ref.startsWith('grammar:'))).toBe(true)
    const rest = fillByItems(catalog, new Set(refs), 3)
    expect(rest.some(ref => refs.includes(ref))).toBe(false)
    const partly = fillByItems(catalog, new Set([refs[0]]), 1)
    expect(partly).toEqual(refs.slice(1, size(0)))
  })

  it('writes the counts line with words first', () => {
    expect(describeCounts({ words: 312, grammar: 48 }, 220)).toBe('312 words · 48 grammar · 220 characters')
    expect(describeCounts({ words: 1, grammar: 0 }, 1)).toBe('1 word · 0 grammar · 1 character')
  })
})

describe('review sets', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 100 * DAY
  // Reviewed `ago` days ago with the given stability; due when its interval runs out.
  const card = (ref: string, ago: number, stability: number, due: number) => ({ ref, due: now + due * DAY, stability, difficulty: 5, reps: 3, lapses: 0, state: 'review' as const, lastReview: now - ago * DAY })

  it('takes the due cards, most overdue first, then fills with the lowest predicted recall', () => {
    const cards = [
      card('fresh', 1, 30, 29), card('due-late', 20, 10, -10), card('fading', 9, 10, 1), card('due', 11, 10, -1), card('middling', 5, 10, 5),
      { ...card('unlearned', 0, 0, 3), state: 'new' as const, lastReview: undefined },
    ]
    expect(pickReviews(cards, now, 4)).toEqual({ refs: ['due-late', 'due', 'fading', 'middling'], due: 2, dueTotal: 2, upcoming: 2 })
    expect(pickReviews(cards, now, 1)).toEqual({ refs: ['due-late'], due: 1, dueTotal: 2, upcoming: 0 })
    expect(pickReviews(cards, now, 20).refs).toEqual(['due-late', 'due', 'fading', 'middling', 'fresh'])
  })
})


describe('the review choice', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 100 * DAY
  const card = (ref: string, due: number) => ({ ref, due: now + due * DAY, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 'review' as const, lastReview: now - 5 * DAY })
  const twelveDue = Array.from({ length: 12 }, (_, index) => card('due' + index, -1 - index))
  const upcoming = Array.from({ length: 15 }, (_, index) => card('next' + index, 2 + index))
  beforeEach(() => localStorage.clear())

  it('never chosen: all due, however many', () => {
    expect(loadReviewCount()).toBe('all')
    const picked = pickReviews([...twelveDue, ...upcoming], now, loadReviewCount())
    expect(picked.refs).toHaveLength(12)
    expect(picked).toMatchObject({ due: 12, dueTotal: 12, upcoming: 0 })
  })
  it('nothing due: ten of the ones coming up next', () => {
    const picked = pickReviews(upcoming, now, 'all')
    expect(picked).toMatchObject({ due: 0, dueTotal: 0, upcoming: 10 })
    expect(picked.refs).toHaveLength(10)
  })
  it('all due stops at 200, the most a practice set can hold', () => {
    const many = Array.from({ length: 230 }, (_, index) => card('d' + index, -1 - index))
    expect(pickReviews(many, now, 'all')).toMatchObject({ due: 200, dueTotal: 230, upcoming: 0 })
  })
  it('a stored number keeps working, and is clamped as before', () => {
    saveReviewCount(5)
    expect(loadReviewCount()).toBe(5)
    expect(pickReviews([...twelveDue, ...upcoming], now, loadReviewCount()).refs).toHaveLength(5)
    localStorage.setItem(storageNames().local.reviewCount, '40')
    expect(loadReviewCount()).toBe(20)
  })
  it('a stored All due behaves like never having chosen', () => {
    saveReviewCount(5); saveReviewCount('all')
    expect(localStorage.getItem(storageNames().local.reviewCount)).toBe('all')
    expect(loadReviewCount()).toBe('all')
    localStorage.setItem(storageNames().local.reviewCount, 'junk')
    expect(loadReviewCount()).toBe(5)
  })
  it('a number above the due count: due first, then the ones coming up next', () => {
    const picked = pickReviews([...twelveDue.slice(0, 3), ...upcoming], now, 7)
    expect(picked).toMatchObject({ due: 3, dueTotal: 3, upcoming: 4 })
    expect(picked.refs.slice(0, 3)).toEqual(['due2', 'due1', 'due0'])
  })
})
