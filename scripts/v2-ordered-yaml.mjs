// Human-readable teaching-order projections of the app data.
// Built from the same band data that src/data/v2/hsk-N.generated.json holds
// (see generate-v2-app-data.mjs), so the YAML and the JSON cannot disagree.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { splitInventory } from './v2-order-curriculum.mjs'

const kinds = ['vocabulary', 'grammar']
const provenancePattern = /(?:licen[cs]e|sources\.yaml|CC-BY)|^# (?:Source: |Adapted )/i

function provenance(source) {
  const header = source.replace(/\r\n/g, '\n').split('\n')
  const end = header.findIndex(line => line.startsWith('- '))
  const lines = header.slice(0, end < 0 ? header.length : end)
    .filter(line => line.startsWith('#') && provenancePattern.test(line))
  return lines.length ? lines : ['# Source and licence: see the header of the canonical file named above.']
}

export function orderedLessonYaml(band, kind, source, sourcePath) {
  const records = new Map(splitInventory(source, sourcePath).records.map(record => [record.lb, record]))
  const placed = band.groups.flatMap(group => group.units.filter(unit => unit.kind === kind).map(unit => unit.ref))
  if (placed.length !== records.size || new Set(placed).size !== records.size) {
    throw new Error('hsk-' + band.band + ': ordered ' + kind + ' must place every record exactly once')
  }
  const body = []
  band.groups.forEach((group, index) => {
    const units = group.units.filter(unit => unit.kind === kind)
    if (units.length === 0) return
    body.push('# Lesson ' + String(index + 1).padStart(4, '0') + ': ' + group.id)
    for (const unit of units) {
      const record = records.get(unit.ref)
      if (!record) throw new Error(group.id + ': unknown ' + kind + ' label ' + unit.ref)
      body.push(...record.lines)
    }
    body.push('')
  })
  const lessons = band.groups.filter(group => group.units.some(unit => unit.kind === kind)).length
  return [
    '# GENERATED FILE - do not edit by hand. Written by: npm run curriculum:v2:app',
    '# (scripts\\generate-v2-app-data.mjs); checked by: npm run curriculum:v2:app:check.',
    '# Source: ' + kind + '.yaml in this directory, ordered by the app\'s teaching order: the',
    '# planner output (scripts\\v2-generate-lessons.mjs), seeded by the hand-authored',
    '# curriculum\\chinese\\teaching sequence, exactly as in src\\data\\v2\\hsk-' + band.band + '.generated.json.',
    '# Entries are copied unchanged from the canonical record; lessons use the app\'s group ids.',
    '# ' + placed.length + ' ' + kind + ' records, each exactly once, in ' + lessons + ' of ' +
      band.groups.length + ' lessons (lessons that introduce no ' + kind + ' are omitted;',
    '# lesson numbers match the app group id and the other ordered file).',
    ...provenance(source),
    '',
    ...body,
  ].join('\n').replace(/\n*$/, '\n')
}

export function buildOrderedYamlOutputs(bands, root) {
  return bands.flatMap(band => kinds.map(kind => {
    const dir = resolve(root, 'curriculum', 'v2', 'chinese', 'hsk-' + band.band)
    const sourcePath = resolve(dir, kind + '.yaml')
    return {
      path: resolve(dir, 'ordered-' + kind + '.yaml'),
      content: orderedLessonYaml(band, kind, readFileSync(sourcePath, 'utf8'), sourcePath),
    }
  }))
}
