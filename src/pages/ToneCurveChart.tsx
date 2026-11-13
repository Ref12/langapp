import { describeCurve, TONE_SHAPES, type Curve } from '../core/tone-trainer/curve'

/** One line on the chart: a clip's curves (one per syllable), in the colour of the tone it carries. */
export interface CurveSeries {
  id: 'heard' | 'picked' | 'you'
  /** The tone of each syllable (1-4, 5 neutral): the line's colour. */
  tones: number[]
  curves: (Curve | null)[]
  /** What the learner hears right now: the playing line is thick, the other dimmed. */
  state?: 'playing' | 'dimmed'
  /** Said in the text alternative ("You heard"); left out for a chart with one line. */
  label?: string
  /** A fixed colour instead of the tone's (the learner's own line). */
  colour?: string
}

const W = 300, H = 120, PAD = 8, GAP = 16, TOP = 12, BOTTOM = 108
const yOf = (level: number): number => BOTTOM - ((level - 1) / 4) * (BOTTOM - TOP)

/** The path of one curve inside a segment; unvoiced points (null) break the line, nothing is drawn across them. */
function pathOf(curve: Curve, x0: number, width: number): string {
  let d = '', pen = false
  curve.forEach((value, index) => {
    if (value === null) { pen = false; return }
    d += (pen ? 'L' : 'M') + (x0 + (index / Math.max(1, curve.length - 1)) * width).toFixed(1) + ' ' + yOf(value / 10).toFixed(1)
    pen = true
  })
  return d
}
/** A tone's reference shape across a segment: its levels spread evenly. */
const shapePath = (levels: number[], x0: number, width: number): string =>
  levels.map((level, index) => (index ? 'L' : 'M') + (x0 + (index / (levels.length - 1)) * width).toFixed(1) + ' ' + yOf(level).toFixed(1)).join('')

const colour = (tone: number): string => 'var(--tone-' + (tone >= 1 && tone <= 4 ? tone : 5) + ')'

/**
 * The pitch of a clip over time on the five-level tone scale, about 120 px tall and as wide as the card. One segment per syllable (a pair shows two side by side),
 * the four tones' shapes faint behind, and the lines in the tone colours whether or not tone colours are on (this is the answer). It says what it shows in words.
 */
export function ToneCurveChart({ series, syllables }: { series: CurveSeries[]; syllables: 1 | 2 }) {
  const width = (W - 2 * PAD - GAP * (syllables - 1)) / syllables
  const segments = Array.from({ length: syllables }, (_, index) => PAD + index * (width + GAP))
  const text = series.flatMap(line => line.curves.map((curve, index) => [line, curve, index] as const)).reduce<string[]>((out, [line, curve, index]) => {
    const prefix = [line.label, syllables > 1 ? (index === 0 ? 'First syllable' : 'Second syllable') : undefined].filter(Boolean).join(', ')
    out.push((prefix ? prefix + ': ' : '') + describeCurve(curve) + '.')
    return out
  }, [])
  return <svg className="tt-chart" viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" role="img" aria-label={text.join(' ')} height={H} width="100%">
    {segments.map((x0, segment) => <g key={segment} aria-hidden="true">
      {[1, 2, 3, 4, 5].map(level => <line key={level} className="tt-grid" x1={x0} x2={x0 + width} y1={yOf(level)} y2={yOf(level)} />)}
      {[1, 2, 3, 4].map(tone => <path key={tone} className="tt-shape" d={shapePath(TONE_SHAPES[tone], x0, width)} stroke={colour(tone)} />)}
    </g>)}
    {series.map(line => <g key={line.id} aria-hidden="true">
      {line.curves.map((curve, segment) => curve && <path key={segment} className="tt-line" data-series={line.id} data-state={line.state ?? 'idle'} d={pathOf(curve, segments[segment] ?? segments[0], width)}
        stroke={line.colour ?? colour(line.tones[segment] ?? line.tones[0])} strokeDasharray={line.id === 'heard' ? undefined : '7 5'} />)}
    </g>)}
  </svg>
}
