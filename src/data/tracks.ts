import type { Band } from '../core/study/contracts'

/** One ordered course: a language, a display name and the v2 curriculum bands whose study groups make up its lessons list. */
export interface Track {
  id: string
  /** Short language code. */
  language: string
  /** The language's name as shown to the learner, e.g. "Chinese". */
  name: string
  /** One-glyph label of the language. */
  glyph: string
  /** The v2 bands (HSK 1, 2, ...) this track's study groups come from, in order. */
  bands: Band[]
}

export const DEFAULT_LANGUAGE = 'zh'

/** The Chinese course: the v2 study groups New items works through. */
export const zhTrack: Track = { id: 'zh', language: 'zh', name: 'Chinese', glyph: '\u4E2D', bands: ['1', '2', '3', '4', '5', '6'] }

/** The Japanese and Korean names and glyphs (kept for the old other-language lines of a Chinese card, study/OtherLanguageLines). */
export const jaTrack: Track = { id: 'ja', language: 'ja', name: 'Japanese', glyph: '\u65E5', bands: ['1'] }
export const koTrack: Track = { id: 'ko', language: 'ko', name: 'Korean', glyph: '\uD55C', bands: ['1'] }

/** Every track the app ships. */
export const tracks: Track[] = [zhTrack, jaTrack, koTrack]

export type GroupStatus = 'done' | 'partial' | 'current' | 'upcoming'

export interface GroupRow {
  id: string
  band: Band
  /** Position within its band, from 1. */
  number: number
  status: GroupStatus
  introduced: number
  total: number
  /** When the group's last item was introduced (Done only). */
  completedAt?: number
  /** The group's first distinct items, e.g. "我 · 你 · 好 · 叫 · 名字". */
  title: string
}

export interface BandSummary { band: Band; total: number; done: number }

/** The minimal shape of a catalog needed to build rows (see core/study/catalog). */
export interface GroupSource {
  orderedGroups: { band: Band; group: { id: string; units: { kind: string; ref: string }[] } }[]
  titleOf: (kind: string, ref: string) => string
}

const TITLE_ITEMS = 5

/** A short label for a grammar pattern: its own short text (a record that has one: Japanese) plus "(gr.)", else its Chinese key word(s) plus "(gr.)", else the pattern's name from its label. */
export function grammarLabel(pattern: string, label: string, shortText?: string): string {
  if (shortText) return `${shortText} (gr.)`
  const keyWords = pattern.match(/[\u3400-\u9fff]+/g)
  if (keyWords) return `${[...new Set(keyWords)].join('')} (gr.)`
  const name = label.split('--')[1]?.replace(/-/g, ' ')
  return `${name || label} (gr.)`
}

/** Per-band totals and finished counts: cheap, no titles. */
export function bandSummaries(track: Track, orderedGroups: GroupSource['orderedGroups'], known: Map<string, number>, refOf: (kind: string, ref: string) => string): BandSummary[] {
  const sums = new Map<Band, BandSummary>(track.bands.map(band => [band, { band, total: 0, done: 0 }]))
  for (const { band, group } of orderedGroups) {
    const sum = sums.get(band)
    if (!sum) continue
    sum.total++
    if (group.units.every(unit => known.has(refOf(unit.kind, unit.ref)))) sum.done++
  }
  return [...sums.values()].filter(sum => sum.total > 0)
}

/** The study groups of the given bands in New items order. `known` maps a unit ref to when it was introduced; `nextId` is the group the next New items set starts from. */
export function groupRows(track: Track, source: GroupSource, known: Map<string, number>, nextId: string | undefined, refOf: (kind: string, ref: string) => string, only?: Band): GroupRow[] {
  const counters = new Map<Band, number>()
  const rows: GroupRow[] = []
  for (const { band, group } of source.orderedGroups) {
    if (!track.bands.includes(band)) continue
    const number = (counters.get(band) ?? 0) + 1
    counters.set(band, number)
    if (only && band !== only) continue
    const times = group.units.map(unit => known.get(refOf(unit.kind, unit.ref)))
    const introduced = times.filter(time => time !== undefined).length
    const done = introduced === group.units.length
    rows.push({
      id: group.id, band, number, introduced, total: group.units.length,
      status: group.id === nextId ? 'current' : done ? 'done' : introduced > 0 ? 'partial' : 'upcoming',
      completedAt: done ? Math.max(...(times as number[])) : undefined,
      title: [...new Set(group.units.map(unit => source.titleOf(unit.kind, unit.ref)))].slice(0, TITLE_ITEMS).join('\u2009\u00B7\u2009'),
    })
  }
  return rows
}
