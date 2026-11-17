import { getPack } from '../language'
import type { ModuleRecord } from '../language/pack-data'
import type { Band } from './contracts'
import type { Catalog } from './catalog'
import { unitRef } from './contracts'

// Modules: runs of consecutive units (curriculum groups) inside one level, 8 to 12 units each, titled by what the learner can do in them.
// The data is a small file of the pack (modules.generated.json); a pack without one (Korean) has no modules.

export type StudyModule = ModuleRecord

/** The key a level has in the modules file: its catalog alignment (hsk-1, lessons-1). */
function levelKey(band: Band): string | undefined {
  return getPack().catalog.index.bands.find(entry => entry.band === band)?.alignment
}

/** The modules of a level, in order (none when the pack has no modules or the level is unknown). */
export function modulesOf(band: Band): StudyModule[] {
  const key = levelKey(band)
  return key === undefined ? [] : getPack().catalog.modules?.bands.find(entry => entry.band === key)?.modules ?? []
}

export interface ModuleOfUnit {
  module: StudyModule
  /** 1-based place of the module among the level's modules. */
  moduleNumber: number
  moduleCount: number
  /** 1-based place of the unit inside the module, and the module's size. */
  position: number
  size: number
}

/** The module a unit belongs to: unitIndex is the unit's 1-based place in its level. */
export function moduleOf(catalog: Pick<Catalog, 'orderedGroups'> | undefined, band: Band, unitIndex: number): ModuleOfUnit | undefined {
  void catalog
  const modules = modulesOf(band)
  const at = modules.findIndex(module => unitIndex >= module.from && unitIndex <= module.to)
  if (at < 0) return undefined
  const module = modules[at]
  return { module, moduleNumber: at + 1, moduleCount: modules.length, position: unitIndex - module.from + 1, size: module.to - module.from + 1 }
}

/** The 1-based place of a group in its level, counted in the catalog's order. */
export function unitIndexOf(catalog: Pick<Catalog, 'orderedGroups'>, band: Band, groupId: string): number {
  let index = 0
  for (const entry of catalog.orderedGroups) {
    if (entry.band !== band) continue
    index++
    if (entry.group.id === groupId) return index
  }
  return 0
}

/** Titles that say nothing about what is learned: "Mixed ...", "vocabulary 3", "patterns 2", "words 4". */
export const BANNED_TITLE = /mixed|vocabulary \d|patterns \d|words \d/i

/** Why the modules of a level do not fit its `total` units, or undefined when they do: they must cover 1..total once in order, hold 8 to 12 units (the last one 5 to 12) and have titles that are unique in the level. */
export function moduleProblem(modules: readonly StudyModule[], total: number): string | undefined {
  if (!modules.length) return 'no modules'
  let expected = 1
  const titles = new Set<string>()
  for (const [at, module] of modules.entries()) {
    if (module.from !== expected) return `${module.id} starts at unit ${module.from}, expected ${expected}`
    if (module.to < module.from) return `${module.id} ends before it starts`
    const size = module.to - module.from + 1
    const last = at === modules.length - 1
    if (size > 12 || size < (last ? 5 : 8)) return `${module.id} has ${size} units`
    const title = module.title.trim()
    const words = title.split(/\s+/).length
    if (words < 2 || words > 7) return `${module.id} has a title of ${words} words`
    if (BANNED_TITLE.test(title)) return `${module.id} has a generic or numbered title "${title}"`
    if (/^module\s*\d+$/i.test(title)) return `${module.id} is only a number`
    if (titles.has(title.toLowerCase())) return `${module.id} repeats the title "${title}"`
    titles.add(title.toLowerCase())
    expected = module.to + 1
  }
  return expected === total + 1 ? undefined : `the modules end at unit ${expected - 1} of ${total}`
}

/** How far a level is: its units (groups) that are entirely in the knowledge set, out of all of its units. */
export function levelProgress(catalog: Pick<Catalog, 'orderedGroups'>, known: ReadonlySet<string>, band: Band): { completed: number; total: number } {
  let completed = 0, total = 0
  for (const entry of catalog.orderedGroups) {
    if (entry.band !== band) continue
    total++
    if (entry.group.units.every(unit => known.has(unitRef(unit.kind, unit.ref)))) completed++
  }
  return { completed, total }
}
