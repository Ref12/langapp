import { loadCatalog, type Catalog } from '../study/catalog'
import type { PhraseReadings } from './phrase'

const byCatalog = new WeakMap<Catalog, PhraseReadings>()
let loaded: PhraseReadings | undefined
let pending: Promise<PhraseReadings> | undefined

/** Every catalog vocabulary form with its authored pinyin; where a form has several readings the word taught first wins (as in the phrase pipeline). */
export function phraseReadingsOf(catalog: Catalog): PhraseReadings {
  let readings = byCatalog.get(catalog)
  if (!readings) {
    const map = new Map<string, string>()
    const add = (ref: string) => {
      const unit = catalog.units.get(ref)
      if (unit?.kind === 'vocabulary' && !map.has(unit.record.ch)) map.set(unit.record.ch, unit.record.pr)
    }
    for (const { group } of catalog.orderedGroups) for (const unit of group.units) if (unit.kind === 'vocabulary') add(unit.ref)
    for (const ref of catalog.units.keys()) add(ref)
    readings = map
    byCatalog.set(catalog, readings)
  }
  return readings
}

/** Loads the catalog (cached) and its reading index; later calls of loadedPhraseReadings() are synchronous. */
export function loadPhraseReadings(): Promise<PhraseReadings> {
  pending ??= loadCatalog().then(catalog => (loaded = phraseReadingsOf(catalog)))
  return pending
}

/** The index when loadPhraseReadings() has finished, else undefined. Never starts a load. */
export function loadedPhraseReadings(): PhraseReadings | undefined {
  return loaded
}
