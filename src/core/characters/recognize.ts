import type { Point } from './geometry'

/**
 * Stroke-order-free handwriting lookup over the shipped guide strokes. A drawing and every guide are fitted
 * to the same 0..100 frame (uniform scale, centered); candidates are pre-filtered by stroke count and a coarse
 * 8x8 ink bitmap, then scored by an optimal drawn-stroke to guide-stroke assignment plus a stroke-free
 * point-cloud distance, so reordered, reversed, merged or split strokes still rank the right character high.
 */
export interface RecognitionGlyph {
  character: string
  /** Guide strokes in the fitted frame, each `points` (x, y) pairs. */
  strokes: Float32Array[]
  /** Dense points of every stroke (stroke-free comparison). */
  cloud: Float32Array
  bitmap: Uint8Array
  /** The bitmap grown by one cell: ink that lands next to the right place still counts. */
  near: Uint8Array
}

export interface RecognitionIndex { points: number; glyphs: RecognitionGlyph[] }
export interface RecognitionMatch { character: string; score: number }
export interface RecognizeOptions { limit?: number; allowed?: ReadonlySet<string>; mode?: 'assignment' | 'rerank' }

const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const digitValue = new Map([...digits].map((digit, index) => [digit, index * 100 / 63]))
const FRAME = 100
const GRID = 8
const DENSE = 10
const UNMATCHED = 28
const REVERSED = 1.5
const SKIP_BASE = 4
const SKIP_SLOPE = 1.2
const RERANK = 16
const FULL_SCORE = 400
const ROUGH_STROKE = 6

export interface RecognitionFile { schemaVersion: number; points: number; characters: Record<string, string> }

/** Fit raw strokes (any scale) into the common frame; the longer side spans the frame and the ink is centered. */
export function fitStrokes(strokes: Point[][]): Point[][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const stroke of strokes) for (const [x, y] of stroke) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  if (!Number.isFinite(minX)) return []
  const scale = FRAME / Math.max(maxX - minX, maxY - minY, 8)
  const offsetX = (FRAME - (maxX - minX) * scale) / 2, offsetY = (FRAME - (maxY - minY) * scale) / 2
  return strokes.map(stroke => stroke.map(([x, y]): Point => [(x - minX) * scale + offsetX, (y - minY) * scale + offsetY]))
}

/** Resample to `count` equally spaced points along the stroke. */
export function resampleStroke(stroke: Point[], count: number): Float32Array {
  const result = new Float32Array(count * 2)
  if (!stroke.length) return result
  const along = [0]
  for (let i = 1; i < stroke.length; i++) along.push(along[i - 1] + Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]))
  const total = along[along.length - 1]
  let segment = 1
  for (let k = 0; k < count; k++) {
    if (stroke.length === 1 || total < 1e-9) { result[k * 2] = stroke[0][0]; result[k * 2 + 1] = stroke[0][1]; continue }
    const target = total * k / (count - 1)
    while (segment < stroke.length - 1 && along[segment] < target) segment++
    const span = along[segment] - along[segment - 1]
    const t = span ? Math.min(1, Math.max(0, (target - along[segment - 1]) / span)) : 0
    result[k * 2] = stroke[segment - 1][0] * (1 - t) + stroke[segment][0] * t
    result[k * 2 + 1] = stroke[segment - 1][1] * (1 - t) + stroke[segment][1] * t
  }
  return result
}

function denseCloud(strokes: Float32Array[]): Float32Array {
  const out: number[] = []
  for (const stroke of strokes) {
    const count = stroke.length / 2
    for (let i = 1; i < count; i++) {
      for (let step = 0; step < DENSE; step++) {
        const t = step / DENSE
        out.push(stroke[(i - 1) * 2] * (1 - t) + stroke[i * 2] * t, stroke[(i - 1) * 2 + 1] * (1 - t) + stroke[i * 2 + 1] * t)
      }
    }
    out.push(stroke[stroke.length - 2], stroke[stroke.length - 1])
  }
  return Float32Array.from(out)
}

