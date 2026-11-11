import { describe, expect, it } from 'vitest'
import { makeStrokeGuide, type Point } from './geometry'
import { completeTracedStroke, commitStroke, newWritingRound, tracerStroke } from './practice'
import { advanceTrace, TRACER_LOOKAHEAD, TRACER_MISSES, TRACER_REACH, tracedPoints, tracerPosition, traceComplete } from './tracer'

const line = makeStrokeGuide('M10 50 L90 50')
const bend = makeStrokeGuide('M10 10 L10 90 L90 90')

describe('tracer projection', () => {
  it('projects a pointer onto the path as a length along it', () => {
    expect(tracerPosition([30, 50], line, 0)).toBeCloseTo(20)
    expect(tracerPosition([30, 58], line, 0)).toBeCloseTo(20)
    expect(tracerPosition([10, 10], bend, 0)).toBeCloseTo(0)
    expect(tracerPosition([10, 40], bend, 20)).toBeCloseTo(30)
    expect(tracerPosition([50, 90], bend, 100)).toBeCloseTo(120)
  })
  it('is more permissive than Relaxed matching and gives up beyond its reach', () => {
    expect(TRACER_REACH).toBeGreaterThan(11 * 2)
    expect(tracerPosition([30, 50 + TRACER_REACH - 1], line, 0)).toBeCloseTo(20)
    expect(tracerPosition([30, 50 + TRACER_REACH + 1], line, 0)).toBeUndefined()
    expect(tracerPosition([NaN, 50], line, 0)).toBeUndefined()
  })
  it('does not jump far ahead of the traced part', () => {
    expect(advanceTrace(0, [90, 50], line)).toBe(0)
    expect(advanceTrace(0, [10 + TRACER_LOOKAHEAD, 50], line)).toBeCloseTo(TRACER_LOOKAHEAD)
  })
  it('draws the path up to the progress', () => {
    expect(tracedPoints(line, 0)).toEqual([])
    const part = tracedPoints(bend, 100)
    expect(part[0]).toEqual([10, 10])
    expect(part[part.length - 1]).toEqual([30, 90])
    expect(tracedPoints(line, 1000).pop()).toEqual([90, 50])
  })
})

describe('tracer progress', () => {
  const drag = (progress: number, points: Point[], guide = line) => points.reduce((value, point) => advanceTrace(value, point, guide), progress)
  it('keeps progress between drags and only moves forward', () => {
    let progress = drag(0, [[10, 50], [25, 50], [40, 50]])
    expect(progress).toBeCloseTo(30)
    progress = drag(progress, [[15, 50], [20, 52]])
    expect(progress).toBeCloseTo(30)
    progress = drag(progress, [[40, 50], [50, 50], [55, 45]])
    expect(progress).toBeCloseTo(45)
    expect(progress).toBeLessThan(80)
  })
  it('completes at the end, within the tolerance, over several drags', () => {
    let progress = drag(0, [[10, 50], [35, 50]])
    progress = drag(progress, [[40, 50], [55, 50]])
    expect(traceComplete(progress, line)).toBe(false)
    progress = drag(progress, [[55, 50], [75, 50]])
    expect(traceComplete(progress, line)).toBe(true)
    expect(traceComplete(line.length - 17, line)).toBe(false)
    expect(traceComplete(line.length - 14, line)).toBe(true)
  })
  it('does nothing while the pointer is off the path', () => {
    const progress = drag(0, [[10, 50], [30, 50]])
    expect(drag(progress, [[40, 90], [60, 10], [80, 0]])).toBe(progress)
  })
  it('follows a bend', () => {
    const progress = drag(0, [[10, 10], [10, 30], [10, 50], [10, 70], [10, 85], [30, 90], [55, 90], [80, 89]], bend)
    expect(traceComplete(progress, bend)).toBe(true)
  })
})

describe('tracer in the round', () => {
  const miss: Point[] = [[0, 0], [1, 1]]
  it('turns on at the third miss of the same stroke, in any phase, and is off for the next stroke', () => {
    const two = [makeStrokeGuide('M10 30 L90 30'), makeStrokeGuide('M10 70 L90 70')]
    let round = newWritingRound()
    for (let count = 1; count < TRACER_MISSES; count++) { round = commitStroke(round, miss, two); expect(tracerStroke(round)).toBe(false) }
    round = commitStroke(round, miss, two)
    expect(tracerStroke(round)).toBe(true)
    expect(round.feedback).toMatch(/Tracer on/)
    expect(round.completed).toBe(0)
    round = completeTracedStroke(round, two)
    expect(round.completed).toBe(1)
    expect(tracerStroke(round)).toBe(false)
  })
  it('does not count misses of different strokes together, and a traced stroke is helped', () => {
    const two = [makeStrokeGuide('M10 30 L90 30'), makeStrokeGuide('M10 70 L90 70')]
    let round = newWritingRound()
    round = commitStroke(round, miss, two); round = commitStroke(round, miss, two)
    round = commitStroke(round, [[10, 30], [90, 30]], two)
    round = commitStroke(round, miss, two)
    expect(tracerStroke(round)).toBe(false)
    expect(round.helped).toBe(false)
    expect(completeTracedStroke(round, two)).toBe(round)
    for (let count = 0; count < 2; count++) round = commitStroke(round, miss, two)
    expect(tracerStroke(round)).toBe(true)
    round = completeTracedStroke(round, two)
    expect(round.helped).toBe(true)
    expect(round.completed).toBe(2)
  })
})
