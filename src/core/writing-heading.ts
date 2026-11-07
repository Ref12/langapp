import type { Catalog, Unit } from './study/catalog'

export interface HeadingWord { ch: string; pr: string; ds: string }

/** The word shown beside a character being written. In order of preference:
 *  1. the word being practised (`practised`), when the character belongs to it;
 *  2. the character's own vocabulary entry;
 *  3. a word that contains it: the one taught earliest in the curriculum, then the shortest. */
export function headingWord(catalog: Catalog | undefined, character: string, practised?: HeadingWord): HeadingWord | undefined {
  if (practised && practised.ch.includes(character)) return practised
  if (!catalog) return undefined
  const containing: Unit[] = []
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'vocabulary' || !unit.record.ch.includes(character)) continue
    if (unit.record.ch === character) return unit.record
    containing.push(unit)
  }
  if (!containing.length) return undefined
  // Curriculum position: the first ordered group that lists the unit (a unit not in any group goes last).
  const taught = new Map<string, number>()
  catalog.orderedGroups.forEach(({ group }, at) => { for (const member of group.units) { const ref = `${member.kind}:${member.ref}`; if (!taught.has(ref)) taught.set(ref, at) } })
  const at = (unit: Unit) => taught.get(unit.ref) ?? Number.MAX_SAFE_INTEGER
  containing.sort((a, b) => at(a) - at(b) || Array.from(a.kind === 'vocabulary' ? a.record.ch : '').length - Array.from(b.kind === 'vocabulary' ? b.record.ch : '').length)
  const first = containing[0]
  return first.kind === 'vocabulary' ? first.record : undefined
}

