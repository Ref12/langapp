import type { Catalog, Unit } from '../study/catalog'
import type { Band, KnowledgeEntry } from '../study/contracts'
import { characterAssetIndex, type CharacterAssetSummary } from './assets'
import type { CharacterState } from './contracts'

export interface DictionaryCharacter {
  character: string
  asset?: CharacterAssetSummary
  words: Extract<Unit, { kind: 'vocabulary' }>[]
  bands: Band[]
}

export function wordCharacters(text: string): string[] {
  return [...new Set(Array.from(text).filter(character => /^\p{Script=Han}$/u.test(character)))]
}

/** Writing identities come from exact spellings, not inferred readings or morpheme meanings. */
export function dictionaryCharacters(catalog: Catalog, assets = characterAssetIndex, states: CharacterState[] = []): DictionaryCharacter[] {
  const entries = new Map<string, DictionaryCharacter>(assets.map(asset => [
    asset.character, { character: asset.character, asset, words: [], bands: [] },
  ]))
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'vocabulary') continue
    for (const character of wordCharacters(unit.record.ch)) {
      let entry = entries.get(character)
      if (!entry) {
        entry = { character, words: [], bands: [] }
        entries.set(character, entry)
      }
      entry.words.push(unit)
      if (!entry.bands.includes(unit.band)) entry.bands.push(unit.band)
    }
  }
  for (const state of states) {
    if (state.manualAddedAt !== undefined && !entries.has(state.character)) {
      entries.set(state.character, { character: state.character, words: [], bands: [] })
    }
  }
  return [...entries.values()].sort((a, b) => a.character.codePointAt(0)! - b.character.codePointAt(0)!)
}

export function characterKnowledge(catalog: Catalog, knowledge: KnowledgeEntry[], states: CharacterState[]) {
  const automatic = new Set<string>()
  for (const entry of knowledge) {
    const unit = catalog.units.get(entry.ref)
    if (entry.kind === 'vocabulary' && unit?.kind === 'vocabulary') {
      for (const character of wordCharacters(unit.record.ch)) automatic.add(character)
    }
  }
  const manual = new Set(states.filter(state => state.manualAddedAt !== undefined).map(state => state.character))
  return { automatic, manual, all: new Set([...automatic, ...manual]) }
}

export function writingRoute(character: string, scope: 'all' | 'knowledge' = 'all'): string {
  return `#writing/${character.codePointAt(0)!.toString(16)}/${scope}`
}
