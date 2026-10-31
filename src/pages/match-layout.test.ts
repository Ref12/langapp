import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom does no layout, so the equal-cell rules are asserted on the stylesheet that the lesson and Drills boards share.
const css = readFileSync('src/App.css', 'utf8')
const rule = (selector: string) => css.split('\n').find(line => line.startsWith(selector + ' {')) ?? ''

describe('match board layout', () => {
  it('is a two-column grid of equal rows with uniform cells', () => {
    const board = rule('.match-board')
    expect(board).toContain('repeat(2, minmax(0, 1fr))')
    expect(board).toContain('grid-template-rows: repeat(var(--match-rows')
    expect(board).toContain('1fr)')
    expect(rule('.match-column')).toContain('display: contents')
    expect(rule('.match-cell')).toMatch(/width: 100%; height: 100%/)
  })
  it('clamps long English glosses to three lines', () => {
    expect(css).toMatch(/\.match-cell \.match-gloss \{[^}]*-webkit-line-clamp: 3/)
    expect(css).toMatch(/\.match-cell \.match-gloss \{[^}]*overflow: hidden/)
  })
})
