import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeStrokeGuide, sampleStroke, type Point, type StrokeGuide } from './geometry'

/** Test support: shipped guides and synthetic learner strokes for calibrating the matching levels. Not part of the app. */
export type Language = 'chinese' | 'japanese' | 'korean'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Every `stride`-th shipped character of a language (deterministic), as its stroke guides. */
export function sampleCharacters(language: Language, stride: number): { character: string; guides: StrokeGuide[] }[] {
  const root = join('public', 'characters', language)
  const all: { character: string; paths: string[] }[] = []
  for (const file of readdirSync(root).filter(name => /^u[0-9a-f]{4}\.generated\.json$/.test(name)).sort()) {
    const page: { characters: { character: string; paths: string[] }[] } = JSON.parse(readFileSync(join(root, file), 'utf8'))
    all.push(...page.characters.filter(entry => entry.paths.length > 0))
  }
  return all.filter((_, index) => index % stride === 0).map(entry => ({ character: entry.character, guides: entry.paths.map(makeStrokeGuide) }))
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))
const along = (points: Point[], fraction: number): Point => points[Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))]

/**
 * A realistic learner stroke over a guide: smooth jitter, a slight offset, a little overshoot at the ends, and sometimes one hesitant wobble.
 * Sizes are what a finger on a phone does, not a worst case.
 */
export function learnerStroke(guide: StrokeGuide, random: () => number): Point[] {
  const base = guide.points
  const offset: Point = [(random() * 2 - 1) * 5, (random() * 2 - 1) * 5]
  const jitter = (1 + random() * 2.5)
  const phases = [random() * 6.28, random() * 6.28], rates = [0.15 + random() * 0.2, 0.4 + random() * 0.3]
  const wobbleAt = random() < 0.5 ? 0.2 + random() * 0.6 : -1
  const wobbleSize = (4 + random() * 7) * (random() < 0.5 ? -1 : 1)
  const startTail = random() * 5, endTail = random() * 6
  const unit = (a: Point, b: Point): Point => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d] }
  const head = unit(base[1] ?? base[0], base[0]), tail = unit(base[base.length - 2] ?? base[base.length - 1], base[base.length - 1])
  const pts: Point[] = []
  pts.push([base[0][0] + head[0] * startTail, base[0][1] + head[1] * startTail])
  base.forEach((point, index) => {
    const t = index / Math.max(1, base.length - 1)
    const next = base[Math.min(base.length - 1, index + 1)], previous = base[Math.max(0, index - 1)]
    const direction = unit(previous, next)
    const normal: Point = [-direction[1], direction[0]]
    let side = jitter * (Math.sin(phases[0] + index * rates[0]) * 0.7 + Math.sin(phases[1] + index * rates[1]) * 0.3)
    if (wobbleAt >= 0) side += wobbleSize * Math.exp(-(((t - wobbleAt) / 0.12) ** 2))
    pts.push([clamp(point[0] + offset[0] + normal[0] * side), clamp(point[1] + offset[1] + normal[1] * side)])
  })
  pts.push([base[base.length - 1][0] + tail[0] * endTail + offset[0], base[base.length - 1][1] + tail[1] * endTail + offset[1]])
  return pts
}

/** Strokes that are wrong for this guide: backwards, the neighbouring stroke's path, and the stroke written in the opposite quadrant. */
export function wrongStrokes(guides: StrokeGuide[], index: number, random: () => number): { kind: 'reversed' | 'neighbour' | 'quadrant'; points: Point[] }[] {
  const guide = guides[index]
  const result: { kind: 'reversed' | 'neighbour' | 'quadrant'; points: Point[] }[] = []
  const first = guide.points[0], last = guide.points[guide.points.length - 1]
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 8) result.push({ kind: 'reversed', points: [...learnerStroke(guide, random)].reverse() })
  const neighbour = guides[index + 1] ?? guides[index - 1]
  if (neighbour) {
    const other = neighbour.points
    // Skip when the neighbour is practically the same stroke (a repeated stroke is a right answer).
    const near = Math.hypot(other[0][0] - first[0], other[0][1] - first[1]) < 20 && Math.hypot(other[other.length - 1][0] - last[0], other[other.length - 1][1] - last[1]) < 20
    if (!near) result.push({ kind: 'neighbour', points: learnerStroke(neighbour, random) })
  }
  const shifted = learnerStroke(guide, random).map((point): Point => [clamp(100 - point[0]), clamp(100 - point[1])])
  const mirrored = shifted.some((point, i) => i < guides[index].points.length && Math.hypot(point[0] - first[0], point[1] - first[1]) < 15 && Math.hypot(shifted[shifted.length - 1][0] - last[0], shifted[shifted.length - 1][1] - last[1]) < 15)
  if (!mirrored) result.push({ kind: 'quadrant', points: shifted })
  return result
}

export { sampleStroke, along }
