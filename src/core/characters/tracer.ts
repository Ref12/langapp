import { distance, STROKE_LENIENCY, strokeLimits, type Point, type StrokeGuide } from './geometry'

/** Misses of the same stroke after which it switches to the tracer. */
export const TRACER_MISSES = 3
/** How far the pointer may stray from the path and still trace: more permissive than Relaxed (which allows `11 * 2`). */
export const TRACER_REACH = 11 * STROKE_LENIENCY.relaxed * 1.5
/** The pointer may be at most this far (along the path) ahead of the traced part: a touch at the far end does not trace the whole stroke. */
export const TRACER_LOOKAHEAD = 30

export const tracerOn = (misses: number | undefined): boolean => (misses ?? 0) >= TRACER_MISSES

/** The nearest place on the path to a point, searched from the traced progress up to the lookahead only; undefined when the point is too far from it. */
export function tracerPosition(point: Point, guide: StrokeGuide, progress: number): number | undefined {
  if (point.some(value => !Number.isFinite(value))) return undefined
  const spots = guide.points
  let best: { gap: number; at: number } | undefined
  let offset = 0
  for (let index = 1; index < spots.length; index++) {
    const a = spots[index - 1], b = spots[index]
    const span = distance(a, b)
    if (!span) continue
    const from = offset, to = offset + span
    offset = to
    if (to < progress || from > progress + TRACER_LOOKAHEAD) continue
    const low = Math.max(from, progress), high = Math.min(to, progress + TRACER_LOOKAHEAD)
    const t = Math.max((low - from) / span, Math.min((high - from) / span, ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / (span * span)))
    const gap = distance(point, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    if (!best || gap < best.gap) best = { gap, at: from + t * span }
  }
  return best && best.gap <= TRACER_REACH ? best.at : undefined
}

/** The traced progress after a pointer moves to a point: it only ever moves forward, and a point off the path changes nothing. */
export function advanceTrace(progress: number, point: Point, guide: StrokeGuide): number {
  const at = tracerPosition(point, guide, progress)
  return at !== undefined && at > progress ? Math.min(at, guide.length) : progress
}

/** The stroke is done when the traced part reaches its end, within the Normal end tolerance. */
export const traceComplete = (progress: number, guide: StrokeGuide): boolean => progress >= guide.length - strokeLimits(guide.length, 'normal').tolerance

/** The part of the guide that has been traced, as points (the last one is exactly at the progress). */
export function tracedPoints(guide: StrokeGuide, progress: number): Point[] {
  if (progress <= 0) return []
  const result: Point[] = [guide.points[0]]
  let offset = 0
  for (let index = 1; index < guide.points.length; index++) {
    const a = guide.points[index - 1], b = guide.points[index]
    const span = distance(a, b)
    if (offset + span >= progress) {
      const t = span ? (progress - offset) / span : 0
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      return result
    }
    result.push(b)
    offset += span
  }
  return result
}
