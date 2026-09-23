// Generates the app's v2 curriculum data from curriculum/v2/chinese.
// One JSON file per HSK band 1-6: vocabulary, grammar (with canonical ex),
// and the generated introduction groups with the authored examples that
// evidence them. The group order is the same dependency-aware, example-driven
// order the v2 lesson tooling produces; it is not label order.
// Usage: node scripts/generate-v2-app-data.mjs [--check]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadExampleCurriculum, loadTeachingOrder, repositoryRoot } from './v2-curriculum-io.mjs'
import { preflightBandLessons } from './v2-generate-lessons.mjs'
import { buildProfileWordLabels, loadProfileWordLabelSources } from './profile-word-labels.mjs'

export const appBands = ['1', '2', '3', '4', '5', '6']
const outputRoot = resolve(repositoryRoot, 'src', 'data', 'v2')

function stableJSON(value) {
  return `${JSON.stringify(value, null, 0)}\n`
}

export function buildAppBand(input, teachingOrder, band) {
  const source = input.bands.find(record => record.band === band)
  if (!source) throw new Error(`Unknown band: ${band}`)
  const { sequence } = preflightBandLessons(input, band, { teachingOrder })
  const vocabulary = new Map(source.vocabulary.map(record => [record.lb, record]))
  const grammar = new Map(source.grammar.map(record => [record.lb, record]))
  const placed = new Set()
  const groups = sequence.lessons.map(lesson => {
    for (const unit of lesson.units) {
      const key = `${unit.kind}:${unit.ref}`
      if (placed.has(key)) throw new Error(`${lesson.id}: unit placed twice: ${key}`)
      placed.add(key)
      if (!(unit.kind === 'vocabulary' ? vocabulary : grammar).has(unit.ref)) throw new Error(`${lesson.id}: unknown unit ${key}`)
    }
    return {
      id: lesson.id,
      units: lesson.units.map(unit => ({ kind: unit.kind, ref: unit.ref })),
      examples: lesson.examples.map(example => ({
        id: example.id, segments: example.segments, translation: example.translation, grammar: example.grammar,
      })),
    }
  })
  const total = vocabulary.size + grammar.size
  if (placed.size !== total) throw new Error(`hsk-${band}: ${placed.size} of ${total} units placed`)
  return {
    schemaVersion: 1,
    band,
    alignment: `hsk-${band}`,
    vocabulary: source.vocabulary.map(record => ({ id: record.id, ch: record.ch, pr: record.pr, ds: record.ds, lb: record.lb })),
    grammar: source.grammar.map(record => ({ id: record.id, pt: record.pt, pr: record.pr, ds: record.ds, lb: record.lb, ex: record.ex })),
    groups,
  }
}

export function buildAppData(root = repositoryRoot) {
  const input = loadExampleCurriculum(root)
  const teachingOrder = loadTeachingOrder(root)
  const bands = appBands.map(band => buildAppBand(input, teachingOrder, band))
  const index = {
    schemaVersion: 1,
    bands: bands.map(band => ({
      band: band.band, alignment: band.alignment,
      vocabulary: band.vocabulary.length, grammar: band.grammar.length, groups: band.groups.length,
    })),
  }
  const profileWordLabels = buildProfileWordLabels({
    ...loadProfileWordLabelSources(root),
    vocabulary: bands.flatMap(band => band.vocabulary),
  })
  return { index, bands, profileWordLabels }
}

function outputs(data) {
  return [
    ['index.generated.json', stableJSON(data.index)],
    ...data.bands.map(band => [`hsk-${band.band}.generated.json`, stableJSON(band)]),
    ['profile-word-labels.generated.json', stableJSON(data.profileWordLabels)],
  ]
}

if (process.argv[1] && /generate-v2-app-data\.mjs$/.test(process.argv[1])) {
  const check = process.argv.includes('--check')
  const data = buildAppData()
  mkdirSync(outputRoot, { recursive: true })
  let stale = 0
  for (const [name, text] of outputs(data)) {
    const path = resolve(outputRoot, name)
    let current
    try { current = readFileSync(path, 'utf8') } catch { current = undefined }
    if (current === text) continue
    if (check) {
      console.error(`Stale v2 app data: src/data/v2/${name}`)
      stale++
    } else {
      writeFileSync(path, text)
      console.log(`Wrote src/data/v2/${name}`)
    }
  }
  if (stale) {
    console.error('Run "npm run curriculum:v2:app" to regenerate.')
    process.exit(1)
  }
  if (check) console.log(`v2 app data is current: ${data.bands.length} bands, ${data.bands.reduce((n, band) => n + band.groups.length, 0)} groups.`)
}
