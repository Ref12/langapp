/*
 * MODIFIED 2026-09-14: Monoline adaptation of Hanzi Writer Data 2.0.1, shared by
 * the comparison and five reviewed writing-exercise characters.
 * Fit reviewed stroke bodies, project brush endpoints onto their tangents,
 * and round bends without changing stroke order or rescaling the character.
 * Added geometry-based compact-hook and short-fall terminal rules, with bounded
 * round-cap compensation. Unmatched and compound strokes keep their geometry.
 * Recipes select source samples; they do not substitute hand-drawn coordinates.
 *
 * Generated artwork remains under the ARPHIC PUBLIC LICENSE, with no warranty.
 * Copyright (C) 1999 Arphic Technology Co., Ltd.; via Make Me a Hanzi and
 * Hanzi Writer. See character-data.js for provenance and
 * character-data-LICENSE.txt for the complete license.
 */

// Entry cleanup remains reviewed. Terminal corrections below use geometry,
// not character IDs, and retain a recognizable return rather than remove hooks.
const characterMonolineRecipes = {
  '\u8336': [
    { shape: 'line', from: 1, to: 4 },
    { shape: 'line', from: 2 },
    { shape: 'line', from: 2 },
    { shape: 'curve', from: 1 },
    { shape: 'curve' },
    { shape: 'line', from: 1, to: 3 },
    { shape: 'bend', from: 1 },
    { shape: 'curve' },
    { shape: 'curve' },
  ],
  '\u96e8': [
    { shape: 'line', from: 2, to: 4 },
    { shape: 'line', from: 2, to: 4 },
    { shape: 'bend', from: 2 },
    { shape: 'line', from: 2, to: 4 },
    { shape: 'curve' },
    { shape: 'curve' },
    { shape: 'curve' },
    { shape: 'curve' },
  ],
  '\u676f': [
    { shape: 'line', from: 1, to: 4 },
    { shape: 'line', from: 1, to: 3 },
    { shape: 'curve' },
    { shape: 'curve', from: 1 },
    { shape: 'line', from: 1, to: 3 },
    { shape: 'curve', from: 2 },
    { shape: 'line', from: 2, to: 4 },
    { shape: 'curve' },
  ],
  '\u4eba': [
    { shape: 'curve', from: 2 },
    { shape: 'curve' },
  ],
  '\u4e00': [{ shape: 'line', from: 1, to: 3 }],
}

function monolineDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function monolineProject(point, origin, direction) {
  const offset = (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1]
  return origin.map((value, axis) => value + offset * direction[axis])
}

function monolineDirection(a, b) {
  const length = monolineDistance(a, b)
  if (length === 0) throw new Error('A monoline stroke needs distinct source points.')
  return b.map((value, axis) => (value - a[axis]) / length)
}

function monolineCoordinates(point) {
  return point.map((value) => Number(value.toFixed(3))).join(' ')
}

function monolineLinePoints(points, endpoints) {
  const center = [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length)
  let xx = 0, xy = 0, yy = 0
  for (const point of points) {
    const x = point[0] - center[0], y = point[1] - center[1]
    xx += x * x
    xy += x * y
    yy += y * y
  }
  // Orthogonal line fitting preserves near-vertical strokes as well as the
  // original rising bars. Never snap a fitted direction to a horizontal axis.
  const angle = Math.atan2(2 * xy, xx - yy) / 2
  const direction = [Math.cos(angle), Math.sin(angle)]
  return endpoints.map((point) => monolineProject(point, center, direction))
}

function monolineLine(points, endpoints) {
  const [start, end] = monolineLinePoints(points, endpoints)
  return `M${monolineCoordinates(start)} L${monolineCoordinates(end)}`
}

function monolineLength(points) {
  return points.slice(1).reduce((length, point, index) => length + monolineDistance(points[index], point), 0)
}

