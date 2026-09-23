import index from '../../data/v2/index.generated.json'
import { type Band, type UnitKind, bandSchema, unitRef } from './contracts'

// Lazy access to the generated v2 curriculum data (src/data/v2). Each band is
// imported on first use so the Dictionary and study flows do not load ~4 MB up front.

export interface VocabularyRecord { id: string; ch: string; pr: string; ds: string; lb: string }
export interface ExampleSegment { word?: string; punctuation?: string }
export interface AuthoredExample { id: string; segments: ExampleSegment[]; translation: string; grammar: string[] }
export interface GrammarRecord { id: string; pt: string; pr: string; ds: string; lb: string; ex: AuthoredExample | Omit<AuthoredExample, 'id'> }
export interface StudyGroup { id: string; units: { kind: UnitKind; ref: string }[]; examples: AuthoredExample[] }
export interface BandData {
  schemaVersion: 1
  band: Band
  alignment: string
  vocabulary: VocabularyRecord[]
  grammar: GrammarRecord[]
  groups: StudyGroup[]
}

export type Unit =
  | { kind: 'vocabulary'; ref: string; band: Band; record: VocabularyRecord }
  | { kind: 'grammar'; ref: string; band: Band; record: GrammarRecord }

export interface Catalog {
  bands: BandData[]
  units: Map<string, Unit>
  groups: Map<string, { band: Band; group: StudyGroup }>
  orderedGroups: { band: Band; group: StudyGroup }[]
}

export const catalogBands = index.bands.map(entry => bandSchema.parse(entry.band))
export const catalogCounts = {
  vocabulary: index.bands.reduce((total, entry) => total + entry.vocabulary, 0),
  grammar: index.bands.reduce((total, entry) => total + entry.grammar, 0),
  groups: index.bands.reduce((total, entry) => total + entry.groups, 0),
}

const bandLoaders: Record<Band, () => Promise<{ default: unknown }>> = {
  '1': () => import('../../data/v2/hsk-1.generated.json'),
  '2': () => import('../../data/v2/hsk-2.generated.json'),
  '3': () => import('../../data/v2/hsk-3.generated.json'),
  '4': () => import('../../data/v2/hsk-4.generated.json'),
  '5': () => import('../../data/v2/hsk-5.generated.json'),
  '6': () => import('../../data/v2/hsk-6.generated.json'),
}
const bandCache = new Map<Band, Promise<BandData>>()
let catalogCache: Promise<Catalog> | undefined

export function loadBand(band: Band): Promise<BandData> {
  let pending = bandCache.get(band)
  if (!pending) {
    pending = bandLoaders[band]().then(module => module.default as BandData)
    bandCache.set(band, pending)
  }
  return pending
}

export function buildCatalog(bands: BandData[]): Catalog {
  const units = new Map<string, Unit>()
  const groups = new Map<string, { band: Band; group: StudyGroup }>()
  const orderedGroups: { band: Band; group: StudyGroup }[] = []
  for (const data of bands) {
    for (const record of data.vocabulary) units.set(unitRef('vocabulary', record.lb), { kind: 'vocabulary', ref: unitRef('vocabulary', record.lb), band: data.band, record })
    for (const record of data.grammar) units.set(unitRef('grammar', record.lb), { kind: 'grammar', ref: unitRef('grammar', record.lb), band: data.band, record })
    for (const group of data.groups) {
      const entry = { band: data.band, group }
      groups.set(group.id, entry)
      orderedGroups.push(entry)
    }
  }
  return { bands, units, groups, orderedGroups }
}

/** Loads every app band. Cached after the first call. */
export function loadCatalog(): Promise<Catalog> {
  if (!catalogCache) catalogCache = Promise.all(catalogBands.map(loadBand)).then(buildCatalog)
  return catalogCache
}

export function resetCatalogCache(): void {
  bandCache.clear()
  catalogCache = undefined
}

export function requireUnit(catalog: Catalog, ref: string): Unit {
  const unit = catalog.units.get(ref)
  if (!unit) throw new Error(`Unknown curriculum unit: ${ref}`)
  return unit
}

/** Renders an authored example's segments as Chinese text and pinyin. */
export function renderExample(catalog: Catalog, example: { segments: ExampleSegment[] }): { text: string; pinyin: string } {
  const text: string[] = []
  const pinyin: string[] = []
  for (const segment of example.segments) {
    if (segment.punctuation !== undefined) {
      text.push(segment.punctuation)
      pinyin.push(segment.punctuation)
    } else if (segment.word !== undefined) {
      const unit = requireUnit(catalog, unitRef('vocabulary', segment.word))
      if (unit.kind !== 'vocabulary') throw new Error(`Example segment is not vocabulary: ${segment.word}`)
      text.push(unit.record.ch)
      pinyin.push(unit.record.pr)
    }
  }
  return { text: text.join(''), pinyin: pinyin.join(' ') }
}

export function unitTitle(unit: Unit): string {
  return unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt
}

export function unitPronunciation(unit: Unit): string {
  return unit.record.pr
}

export function unitMeaning(unit: Unit): string {
  return unit.record.ds
}
