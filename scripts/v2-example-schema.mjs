import { z } from 'zod'
import { lexicalLabelSchema } from './v2-component-schema.mjs'

export const hskBands = ['1', '2', '3', '4', '5', '6', '7-9']
export const stableIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const text = z.string().trim().min(1)
const uniqueLabels = z.array(lexicalLabelSchema).refine(
  labels => new Set(labels).size === labels.length, 'Duplicate grammar reference')

export const exampleBodySchema = z.object({
  segments: z.array(z.union([
    z.object({ word: lexicalLabelSchema }).strict(),
    z.object({ punctuation: z.string().regex(/^[，。？！、：；…“”‘’（）《》〈〉「」『』—·]+$/u) }).strict(),
  ])).min(1).refine(parts => parts.some(part => 'word' in part), 'An example needs vocabulary'),
  translation: text.max(5000).regex(/^[^\p{Script=Han}<>]+$/u, 'Use an English translation, not a template'),
  grammar: uniqueLabels,
}).strict()

export const exampleSchema = z.object({ id: stableIdSchema, ...exampleBodySchema.shape }).strict()
export const vocabularySchema = z.object({
  id: stableIdSchema, ch: text, pr: text, ds: text, lb: lexicalLabelSchema,
}).strict()
export const grammarSchema = z.object({
  id: stableIdSchema, pt: text, pr: text, ds: text, lb: lexicalLabelSchema,
  ex: exampleBodySchema,
}).strict().superRefine((record, context) => {
  if (!record.ex.grammar.includes(record.lb)) {
    context.addIssue({
      code: z.ZodIssueCode.custom, path: ['ex', 'grammar'],
      message: `${record.lb}: grammar ex must cite itself`,
    })
  }
})
export const bandSchema = z.object({
  band: z.enum(hskBands),
  vocabulary: z.array(vocabularySchema),
  grammar: z.array(grammarSchema),
  examples: z.array(exampleSchema).default([]),
}).strict()

function checkMissingExamples(input) {
  // Missing authoring inputs are common during integration; report identities, not 923 Zod traces.
  if (Array.isArray(input)) {
    const missing = input.flatMap(band => (Array.isArray(band?.grammar) ? band.grammar : [])
      .filter(record => record && record.ex === undefined)
      .map(record => `hsk-${band.band}/grammar.yaml: ${record.id} (${record.lb})`))
    if (missing.length) {
      throw new Error(`Missing authored grammar ex: ${missing.length} records.\n${missing.slice(0, 20).join('\n')}` +
        (missing.length > 20 ? '\n... Supply every canonical grammar ex before generation.' : ''))
    }
  }
}

export function parseCurriculumBands(input) {
  checkMissingExamples(input)
  const bands = z.array(bandSchema).parse(input)
  if (bands.map(band => band.band).join(',') !== hskBands.join(',')) {
    throw new Error('Supply all HSK bands in cumulative order')
  }
  return bands
}

export const grammarExampleId = record => `grammar-${record.id}`
export const usageExampleId = (band, example) => `usage-hsk-${band}-${example.id}`
export const exampleUnits = example => [
  ...new Set(example.segments.flatMap(segment => 'word' in segment ? [`vocabulary:${segment.word}`] : [])),
  ...example.grammar.map(label => `grammar:${label}`),
]
export const unitKey = unit => `${unit.kind}:${unit.ref}`

function validateExamples(bands, indices) {
  const registries = { vocabulary: new Map(), grammar: new Map() }
  const ids = new Set()
  for (const [index, band] of bands.entries()) {
    for (const kind of ['vocabulary', 'grammar']) {
      for (const record of band[kind]) {
        if (ids.has(record.id)) throw new Error(`Duplicate inventory ID: ${record.id}`)
        if (registries[kind].has(record.lb)) throw new Error(`Duplicate ${kind} label: ${record.lb}`)
        ids.add(record.id)
        registries[kind].set(record.lb, { ...record, band: band.band, index })
      }
    }
  }
  const exampleIds = new Set()
  const errors = []
  const candidates = bands.map((band, index) => {
    if (!indices.has(index)) return []
    const examples = [
      ...[...band.grammar].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
        .map(record => ({ id: grammarExampleId(record), ...record.ex })),
      ...band.examples.map(example => ({ ...example, id: usageExampleId(band.band, example) })),
    ]
    const covered = new Set()
    for (const example of examples) {
      if (exampleIds.has(example.id)) errors.push(`Duplicate example ID: ${example.id}`)
      exampleIds.add(example.id)
      for (const key of exampleUnits(example)) {
        const [kind, label] = key.split(':')
        const record = registries[kind].get(label)
        if (!record) errors.push(`hsk-${band.band}/${example.id}: unknown ${kind}: ${label}`)
        else if (record.index > index) {
          errors.push(`hsk-${band.band}/${example.id}: later-band ${kind}: ${label} (hsk-${record.band})`)
        }
        if (record?.index === index) covered.add(key)
      }
    }
    for (const word of band.vocabulary) {
      if (!covered.has(`vocabulary:${word.lb}`)) {
        errors.push(`hsk-${band.band}: vocabulary has no authored example: ${word.lb}`)
      }
    }
    return examples
  })
  if (errors.length) {
    throw new Error(`Invalid curriculum examples (${errors.length} issues):\n${errors.slice(0, 40).join('\n')}` +
      (errors.length > 40 ? '\n... Repair authored coverage and references before generation.' : ''))
  }
  return { bands, candidates, ...registries }
}

export function validateCurriculumExamples(input) {
  const bands = parseCurriculumBands(input)
  return validateExamples(bands, new Set(bands.map((_, index) => index)))
}

// A scoped authoring audit checks one band's content against reference identities in
// the other bands. It does not validate, or certify completion of, those other drafts.
export function validateBandExamples(input, selectedBand) {
  if (!hskBands.includes(selectedBand)) throw new Error(`Unknown HSK band: ${selectedBand}`)
  if (!Array.isArray(input) || input.map(band => band.band).join(',') !== hskBands.join(',')) {
    throw new Error('Supply all HSK bands in cumulative order')
  }
  const referenceSchema = z.object({ id: stableIdSchema, lb: lexicalLabelSchema }).strict()
  const bands = input.map(band => {
    if (band.band === selectedBand) {
      checkMissingExamples([band])
      return bandSchema.parse(band)
    }
    return {
      band: band.band,
      vocabulary: z.array(vocabularySchema).parse(band.vocabulary),
      grammar: band.grammar.map(record => referenceSchema.parse({ id: record.id, lb: record.lb })),
      examples: [],
    }
  })
  return validateExamples(bands, new Set([hskBands.indexOf(selectedBand)]))
}
