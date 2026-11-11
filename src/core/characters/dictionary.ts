import { buildWritingRoute } from './writing-route'
import type { Catalog, Unit } from '../study/catalog'
import type { Band, KnowledgeEntry } from '../study/contracts'
import type { CharacterAssetSummary } from './assets'
import { getPack } from '../language'
import type { CharacterState } from './contracts'
import type { PackCharacterList } from '../language/writing'

export interface DictionaryCharacter {
  character: string
  asset?: CharacterAssetSummary
  words: Extract<Unit, { kind: 'vocabulary' }>[]
  bands: Band[]
  /** A language with its own character list (Japanese): the group the character is listed in, and its place in the whole list. */
  group?: string
  /** Its own reading (a kana: its sound and romaji). */
  reading?: string
  /** The first lesson whose words use it (a kanji of the lesson words); undefined for a kana and for look-up kanji. */
  lesson?: number
}

export function wordCharacters(text: string): string[] {
  return [...new Set(Array.from(text).filter(character => /^\p{Script=Han}$/u.test(character)))]
}

/** Writing identities come from exact spellings, not inferred readings or morpheme meanings. */
export function dictionaryCharacters(catalog: Catalog, assets: CharacterAssetSummary[] = getPack().writing.summaries(), states: CharacterState[] = [], list: PackCharacterList | undefined = getPack().writing.characterList): DictionaryCharacter[] {
  if (list) return listedCharacters(catalog, assets, states, list)
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

/** The lesson (1-based position among the ordered groups) of each word's first appearance; words no lesson lists count after the last. */
function lessonOfWords(catalog: Catalog): Map<string, number> {
  const lessons = new Map<string, number>()
  catalog.orderedGroups.forEach((item, at) => { for (const unit of item.group.units) if (unit.kind === 'vocabulary' && !lessons.has(unit.ref)) lessons.set(unit.ref, at + 1) })
  return lessons
}

/**
 * The list of a language with its own character list: the pack's listed groups in table order (kana), then the kanji of the lesson words by the lesson that first uses them
 * (in the order the lessons teach them), then every other character the stroke data has as look-up. Each character appears once.
 */
function listedCharacters(catalog: Catalog, assets: CharacterAssetSummary[], states: CharacterState[], list: PackCharacterList): DictionaryCharacter[] {
  const groups = list.groups()
  const assetOf = new Map(assets.map(asset => [asset.character, asset]))
  const entries = new Map<string, DictionaryCharacter>()
  const add = (character: string, group: string) => {
    if (entries.has(character)) return entries.get(character)!
    const entry: DictionaryCharacter = { character, asset: assetOf.get(character), words: [], bands: [], group, reading: list.reading(character) }
    entries.set(character, entry)
    return entry
  }
  for (const group of groups) for (const character of group.characters) add(character, group.id)
  const lessons = lessonOfWords(catalog)
  const lessonGroup = groups.find(group => group.role === 'lessons')?.id
  const lookupGroup = groups.find(group => group.role === 'lookup')?.id
  const words = [...catalog.units.values()].filter((unit): unit is Extract<Unit, { kind: 'vocabulary' }> => unit.kind === 'vocabulary')
  const last = catalog.orderedGroups.length + 1
  const lessonOf = (unit: Extract<Unit, { kind: 'vocabulary' }>) => lessons.get(unit.record.lb) ?? last
  const ordered = words.map((unit, at) => ({ unit, at, lesson: lessonOf(unit) })).sort((a, b) => a.lesson - b.lesson || a.at - b.at)
  for (const { unit, lesson } of ordered) for (const character of wordCharacters(unit.record.ch)) {
    if (!lessonGroup || list.classify(character) !== lessonGroup) continue
    const entry = add(character, lessonGroup)
    entry.lesson ??= lesson
    entry.words.push(unit)
    if (!entry.bands.includes(unit.band)) entry.bands.push(unit.band)
  }
  if (lookupGroup) {
    const rest = assets.map(asset => asset.character).filter(character => !entries.has(character) && list.classify(character) !== undefined).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!)
    for (const character of rest) add(character, lookupGroup)
  }
  for (const state of states) if (state.manualAddedAt !== undefined && !entries.has(state.character) && lookupGroup) add(state.character, lookupGroup)
  // listed groups first in their own order, then the lesson kanji (already in lesson order), then the look-up kanji
  const rank = new Map(groups.map((group, at) => [group.id, at]))
  return [...entries.values()].map((entry, at) => ({ entry, at })).sort((a, b) => (rank.get(a.entry.group!) ?? 99) - (rank.get(b.entry.group!) ?? 99) || a.at - b.at).map(item => item.entry)
}

/** Whether a character is in the group the Dictionary filter has chosen: 'all' is every group but the look-up one; the look-up group also holds the lesson kanji. */
export function inCharacterGroup(entry: DictionaryCharacter, choice: string, list: PackCharacterList): boolean {
  const groups = list.groups()
  const own = groups.find(group => group.id === entry.group)
  const chosen = groups.find(group => group.id === choice)
  if (choice === 'all') return own?.role !== 'lookup'
  return entry.group === choice || (chosen?.role === 'lookup' && own?.role === 'lessons')
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

export function writingRoute(character: string, scope: 'all' | 'knowledge' = 'all', options?: { word?: string; index?: number; back?: string }): string {
  return `#${buildWritingRoute(character, scope, options)}`
}
