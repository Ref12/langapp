export type Point = [number, number]
export interface StrokeGuide { path: string; points: Point[]; length: number }

export const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])
export const strokeLength = (points: Point[]): number => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)

const number = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?'
const tokens = new RegExp(`[MLQC]|${number}`, 'g')
const arity: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6 }

/** Same 32-subdivision Bezier / spacing-2 sampler as the offline asset contract. */
export function makeStrokeGuide(path: string): StrokeGuide {
  if (!path || path.length > 100_000 || path.replace(tokens, '').replace(/[\s,]/g, '')) throw new Error('Unsupported writing path.')
  const parts = path.match(tokens) ?? []
  const polyline: Point[] = []
  let offset = 0
  while (offset < parts.length) {
    const op = parts[offset++]
    const count = arity[op]
    if (!count || (!polyline.length && op !== 'M') || (polyline.length && op === 'M')) throw new Error('Writing paths must be continuous.')
    const values = parts.slice(offset, offset + count).map(Number)
    if (values.length !== count || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error('Invalid writing coordinates.')
    offset += count
    const controls: Point[] = []
    for (let index = 0; index < values.length; index += 2) controls.push([values[index], values[index + 1]])
    if (op === 'M' || op === 'L') polyline.push(controls[0])
    else {
      const start = polyline[polyline.length - 1]
      for (let step = 1; step <= 32; step++) {
        const t = step / 32
        let work = [start, ...controls]
        while (work.length > 1) work = work.slice(1).map((end, index) => [
          work[index][0] * (1 - t) + end[0] * t, work[index][1] * (1 - t) + end[1] * t,
        ])
        polyline.push(work[0])
      }
    }
  }
  const length = strokeLength(polyline)
  if (length < 0.000001) throw new Error('Writing strokes must have length.')
  const steps = Math.ceil(length / 2)
  const offsets = [0]
  for (let index = 1; index < polyline.length; index++) offsets.push(offsets[index - 1] + distance(polyline[index - 1], polyline[index]))
  const points: Point[] = []
  let segment = 1
  for (let index = 0; index <= steps; index++) {
    const progress = length * index / steps
    while (segment < offsets.length - 1 && offsets[segment] <= progress) segment++
    const span = offsets[segment] - offsets[segment - 1]
    const t = span ? (progress - offsets[segment - 1]) / span : 0
    const coordinate = (axis: number) => Number((polyline[segment - 1][axis] * (1 - t) + polyline[segment][axis] * t).toFixed(6))
    points.push([coordinate(0), coordinate(1)])
  }
  return { path, points, length }
}

export function sampleStroke(points: Point[]): Point[] {
  if (!points.length) return []
  const result = [points[0]]
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index]
    const steps = Math.max(1, Math.ceil(distance(start, end) / 2))
    for (let step = 1; step <= steps; step++) result.push([
      start[0] + (end[0] - start[0]) * step / steps,
      start[1] + (end[1] - start[1]) * step / steps,
    ])
  }
  return result
}

/** Lenient tracing feedback, not handwriting recognition or a mastery assessment. */
export function matchesStroke(stroke: Point[], guide: StrokeGuide): boolean {
  if (stroke.length < 2 || stroke.some(point => point.some(value => !Number.isFinite(value)))) return false
  const expected = guide.points
  const start = expected[0], end = expected[expected.length - 1]
  const first = stroke[0], last = stroke[stroke.length - 1]
  const tolerance = Math.min(10, Math.max(5.5, guide.length * 0.45))
  if (distance(first, start) > tolerance || distance(last, end) > tolerance) return false
  const length = strokeLength(stroke)
  if (length < guide.length * 0.4 || length > guide.length * 2.2 + 4) return false
  const dx = end[0] - start[0], dy = end[1] - start[1]
  if ((last[0] - first[0]) * dx + (last[1] - first[1]) * dy < (dx * dx + dy * dy) * 0.25) return false
  let furthest = 0
  for (const point of sampleStroke(stroke)) {
    let nearest = Infinity, progress = 0, offset = 0
    for (let index = 1; index < expected.length; index++) {
      const a = expected[index - 1], b = expected[index]
      const span = distance(a, b)
      if (!span) continue
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / (span * span)))
      const gap = distance(point, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
      if (gap < nearest) { nearest = gap; progress = offset + t * span }
      offset += span
    }
    if (nearest > 11 || progress < furthest - 9) return false
    furthest = Math.max(furthest, progress)
  }
  return furthest >= guide.length - tolerance
}

export function writingPoint(clientX: number, clientY: number, bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Point {
  const size = Math.min(bounds.width, bounds.height)
  if (size <= 0) throw new Error('The handwriting area has no size.')
  return [
    (clientX - bounds.left - (bounds.width - size) / 2) / size * 100,
    (clientY - bounds.top - (bounds.height - size) / 2) / size * 100,
  ]
}
