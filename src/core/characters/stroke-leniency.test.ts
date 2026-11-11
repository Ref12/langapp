// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { matchesStroke, STROKE_MATCHING, type StrokeMatching } from './geometry'
import { learnerStroke, mulberry32, sampleCharacters, wrongStrokes, type Language } from './stroke-samples'

const LANGUAGES: [Language, number][] = [['chinese', 60], ['japanese', 12], ['korean', 14]]
const TRIES = 5

interface Rate { total: number; accepted: Record<StrokeMatching, number> }
const empty = (): Rate => ({ total: 0, accepted: { strict: 0, normal: 0, relaxed: 0 } })
function measure() {
  const rows: Record<string, { realistic: Rate; reversed: Rate; neighbour: Rate; quadrant: Rate; characters: number; strokes: number }> = {}
  for (const [language, stride] of LANGUAGES) {
    const random = mulberry32(language.length * 7919)
    const row = { realistic: empty(), reversed: empty(), neighbour: empty(), quadrant: empty(), characters: 0, strokes: 0 }
    for (const { guides } of sampleCharacters(language, stride)) {
      row.characters++
      guides.forEach((guide, index) => {
        row.strokes++
        for (let attempt = 0; attempt < TRIES; attempt++) {
          const add = (rate: Rate, stroke: ReturnType<typeof learnerStroke>, against = guide) => {
            rate.total++
            for (const level of STROKE_MATCHING) if (matchesStroke(stroke, against, level)) rate.accepted[level]++
          }
          add(row.realistic, learnerStroke(guide, random))
          for (const wrong of wrongStrokes(guides, index, random)) add(row[wrong.kind], wrong.points)
        }
      })
    }
    rows[language] = row
  }
  return rows
}
const pct = (rate: Rate, level: StrokeMatching) => rate.total ? rate.accepted[level] / rate.total * 100 : 0

describe('stroke matching levels over synthetic learner strokes', () => {
  const rows = measure()
  it('reports the acceptance rates', () => {
    const lines = ['language | strokes | set | n | strict | normal | relaxed']
    for (const [language, row] of Object.entries(rows)) for (const set of ['realistic', 'reversed', 'neighbour', 'quadrant'] as const)
      lines.push(`${language} | ${row.strokes} | ${set} | ${row[set].total} | ${STROKE_MATCHING.map(level => pct(row[set], level).toFixed(1) + '%').join(' | ')}`)
    console.info(lines.join('\n'))
    expect(lines.length).toBeGreaterThan(1)
  })
  it.each(LANGUAGES.map(([language]) => language))('%s: realistic strokes pass far more often than today and wrong strokes still fail', language => {
    const row = rows[language]
    expect(pct(row.realistic, 'normal')).toBeGreaterThan(pct(row.realistic, 'strict') + 10)
    expect(pct(row.realistic, 'normal')).toBeGreaterThan(90)
    expect(pct(row.realistic, 'relaxed')).toBeGreaterThanOrEqual(pct(row.realistic, 'normal'))
    for (const set of ['reversed', 'neighbour', 'quadrant'] as const) {
      expect(pct(row[set], 'normal'), set).toBeLessThan(5)
      expect(pct(row[set], 'relaxed'), set).toBeLessThan(10)
    }
    expect(pct(row.reversed, 'relaxed')).toBe(0)
  })
})