function monolinePrefix(points, length) {
  const result = [[...points[0]]]
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1], point = points[index]
    const segment = monolineDistance(before, point)
    if (length < segment) {
      if (length > 0) result.push(before.map((value, axis) => value + (point[axis] - value) * length / segment))
      break
    }
    result.push([...point])
    length -= segment
  }
  return result
}

function correctMonolineTerminals(points, width = 5.5) {
  if (!Number.isFinite(width) || width < 3 || width > 7) throw new Error('Monoline pen width must be between 3 and 7.')
  const unchanged = { points, rule: null }
  const start = points[0], end = points.at(-1)
  const peakIndex = points.reduce((peak, point, index) => point[1] > points[peak][1] ? index : peak, 0)

  // A mostly vertical, descending shaft followed by a short up-left return.
  // Horizontal enclosures, sweeping curves and multi-turn strokes fail these
  // gates. Their hooks cannot safely be inferred from a terminal reversal alone.
  if (peakIndex > 0 && peakIndex < points.length - 1) {
    const shaft = points.slice(0, peakIndex + 1), tail = points.slice(peakIndex)
    const peak = points[peakIndex], height = peak[1] - start[1]
    const spread = Math.max(...shaft.map(([x]) => x)) - Math.min(...shaft.map(([x]) => x))
    const descending = shaft.slice(1).every((point, index) => point[1] >= shaft[index][1])
    const returning = tail.slice(1).every((point, index) => point[0] < tail[index][0] && point[1] < tail[index][1])
    const tailLength = monolineLength(tail)
    if (height >= 18 && spread <= height * 0.22 && descending && returning
      && monolineLength(shaft) <= height * 1.12 && tailLength <= height * 0.45
      && peak[0] - end[0] >= 2 && peak[1] - end[1] >= 1) {
      const target = Math.max(width * 0.6, height * 0.18 - width / 2)
      if (tailLength > target + 0.5) {
        return { points: [...shaft.slice(0, -1), ...monolinePrefix(tail, target)], rule: 'compact-hook' }
      }
    }
  }

  // A short, monotone down-right stroke is a candidate, not a semantic claim
  // that it is a dot. Long falls, steep stems, reversals and corners are excluded.
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const length = monolineLength(points), chord = monolineDistance(start, end)
  const falling = points.slice(1).every((point, index) => point[0] >= points[index][0] && point[1] >= points[index][1])
  if (dx < 2 || dy < 2 || dy / dx < 0.25 || dy / dx > 2 || !falling
    || length < 6 || length > 22 || chord / length < 0.9) return unchanged

  const body = monolinePrefix(points, length * 0.65)
  const fitted = monolineLinePoints(body, [start, end])
  const direction = monolineDirection(...fitted)
  const deviation = Math.max(...points.map((point) => monolineDistance(point, monolineProject(point, fitted[0], direction))))
  if (deviation > Math.min(3, chord * 0.2)) return unchanged
  // Keep at least 35% of the centerline even for tiny dots and a thick pen.
  const inset = Math.min(width / 2, monolineDistance(...fitted) * 0.325)
  return {
    points: fitted.map((point, index) => point.map((value, axis) => value + direction[axis] * inset * (index === 0 ? 1 : -1))),
    rule: 'short-fall',
  }
}

function monolineRoundedBends(points) {
  let path = `M${monolineCoordinates(points[0])}`
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1], corner = points[index], after = points[index + 1]
    const incoming = monolineDirection(corner, before), outgoing = monolineDirection(corner, after)
    const radius = Math.min(3, monolineDistance(before, corner) * 0.45, monolineDistance(corner, after) * 0.45)
    const entry = corner.map((value, axis) => value + incoming[axis] * radius)
    const exit = corner.map((value, axis) => value + outgoing[axis] * radius)
    path += ` L${monolineCoordinates(entry)} Q${monolineCoordinates(corner)} ${monolineCoordinates(exit)}`
  }
  return `${path} L${monolineCoordinates(points.at(-1))}`
}

