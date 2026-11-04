import { describe, expect, it } from 'vitest'
import { makeMatcher } from './dictionary-search'

describe('search speed', () => {
  it('ranks ~11k vocabulary units for several queries well inside a frame budget', () => {
    const syl = ['xue', 'sheng', 'da', 'cha', 'ka', 'fei', 'zhong', 'guo', 'ren', 'shi']
    const units = Array.from({ length: 11000 }, (_, i) => ({ ch: '字' + i, pr: [0, 1, 2].map(k => syl[(i + k * 3) % 10] + ((i + k) % 4 + 1)).join(' '), ds: 'meaning number ' + i + '; another sense' }))
    for (const query of ['sheng', 'sheng1', 'daxuesheng', 'da4 xue2', 'student', 'meaning number 42']) {
      const matcher = makeMatcher(query)
      const t = performance.now()
      let hits = 0
      for (const unit of units) if (matcher.rank({ text: [unit.ch], pr: unit.pr, ds: unit.ds }) !== undefined) hits++
      const ms = performance.now() - t
      expect(ms, query + ' took ' + ms.toFixed(0) + 'ms for ' + hits + ' hits').toBeLessThan(500)
    }
  })
})
