import { annotate, readingIndex } from '../study/annotate'
import type { Catalog, Unit } from '../study/catalog'

// Finds the curriculum units a line contains: the vocabulary words its text segments into, and the
// grammar patterns whose fixed parts all occur in order. Free text the catalog cannot cover is ignored.

const hanRun = /\p{Script=Han}+/gu

function patternParts(pattern: string): string[] {
  return pattern.match(hanRun) ?? []
}

export function findCatalogUnits(texts: string[], catalog: Catalog): Unit[] {
  const vocabulary = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary')
  const readings = readingIndex(vocabulary)
  const byForm = new Map<string, Unit>()
  for (const unit of vocabulary) if (unit.kind === 'vocabulary' && !byForm.has(unit.record.ch)) byForm.set(unit.record.ch, unit)
  const found = new Map<string, Unit>()
  for (const text of texts) {
    for (const segment of annotate(text, readings)) {
      const unit = readings.has(segment.text) ? byForm.get(segment.text) : undefined
      if (unit) found.set(unit.ref, unit)
    }
    for (const unit of catalog.units.values()) {
      if (unit.kind !== 'grammar' || found.has(unit.ref)) continue
      const parts = patternParts(unit.record.pt)
      // A lone character matches almost every line; only multi-character or multi-part patterns count.
      if (!parts.length || parts.join('').length < 2) continue
      let from = 0
      const hit = parts.every(part => { const at = text.indexOf(part, from); if (at < 0) return false; from = at + part.length; return true })
      if (hit) found.set(unit.ref, unit)
    }
  }
  return [...found.values()]
}