function monolineCurve(points) {
  if (points.length === 2) return `M${monolineCoordinates(points[0])} L${monolineCoordinates(points[1])}`
  const offsets = [0]
  for (let index = 1; index < points.length; index++) {
    offsets.push(offsets.at(-1) + monolineDistance(points[index - 1], points[index]))
  }
  const start = points[0], end = points.at(-1), length = offsets.at(-1)
  const numerator = [0, 0]
  let denominator = 0
  const samples = points.slice(1, -1).map((point, index) => {
    const t = offsets[index + 1] / length
    const weight = 2 * t * (1 - t)
    for (const axis of [0, 1]) {
      numerator[axis] += weight * (point[axis] - (1 - t) ** 2 * start[axis] - t ** 2 * end[axis])
    }
    denominator += weight * weight
    return { point, t }
  })
  const control = numerator.map((value) => value / denominator)
  const error = Math.max(...samples.map(({ point, t }) => monolineDistance(point,
    start.map((value, axis) => (1 - t) ** 2 * value + 2 * t * (1 - t) * control[axis] + t ** 2 * end[axis]))))
  // Reject a broad fit if it erases a turn or overshoots the source envelope.
  const bounded = control.every((value, axis) => value >= Math.min(...points.map((point) => point[axis])) - 2
    && value <= Math.max(...points.map((point) => point[axis])) + 2)
  if (error > 2 || !bounded) return monolineRoundedBends(points)
  return `M${monolineCoordinates(start)} Q${monolineCoordinates(control)} ${monolineCoordinates(end)}`
}

function characterMonolineStroke(median, recipe, { width = 5.5, correctTerminals = true } = {}) {
  const from = recipe.from ?? 0, to = recipe.to ?? median.length - 1
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= median.length || to <= from) {
    throw new Error('Invalid reviewed monoline stroke span.')
  }
  const points = median.slice(from, to + 1).map((point) => [...point])
  const endpoints = [median[0], median.at(-1)]
  if (recipe.shape === 'line') return { path: monolineLine(points, endpoints), rule: null }
  const startDirection = monolineDirection(points[0], points[1])
  const endDirection = monolineDirection(points.at(-2), points.at(-1))
  if (from > 0) points[0] = monolineProject(endpoints[0], points[0], startDirection)
  if (to < median.length - 1) points[points.length - 1] = monolineProject(endpoints[1], points.at(-1), endDirection)
  const corrected = correctTerminals ? correctMonolineTerminals(points, width) : { points, rule: null }
  if (recipe.shape === 'curve' || recipe.shape === 'bend') {
    const path = corrected.rule === 'short-fall' ? monolineLine(corrected.points, corrected.points)
      : recipe.shape === 'curve' ? monolineCurve(corrected.points) : monolineRoundedBends(corrected.points)
    return { path, rule: corrected.rule }
  }
  throw new Error(`Unknown monoline stroke shape: ${recipe.shape}`)
}

function characterMonolinePath(median, recipe, options) {
  return characterMonolineStroke(median, recipe, options).path
}

function makeCharacterMonolineStrokes(native, options) {
  const recipes = characterMonolineRecipes[native]
  const medians = characterStrokeData[native]
  if (!recipes || !medians || recipes.length !== medians.length) {
    throw new Error(`No complete reviewed monoline recipe for ${native}.`)
  }
  return medians.map((median, index) => characterMonolineStroke(median, recipes[index], options))
}

function makeCharacterMonolinePaths(native, options) {
  return makeCharacterMonolineStrokes(native, options).map((stroke) => stroke.path)
}

function characterWritingPaths(native) {
  if (!Object.hasOwn(characterStrokeData, native)) throw new Error(`No writing stroke data for ${native}.`)
  // Unreviewed characters retain the existing renderer, not an automatic
  // conversion inferred from bulk terminal candidates.
  return Object.hasOwn(characterMonolineRecipes, native)
    ? makeCharacterMonolinePaths(native, { width: 5.5, correctTerminals: true })
    : characterStrokeData[native].map(characterPath)
}
