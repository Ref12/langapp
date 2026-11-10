import { getPack, type LanguageId } from '../language'
import { apartOf, kindOfClass, readingParts } from '../forms/display'
import type { PackForm } from '../language/pack-data'
import type { RomajiToken } from '../reading/romaji'
import { type Band, type UnitKind, bandSchema, unitRef } from './contracts'

// Lazy access to the generated curriculum data of the build's language pack (Chinese: src/data/v2; getPack().catalog). Each band is
// imported on first use so the Dictionary and study flows do not load ~4 MB up front.

/** `cl` (absent in Chinese): the conjugation class of a word that inflects (ichidan, godan-mu, suru-compound, i-adj, na-adj …), as decided by the forms rules of the language. */
export interface VocabularyRecord { id: string; ch: string; pr: string; ds: string; lb: string; cl?: string }
/**
 * One piece of an authored example: a vocabulary word (`word` = its label), a grammar unit (`grammar` = its label) or punctuation. A Chinese segment has only that; a segment of another language may
 * carry its own surface `text` and `reading`. A conjugated word is one segment: the word's label, the whole surface (勉強します) and `form`, the id of the form it is in (the pack's forms table names it and points at the pattern that teaches it).
 */
export interface ExampleSegment { word?: string; grammar?: string; punctuation?: string; text?: string; reading?: string; form?: string }
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

/** The bands of the build language's catalog, in order (none for a pack without data). */
export const catalogBandList = (): Band[] => getPack().catalog.index.bands.map(entry => bandSchema.parse(entry.band))
const countOf = (key: 'vocabulary' | 'grammar' | 'groups') => getPack().catalog.index.bands.reduce((total, entry) => total + entry[key], 0)
export const catalogCounts = {
  get vocabulary() { return countOf('vocabulary') },
  get grammar() { return countOf('grammar') },
  get groups() { return countOf('groups') },
}

// the caches are per language, so a test can switch the build language
const bandCache = new Map<string, Promise<BandData>>()
const catalogCache = new Map<LanguageId, Promise<Catalog>>()

export function loadBand(band: Band): Promise<BandData> {
  const pack = getPack()
  const key = pack.id + ':' + band
  let pending = bandCache.get(key)
  if (!pending) {
    const load = pack.catalog.bands[band]
    pending = load ? load().then(module => module.default as BandData) : Promise.reject(new Error('The ' + pack.name + ' catalog has no band ' + band))
    bandCache.set(key, pending)
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
  const id = getPack().id
  let pending = catalogCache.get(id)
  if (!pending) {
    pending = Promise.all(catalogBandList().map(loadBand)).then(buildCatalog)
    catalogCache.set(id, pending)
  }
  return pending
}

export function resetCatalogCache(): void {
  bandCache.clear()
  catalogCache.clear()
}

export function requireUnit(catalog: Catalog, ref: string): Unit {
  const unit = catalog.units.get(ref)
  if (!unit) throw new Error(`Unknown curriculum unit: ${ref}`)
  return unit
}

/**
 * Renders an authored example's segments as text and reading (pinyin for Chinese, kana for Japanese). A word segment shows its own `text`/`reading` when it carries them, else the vocabulary record's
 * `ch`/`pr`; a grammar segment points at a grammar unit and shows its own text and reading (else the pattern). Readings are joined as the pack says (a space for pinyin, nothing for kana).
 */
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
      text.push(segment.text ?? unit.record.ch)
      pinyin.push(segment.reading ?? unit.record.pr)
    } else if (segment.grammar !== undefined) {
      const unit = requireUnit(catalog, unitRef('grammar', segment.grammar))
      if (unit.kind !== 'grammar') throw new Error(`Example segment is not grammar: ${segment.grammar}`)
      text.push(segment.text ?? unit.record.pt)
      pinyin.push(segment.reading ?? unit.record.pr)
    }
  }
  return { text: text.join(''), pinyin: pinyin.join(getPack().catalog.readingJoiner) }
}

/** The tokens of an example for its romaji: each word and grammar segment's kana reading, a grammar segment that is only は, へ or を marked as a particle, punctuation as it is. */
export function exampleReadingTokens(catalog: Catalog, example: { segments: ExampleSegment[] }, table?: readonly PackForm[]): RomajiToken[] {
  const language = getPack().displayForms?.language
  const tokens: RomajiToken[] = []
  for (const segment of example.segments) {
    if (segment.punctuation !== undefined) tokens.push({ reading: segment.punctuation, punctuation: true })
    else if (segment.word !== undefined) {
      const unit = catalog.units.get(unitRef('vocabulary', segment.word))
      const reading = segment.reading ?? (unit?.kind === 'vocabulary' ? unit.record.pr : '')
      const kind = unit?.kind === 'vocabulary' && unit.record.cl && language ? kindOfClass(language, unit.record.cl) : undefined
      const parts = unit?.kind === 'vocabulary' && segment.form ? readingParts(unit.record.cl, unit.record.pr, reading, apartOf(table, segment.form, kind)) : undefined
      if (parts) tokens.push(...parts.map(part => ({ reading: part }))); else tokens.push({ reading })
    } else if (segment.grammar !== undefined) {
      const unit = catalog.units.get(unitRef('grammar', segment.grammar))
      const reading = segment.reading ?? (unit?.kind === 'grammar' ? unit.record.pr : '')
      tokens.push({ reading, particle: segment.text !== undefined && segment.text === reading && /^[はへを]$/.test(reading) })
    }
  }
  return tokens
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
