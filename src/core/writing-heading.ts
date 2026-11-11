import type { Catalog, Unit } from './study/catalog'

export interface HeadingWord { ch: string; pr: string; ds: string }

/** The word shown beside a character being written. In order of preference:
 *  1. the word being practised (`practised`), when the character belongs to it;
 *  2. the character's own vocabulary entry;
 *  3. a word that contains it: the one taught earliest in the curriculum, then the shortest. */
export function headingWord(catalog: Catalog | undefined, character: string, practised?: HeadingWord): HeadingWord | undefined {
  if (practised && practised.ch.includes(character)) return practised
  return lessonWords(catalog, character)[0]
}

/** The lesson words that contain a character, best first: its own vocabulary entry, then the words taught earliest in the curriculum, shortest first. */
export function lessonWords(catalog: Catalog | undefined, character: string): HeadingWord[] {
  if (!catalog) return []
  const containing: Unit[] = []
  let own: HeadingWord | undefined
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'vocabulary' || !unit.record.ch.includes(character)) continue
    if (unit.record.ch === character) own ??= unit.record
    else containing.push(unit)
  }
  // Curriculum position: the first ordered group that lists the unit (a unit not in any group goes last).
  const taught = new Map<string, number>()
  catalog.orderedGroups.forEach(({ group }, at) => { for (const member of group.units) { const ref = `${member.kind}:${member.ref}`; if (!taught.has(ref)) taught.set(ref, at) } })
  const at = (unit: Unit) => taught.get(unit.ref) ?? Number.MAX_SAFE_INTEGER
  containing.sort((a, b) => at(a) - at(b) || Array.from(a.kind === 'vocabulary' ? a.record.ch : '').length - Array.from(b.kind === 'vocabulary' ? b.record.ch : '').length)
  return [...(own ? [own] : []), ...containing.flatMap(unit => unit.kind === 'vocabulary' ? [unit.record] : [])]
}