function inkBitmap(cloud: Float32Array): Uint8Array {
  const bitmap = new Uint8Array(GRID * GRID)
  for (let i = 0; i < cloud.length; i += 2) {
    const x = Math.min(GRID - 1, Math.max(0, Math.floor(cloud[i] / FRAME * GRID)))
    const y = Math.min(GRID - 1, Math.max(0, Math.floor(cloud[i + 1] / FRAME * GRID)))
    bitmap[y * GRID + x] = 1
  }
  return bitmap
}

function grow(bitmap: Uint8Array): Uint8Array {
  const out = new Uint8Array(bitmap.length)
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (bitmap[y * GRID + x])
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) out[ny * GRID + nx] = 1
    }
  return out
}

function makeGlyph(character: string, strokes: Float32Array[]): RecognitionGlyph {
  const cloud = denseCloud(strokes)
  const bitmap = inkBitmap(cloud)
  return { character, strokes, cloud, bitmap, near: grow(bitmap) }
}

/** Decode the generated index. Guide strokes are fitted to the same frame as a drawing. */
export function decodeRecognitionIndex(file: RecognitionFile): RecognitionIndex {
  if (file.schemaVersion !== 1 || !Number.isInteger(file.points) || file.points < 2) throw new Error('Unsupported handwriting index.')
  const glyphs: RecognitionGlyph[] = []
  for (const [character, encoded] of Object.entries(file.characters)) {
    const raw = encoded.split('.').map(stroke => {
      if (stroke.length !== file.points * 2) throw new Error(`Invalid handwriting index entry for ${character}.`)
      const points: Point[] = []
      for (let i = 0; i < stroke.length; i += 2) points.push([digitValue.get(stroke[i])!, digitValue.get(stroke[i + 1])!])
      return points
    })
    const fitted = fitStrokes(raw)
    glyphs.push(makeGlyph(character, fitted.map(stroke => resampleStroke(stroke, file.points))))
  }
  return { points: file.points, glyphs }
}

function strokeDistance(a: Float32Array, b: Float32Array): number {
  const count = a.length / 2
  let forward = 0, backward = 0
  for (let k = 0; k < count; k++) {
    const m = (count - 1 - k) * 2
    forward += Math.hypot(a[k * 2] - b[k * 2], a[k * 2 + 1] - b[k * 2 + 1])
    backward += Math.hypot(a[k * 2] - b[m], a[k * 2 + 1] - b[m + 1])
  }
  return Math.min(forward / count, backward / count + REVERSED)
}

/** Minimum-cost assignment on a square matrix (Hungarian algorithm, O(n^3)). */
function assign(cost: number[][]): number {
  const n = cost.length
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(n + 1).fill(0)
  const p = new Array<number>(n + 1).fill(0), way = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(n + 1).fill(Infinity), used = new Array<boolean>(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity, j1 = 0
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  let total = 0
  for (let j = 1; j <= n; j++) total += cost[p[j] - 1][j - 1]
  return total
}

/** Mean distance from a stroke's points to the nearest point of a cloud: a merged or split stroke still lies on the other side's ink. */
function nearInk(stroke: Float32Array, cloud: Float32Array): number {
  let sum = 0
  for (let i = 0; i < stroke.length; i += 2) {
    let best = Infinity
    for (let j = 0; j < cloud.length; j += 2) {
      const dx = stroke[i] - cloud[j], dy = stroke[i + 1] - cloud[j + 1]
      const d = dx * dx + dy * dy
      if (d < best) best = d
    }
    sum += Math.sqrt(best)
  }
  return sum / (stroke.length / 2)
}

const skip = (near: number) => Math.min(UNMATCHED, SKIP_BASE + SKIP_SLOPE * near)

function assignmentScore(drawn: Float32Array[], drawnCloud: Float32Array, glyph: RecognitionGlyph): number {
  const guide = glyph.strokes
  const size = Math.max(drawn.length, guide.length)
  const extraDrawn = drawn.map(stroke => skip(nearInk(stroke, glyph.cloud)))
  const extraGuide = guide.map(stroke => skip(nearInk(stroke, drawnCloud)))
  const cost = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => {
    if (i < drawn.length && j < guide.length) return strokeDistance(drawn[i], guide[j])
    if (i < drawn.length) return extraDrawn[i]
    if (j < guide.length) return extraGuide[j]
    return 0
  }))
  return assign(cost) / size
}

