// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./character-data.js', import.meta.url), 'utf8')
const legacy = readFileSync(new URL('./character-geometry.js', import.meta.url), 'utf8')
const geometry = readFileSync(new URL('./character-monoline.js', import.meta.url), 'utf8')
const { data, recipes, makePaths, makePath, correct, length, writingPaths, legacyPath } = runInNewContext(`${source}\n${legacy}\n${geometry}
;({ data: characterStrokeData, recipes: characterMonolineRecipes,
makePaths: makeCharacterMonolinePaths, makePath: characterMonolinePath,
correct: correctMonolineTerminals, length: monolineLength,
writingPaths: characterWritingPaths, legacyPath: characterPath })`)

function pathPoints(path) {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number)
  return Array.from({ length: numbers.length / 2 }, (_, index) => numbers.slice(index * 2, index * 2 + 2))
}

describe('comparison monoline geometry', () => {
  it.each(Object.keys(recipes))('preserves stroke count, order, and source coordinates for %s', (native) => {
    const before = JSON.stringify(data[native])
    const paths = makePaths(native)
    expect(paths).toHaveLength(data[native].length)
    paths.forEach((path, index) => {
      expect(path).toBe(makePath(data[native][index], recipes[native][index]))
      expect(path).toMatch(/^M/)
      expect(path).not.toMatch(/[CZ]|NaN|Infinity/)
      const points = pathPoints(path)
      expect(points.length).toBeGreaterThanOrEqual(2)
      for (const point of points) {
        for (const coordinate of point) {
          expect(coordinate).toBeGreaterThanOrEqual(0)
          expect(coordinate).toBeLessThanOrEqual(100)
        }
      }
      const start = points[0], end = points.at(-1)
      const original = data[native][index]
      const dx = original.at(-1)[0] - original[0][0], dy = original.at(-1)[1] - original[0][1]
      expect((end[0] - start[0]) * dx + (end[1] - start[1]) * dy).toBeGreaterThan(0)
      for (const [actual, expected] of [[start, original[0]], [end, original.at(-1)]]) {
        expect(Math.hypot(actual[0] - expected[0], actual[1] - expected[1])).toBeLessThan(8)
      }
    })
    expect(JSON.stringify(data[native])).toBe(before)
    expect(makePaths(native)).toEqual(paths)
  })

  it('retains rising bars and opposite stem slants rather than D symmetry', () => {
    const tea = makePaths('\u8336').map(pathPoints)
    for (const index of [0, 5]) {
      expect(tea[index].at(-1)[0]).toBeGreaterThan(tea[index][0][0])
      expect(tea[index].at(-1)[1]).toBeLessThan(tea[index][0][1] - 2)
    }
    expect(tea[1].at(-1)[0]).toBeGreaterThan(tea[1][0][0] + 2)
    expect(tea[2].at(-1)[0]).toBeLessThan(tea[2][0][0] - 2)
    expect(tea[4].at(-1)[1]).toBeLessThan(tea[3].at(-1)[1] - 3)
  })

  it('retains the previous full hook when terminal refinement is disabled', () => {
    const points = pathPoints(makePaths('\u8336', { correctTerminals: false })[6])
    expect(Math.abs(points[0][0] - 50)).toBeLessThan(1)
    expect(Math.min(...points.slice(0, 3).map(([x]) => x))).toBeGreaterThan(49)
    expect(Math.max(...points.map(([, y]) => y))).toBeGreaterThan(81)
    expect(points.at(-1)[0]).toBeCloseTo(data['\u8336'][6].at(-1)[0], 2)
    expect(points.at(-1)[1]).toBeCloseTo(data['\u8336'][6].at(-1)[1], 2)
    expect(points.at(-1)[0]).toBeLessThan(points[0][0] - 8)
  })

  it('preserves both the turn and terminal hook of the rain enclosure', () => {
    const points = pathPoints(makePaths('\u96e8')[2])
    expect(Math.max(...points.map(([x]) => x))).toBeGreaterThan(80)
    expect(Math.max(...points.map(([, y]) => y))).toBeGreaterThan(77)
    expect(points.at(-1)[0]).toBeLessThan(65)
    expect(points.at(-1)[1]).toBeLessThan(75)
  })

  it('retains the previous dot curves when terminal refinement is disabled', () => {
    makePaths('\u96e8', { correctTerminals: false }).slice(4).forEach((path, index) => {
      const points = pathPoints(path), median = data['\u96e8'][index + 4]
      for (const axis of [0, 1]) {
        expect(points[0][axis]).toBeCloseTo(median[0][axis], 2)
        expect(points.at(-1)[axis]).toBeCloseTo(median.at(-1)[axis], 2)
      }
    })
  })

  describe('reusable terminal corrections', () => {
    it('compacts the tea hook while preserving its shaft, bottom turn, and upward return', () => {
      const median = data['\u8336'][6]
      const result = correct(median)
      expect(result.rule).toBe('compact-hook')
      expect(result.points.slice(0, 4)).toEqual(median.slice(0, 4))
      const peak = result.points[3], end = result.points.at(-1)
      expect(end[0]).toBeLessThan(peak[0] - 2)
      expect(end[1]).toBeLessThan(peak[1] - 1)
      expect(length(result.points.slice(3))).toBeLessThan(length(median.slice(3)) * 0.5)
      const oldPoints = pathPoints(makePaths('\u8336', { correctTerminals: false })[6])
      const newPoints = pathPoints(makePaths('\u8336')[6])
      expect(newPoints[0]).toEqual(oldPoints[0])
      expect(newPoints.at(-1)[0]).toBeGreaterThan(oldPoints.at(-1)[0] + 4)
    })

    it('makes the final tea dot straighter and smaller without losing its main slant', () => {
      const median = data['\u8336'][8]
      const result = correct(median)
      expect(result.rule).toBe('short-fall')
      expect(result.points).toHaveLength(2)
      const [start, end] = result.points
      const slope = (end[1] - start[1]) / (end[0] - start[0])
      const bodySlope = (median[1][1] - median[0][1]) / (median[1][0] - median[0][0])
      expect(slope).toBeCloseTo(bodySlope, 2)
      expect(end[1]).toBeLessThan(median.at(-1)[1] - 3)
      expect(length(result.points) + 5.5).toBeLessThan(length(median))
      expect(makePaths('\u8336')[8]).toMatch(/^M[\d. ]+ L[\d. ]+$/)
    })

    it.each([
      [[10, 10], [70, 10], [70, 80], [55, 70]],
      [[20, 20], [21, 40]],
      [[20, 40], [40, 35]],
      [[50, 20], [35, 45], [10, 70]],
      [[10, 10], [50, 50], [90, 70]],
      [[20, 20], [28, 20], [28, 28]],
      [[20, 20], [30, 32], [26, 28]],
      [[20, 20], [22, 22]],
    ])('leaves ambiguous, long, compound, or non-falling geometry unchanged: %j', (...points) => {
      expect(correct(points).rule).toBeNull()
      expect(correct(points).points).toEqual(points)
    })

    it('uses the same geometric rules on translated strokes and other characters', () => {
      for (const median of [data['\u8336'][6], data['\u8336'][8]]) {
        const original = correct(median)
        const translated = correct(median.map(([x, y]) => [x + 3, y + 2]))
        expect(translated.rule).toBe(original.rule)
        translated.points.forEach((point, index) => {
          expect(point[0]).toBeCloseTo(original.points[index][0] + 3)
          expect(point[1]).toBeCloseTo(original.points[index][1] + 2)
        })
      }
      expect(correct(data['\u5c0f'][0]).rule).toBe('compact-hook')
      expect(correct(data['\u96e8'][4]).rule).toBe('short-fall')
      expect(correct(data['\u96e8'][2]).rule).toBeNull()
    })

    it.each([3, 5.5, 7])('runs conservatively across all 798 source strokes at width %s', (width) => {
      const before = JSON.stringify(data)
      const counts = { 'compact-hook': 0, 'short-fall': 0, unchanged: 0 }
      for (const median of Object.values(data).flat()) {
        const result = correct(median, width)
        counts[result.rule || 'unchanged']++
        expect(result.points.length).toBeGreaterThanOrEqual(2)
        expect(length(result.points)).toBeGreaterThan(0)
        expect(length(result.points)).toBeLessThanOrEqual(length(median) + 1e-8)
        for (const point of result.points) {
          for (const coordinate of point) {
            expect(Number.isFinite(coordinate)).toBe(true)
            expect(coordinate).toBeGreaterThanOrEqual(0)
            expect(coordinate).toBeLessThanOrEqual(100)
          }
        }
        if (!result.rule) expect(result.points).toEqual(median)
      }
      expect(counts['compact-hook']).toBeGreaterThan(0)
      expect(counts['short-fall']).toBeGreaterThan(0)
      expect(counts.unchanged).toBeGreaterThan(700)
      expect(JSON.stringify(data)).toBe(before)
    })

    it('bounds cap insets for small dots even at the thickest pen setting', () => {
      const points = [[20, 20], [25, 24]]
      for (const width of [3, 5.5, 7]) {
        const result = correct(points, width)
        expect(result.rule).toBe('short-fall')
        expect(length(result.points)).toBeGreaterThanOrEqual(length(points) * 0.35 - 1e-8)
      }
      expect(() => correct(points, 0)).toThrow('pen width')
      expect(() => correct(points, NaN)).toThrow('pen width')
    })
  })

  it('fits a slanted line without normalizing its position or length', () => {
    const median = [[20, 30], [40, 25], [80, 15]]
    expect(makePath(median, { shape: 'line' })).toBe('M20 30 L80 15')
    expect(makePath([[42, 12], [44, 50], [46, 88]], { shape: 'line' })).toBe('M42 12 L46 88')
  })

  it('bounds sharp bends instead of interpolating beyond their anchors', () => {
    const path = makePath([[10, 10], [70, 10], [70, 80], [55, 70]], { shape: 'bend' })
    for (const [x, y] of pathPoints(path)) {
      expect(x).toBeGreaterThanOrEqual(10)
      expect(x).toBeLessThanOrEqual(70)
      expect(y).toBeGreaterThanOrEqual(10)
      expect(y).toBeLessThanOrEqual(80)
    }
    expect(path).toContain('Q70 10')
    expect(path).toContain('Q70 80')
  })

  it('rejects unreviewed characters or malformed recipes instead of inventing geometry', () => {
    expect(() => makePaths('\u6c34')).toThrow('No complete reviewed monoline recipe')
    expect(() => makePath([[1, 2], [3, 4]], { shape: 'line', from: 1 })).toThrow('Invalid reviewed')
    expect(() => makePath([[1, 2], [3, 4]], { shape: 'unknown' })).toThrow('Unknown monoline')
  })

  describe('writing-exercise artwork selection', () => {
    it.each(Object.keys(recipes))('uses the approved corrected paths for %s', (native) => {
      expect(writingPaths(native)).toEqual(makePaths(native, { width: 5.5, correctTerminals: true }))
    })

    it('keeps all 105 other bundled characters available with unchanged paths', () => {
      const unreviewed = Object.keys(data).filter((native) => !Object.hasOwn(recipes, native))
      expect(unreviewed).toHaveLength(105)
      for (const native of unreviewed) {
        expect(writingPaths(native)).toEqual(data[native].map(legacyPath))
      }
    })

    it('fails on missing source data or incomplete approved recipes instead of silently changing style', () => {
      expect(() => writingPaths('\u6c34')).toThrow('No writing stroke data')
      const recipe = recipes['\u8336'].pop()
      try {
        expect(() => writingPaths('\u8336')).toThrow('No complete reviewed monoline recipe')
      } finally {
        recipes['\u8336'].push(recipe)
      }
    })
  })
})
