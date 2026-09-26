import { describe, expect, it } from 'vitest'
import { makeStrokeGuide, matchesStroke, writingPoint, type Point } from './geometry'
import { advanceRound, commitStroke, memoryHint, newWritingRound, REPETITIONS } from './practice'

describe('exact-path writing geometry', () => {
  it('samples line endpoints at spacing two and retains the displayed path', () => {
    const guide = makeStrokeGuide('M10 50 L20 50')
    expect(guide.path).toBe('M10 50 L20 50')
    expect(guide.points).toEqual([[10, 50], [12, 50], [14, 50], [16, 50], [18, 50], [20, 50]])
    expect(matchesStroke(guide.points, guide)).toBe(true)
    expect(matchesStroke([...guide.points].reverse(), guide)).toBe(false)
  })
  it.each(['M10 10 Q50 90 90 10', 'M10 20 C30 80 70 80 90 20', 'M20 10 L20 80 Q20 90 10 80'])('matches the actual Bezier guide %s', path => {
    const guide = makeStrokeGuide(path)
    expect(matchesStroke(guide.points, guide)).toBe(true)
    expect(matchesStroke([...guide.points].reverse(), guide)).toBe(false)
  })
  it('accepts corrected tiny dots but not reversed dots, taps or remote strokes', () => {
    const guide = makeStrokeGuide('M40 40 L43 43')
    expect(matchesStroke([[39, 40], [42, 43]], guide)).toBe(true)
    expect(matchesStroke([...guide.points].reverse(), guide)).toBe(false)
    expect(matchesStroke([[40, 40], [40, 40]], guide)).toBe(false)
    expect(matchesStroke([[10, 10], [20, 20]], guide)).toBe(false)
  })
  it('rejects shortcuts, scribbles, backward travel and nonfinite input', () => {
    const guide = makeStrokeGuide('M10 10 L10 90 L90 90')
    for (const stroke of [
      [[10, 10], [90, 90]], [[10, 10], [90, 10], [10, 90], [90, 90]],
      [[10, 10], [10, 80], [10, 20], [10, 90], [90, 90]], [[NaN, 10], [90, 90]],
    ] as Point[][]) expect(matchesStroke(stroke, guide)).toBe(false)
    expect(matchesStroke([], guide)).toBe(false)
  })
  it.each(['M10 10', 'M0 0 L0 0', 'M0 0 L101 10', 'm0 0 l10 10', 'M0 0 L10 10 M20 20 L30 30', 'M0 0 C2 3 NaN 4 5 6', '<svg/>'])('rejects unsupported canonical input %s', path => {
    expect(() => makeStrokeGuide(path)).toThrow()
  })
  it('maps wide and tall viewports to the centered square without stretching', () => {
    expect(writingPoint(210, 120, { left: 10, top: 20, width: 400, height: 200 })).toEqual([50, 50])
    expect(writingPoint(110, 220, { left: 10, top: 20, width: 200, height: 400 })).toEqual([50, 50])
    expect(() => writingPoint(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toThrow()
  })
})

describe('three-phase writing rounds', () => {
  const guides = [makeStrokeGuide('M10 20 L90 20'), makeStrokeGuide('M50 10 L50 90')]
  const miss: Point[] = [[0, 0], [1, 1]]
  it('only reveals the current memory stroke after two committed misses', () => {
    let round = { ...newWritingRound(), phase: 2 }
    round = commitStroke(round, miss, guides)
    expect(memoryHint(round)).toBe(false)
    round = commitStroke(round, miss, guides)
    expect(memoryHint(round)).toBe(true)
    round = commitStroke(round, guides[0].points, guides)
    expect(round.completed).toBe(1)
    expect(memoryHint(round)).toBe(false)
    expect(memoryHint({ ...round, completed: 0 })).toBe(true)
  })
  it('requires all strokes and all nine repetitions; new repetitions clear misses', () => {
    let round = newWritingRound()
    expect(advanceRound(round, 2)).toBe(round)
    for (let phase = 0; phase < 3; phase++) {
      for (let repetition = 0; repetition < REPETITIONS; repetition++) {
        expect([round.phase, round.repetition]).toEqual([phase, repetition])
        expect(round.misses).toEqual([])
        round = commitStroke(round, guides[0].points, guides)
        expect(advanceRound(round, 2)).toBe(round)
        round = commitStroke(round, guides[1].points, guides)
        round = advanceRound(round, 2)
      }
    }
    expect(round.finished).toBe(true)
    expect(commitStroke(round, miss, guides)).toBe(round)
  })
})
