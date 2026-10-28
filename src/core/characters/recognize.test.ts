// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeStrokeGuide, type Point } from './geometry'
import { decodeRecognitionIndex, fitStrokes, recognize, type RecognitionFile, type RecognitionIndex } from './recognize'

const root = join('public', 'characters', 'chinese')
const pages = new Map<string, { characters: { character: string; paths: string[] }[] }>()
function medians(character: string): Point[][] {
  const page = `u${(character.codePointAt(0)! >>> 8).toString(16).padStart(4, '0')}`
  if (!pages.has(page)) pages.set(page, JSON.parse(readFileSync(join(root, `${page}.generated.json`), 'utf8')))
  return pages.get(page)!.characters.find(entry => entry.character === character)!.paths.map(path => makeStrokeGuide(path).points)
}
// Deterministic shuffle so a failure reproduces.
let seed = 7
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const shuffled = <T,>(items: T[]) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]] }
  return copy
}
// Spread over simple, boxed, left-right and many-stroke shapes, including look-alikes.
const twenty = [...'休茶杯雨人一三十小水心文木我可口日国回器']
let index: RecognitionIndex
beforeAll(() => { index = decodeRecognitionIndex(JSON.parse(readFileSync(join(root, 'recognition.generated.json'), 'utf8')) as RecognitionFile) })

describe('handwriting recognizer', () => {
  it('covers every shipped guide', () => {
    const summary: { characters: { character: string }[] } = JSON.parse(readFileSync(join('src', 'data', 'characters', 'index.generated.json'), 'utf8'))
    expect(index.glyphs.map(glyph => glyph.character).sort()).toEqual(summary.characters.map(entry => entry.character).sort())
  })

  it('ranks the right character first for the median strokes of 20 characters in random stroke order', () => {
    for (const character of twenty) {
      const strokes = shuffled(medians(character))
      expect(recognize(index, strokes)[0]?.character, character).toBe(character)
    }
  }, 60_000)

  it('does not care where or how large the drawing is, or which way each stroke runs', () => {
    const strokes = shuffled(medians('休')).map(stroke => stroke.map(([x, y]): Point => [x * 2.4 + 130, y * 2.4 + 40])).map((stroke, at) => at % 2 ? [...stroke].reverse() : stroke)
    expect(recognize(index, strokes)[0].character).toBe('休')
  })

  it('keeps merged or split strokes within the top five', () => {
    for (const character of [...'休国茶器水']) {
      const strokes = medians(character)
      const merged = [...strokes.slice(0, 1), [...strokes[1], ...strokes[2]], ...strokes.slice(3)]
      expect(recognize(index, shuffled(merged)).map(match => match.character), `merged ${character}`).toContain(character)
      const long = strokes.findIndex(stroke => stroke.length > 12)
      const half = Math.floor(strokes[long].length / 2)
      const split = [...strokes.slice(0, long), strokes[long].slice(0, half), strokes[long].slice(half + 1), ...strokes.slice(long + 1)]
      expect(recognize(index, shuffled(split)).map(match => match.character), `split ${character}`).toContain(character)
    }
  }, 30_000)

  it('only offers allowed characters, never more than the limit', () => {
    const allowed = new Set([...'休本体未末'])
    const matches = recognize(index, shuffled(medians('休')), { allowed, limit: 3 })
    expect(matches).toHaveLength(3)
    expect(matches.every(match => allowed.has(match.character))).toBe(true)
    expect(matches[0].character).toBe('休')
    expect(recognize(index, [])).toEqual([])
  })

  it('fits a drawing into the common frame without distorting it', () => {
    const [fitted] = fitStrokes([[[10, 10], [30, 10]], ])
    expect(fitted[0][0]).toBeCloseTo(0)
    expect(fitted[1][0]).toBeCloseTo(100)
    expect(fitted[0][1]).toBeCloseTo(50)
  })
})