function cloudScore(a: Float32Array, b: Float32Array): number {
  const near = (from: Float32Array, to: Float32Array) => {
    let sum = 0
    for (let i = 0; i < from.length; i += 2) {
      let best = Infinity
      for (let j = 0; j < to.length; j += 2) {
        const dx = from[i] - to[j], dy = from[i + 1] - to[j + 1]
        const d = dx * dx + dy * dy
        if (d < best) best = d
      }
      sum += Math.sqrt(best)
    }
    return sum / (from.length / 2)
  }
  return (near(a, b) + near(b, a)) / 2
}

/** Rank catalog characters for a drawing (strokes in any order, direction or scale). */
export function recognize(index: RecognitionIndex, drawing: Point[][], options: RecognizeOptions = {}): RecognitionMatch[] {
  const { limit = 8, allowed, mode = 'rerank' } = options
  const fitted = fitStrokes(drawing.filter(stroke => stroke.length))
  if (!fitted.length) return []
  const strokes = fitted.map(stroke => resampleStroke(stroke, index.points))
  const cloud = denseCloud(strokes.map(stroke => resampleStroke(Array.from({ length: stroke.length / 2 }, (_, i): Point => [stroke[i * 2], stroke[i * 2 + 1]]), index.points)))
  const bitmap = inkBitmap(cloud)
  const pool = allowed ? index.glyphs.filter(glyph => allowed.has(glyph.character)) : index.glyphs
  const near = grow(bitmap)
  const rough = pool.map(glyph => {
    let exact = 0, loose = 0
    for (let i = 0; i < bitmap.length; i++) {
      if (bitmap[i] !== glyph.bitmap[i]) exact++
      if (bitmap[i] && !glyph.near[i]) loose++
      if (glyph.bitmap[i] && !near[i]) loose++
    }
    const strokePenalty = ROUGH_STROKE * Math.max(0, Math.abs(glyph.strokes.length - strokes.length) - 2)
    return { glyph, exact: exact + strokePenalty, loose: loose * 2 + strokePenalty }
  })
  // Two coarse views (exact ink cells, and ink within one cell) each nominate candidates, so one blurry view cannot lose the answer.
  const chosen = new Set<RecognitionGlyph>()
  for (const key of ['exact', 'loose'] as const) for (const entry of [...rough].sort((a, b) => a[key] - b[key]).slice(0, FULL_SCORE / 2)) chosen.add(entry.glyph)
  const scored: RecognitionMatch[] = []
  for (const glyph of chosen) scored.push({ character: glyph.character, score: assignmentScore(strokes, cloud, glyph) })
  scored.sort((x, y) => x.score - y.score)
  if (mode === 'rerank') {
    const byCharacter = new Map(index.glyphs.map(glyph => [glyph.character, glyph]))
    for (const match of scored.slice(0, RERANK)) match.score += cloudScore(cloud, byCharacter.get(match.character)!.cloud)
    scored.splice(0, RERANK, ...scored.slice(0, RERANK).sort((x, y) => x.score - y.score))
  }
  return scored.slice(0, limit)
}

/** Fetch and decode the generated handwriting index (one request, cached by the caller). */
export async function loadRecognitionIndex(url: string): Promise<RecognitionIndex> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to load handwriting data (${response.status}).`)
  return decodeRecognitionIndex(await response.json() as RecognitionFile)
}
