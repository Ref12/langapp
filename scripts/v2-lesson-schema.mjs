import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import {
  isMeaningfulComponent,
  lexicalLabelSchema,
  validateVocabularyComponents,
  vocabularyComponentsSchema,
} from './v2-component-schema.mjs'
import {
  exampleSchema, exampleUnits, grammarExampleId, hskBands, stableIdSchema, unitKey,
  validateBandExamples, validateCurriculumExamples,
} from './v2-example-schema.mjs'
import { auditGrammarVocabulary } from './v2-grammar-vocabulary.mjs'

export const lexicalUnitSchema = z.object({
  kind: z.enum(['vocabulary', 'grammar']),
  ref: lexicalLabelSchema,
}).strict()
export const lessonSchema = z.object({
  id: stableIdSchema,
  units: z.array(lexicalUnitSchema).min(4).max(6).refine(
    units => new Set(units.map(unitKey)).size === units.length, 'Duplicate lexical unit'),
  examples: z.array(exampleSchema).min(1),
}).strict()
export const lessonSequenceSchema = z.object({
  schemaVersion: z.literal(3),
  language: z.literal('chinese'),
  alignment: z.enum(hskBands.map(band => `hsk-${band}`)),
  status: z.literal('draft'),
  lessons: z.array(lessonSchema),
}).strict()

export function lessonComponentIntroductions(sequence, vocabulary, vocabularyComponents) {
  const bindings = new Map(vocabularyComponentsSchema.parse(vocabularyComponents)
    .map(binding => [binding.vocabulary, binding]))
  const known = new Set()
  return sequence.lessons.map(lesson => {
    const introduced = []
    const words = []
    for (const unit of lesson.units) {
      if (unit.kind !== 'vocabulary') continue
      const word = vocabulary.get(unit.ref)
      if (!word) throw new Error(`${lesson.id}: unknown vocabulary: ${unit.ref}`)
      if ([...word.ch].length === 1) continue
      const binding = bindings.get(unit.ref)
      if (!binding) throw new Error(`${lesson.id}: vocabulary has no component prerequisites: ${unit.ref}`)
      words.push(binding)
      for (const component of binding.components) {
        if (!isMeaningfulComponent(component)) continue
        const key = `${component.kind}:${component.ref}`
        if (known.has(key)) continue
        known.add(key)
        introduced.push({ kind: component.kind, ref: component.ref })
      }
    }
    return { lesson: lesson.id, components: introduced, words }
  })
}

function validateHsk1Components(input, bands) {
  return validateVocabularyComponents(input.vocabularyComponents ?? [], {
    vocabulary: bands[0].vocabulary,
    componentVocabulary: [
      ...bands.flatMap(band => band.vocabulary),
      ...(input.componentVocabulary ?? []),
    ],
    morphemes: input.morphemes ?? [],
  }, { requireComplete: true })
}

export function prepareLessonCurriculum(input) {
  const context = validateCurriculumExamples(input.bands)
  const audit = auditGrammarVocabulary(input)
  if (audit.errors.length) throw new Error(`Grammar lexical prerequisites:\n${audit.errors.join('\n')}`)
  const components = validateHsk1Components(input, context.bands)
  return { ...context, grammarVocabulary: audit.requiredVocabulary, components }
}

export function prepareBandLessonCurriculum(input, selectedBand) {
  const context = validateBandExamples(input.bands, selectedBand)
  const target = input.bands.find(band => band.band === selectedBand)
  const labels = new Set(target.grammar.map(record => record.lb))
  // Audit only the selected band's complete grammar against cumulative vocabulary.
  // The full curriculum path above never removes or exempts unfinished records.
  const audit = auditGrammarVocabulary({
    bands: input.bands.map(band => ({
      band: band.band, vocabulary: band.vocabulary,
      grammar: band.band === selectedBand ? band.grammar : [], examples: [],
    })),
    requirements: input.requirements.filter(requirement => labels.has(requirement.grammar)),
  })
  if (audit.errors.length) throw new Error(`Grammar lexical prerequisites:\n${audit.errors.join('\n')}`)
  return {
    ...context, grammarVocabulary: audit.requiredVocabulary,
    components: selectedBand === '1' ? validateHsk1Components(input, context.bands) : null,
  }
}

function validateSequences(inputs, context) {
  const known = new Set()
  const lessonIds = new Set()
  const exampleIds = new Set()
  return inputs.map((input, bandIndex) => {
    const sequence = lessonSequenceSchema.parse(input)
    const band = context.bands[bandIndex]
    if (sequence.alignment !== `hsk-${band.band}`) {
      throw new Error(`Supply lesson sequences in cumulative order; expected hsk-${band.band}`)
    }
    const authored = new Map(context.candidates[bandIndex].map(example => [example.id, exampleSchema.parse(example)]))
    for (const lesson of sequence.lessons) {
      if (lessonIds.has(lesson.id)) throw new Error(`Duplicate lesson ID: ${lesson.id}`)
      lessonIds.add(lesson.id)
      const introduced = new Set(lesson.units.map(unitKey))
      for (const unit of lesson.units) {
        const record = context[unit.kind].get(unit.ref)
        if (!record) throw new Error(`${lesson.id}: unknown ${unit.kind}: ${unit.ref}`)
        if (record.index !== bandIndex) {
          throw new Error(`${lesson.id}: ${unit.ref} must be introduced at its canonical band hsk-${record.band}`)
        }
        const key = unitKey(unit)
        if (known.has(key)) throw new Error(`${lesson.id}: lexical unit already introduced: ${unit.ref}`)
        known.add(key)
      }
      for (const unit of lesson.units.filter(unit => unit.kind === 'grammar')) {
        for (const word of context.grammarVocabulary[unit.ref] ?? []) {
          if (!known.has(`vocabulary:${word}`)) {
            throw new Error(`${lesson.id}: grammar ${unit.ref} requires vocabulary before or in the same lesson: ${word}`)
          }
        }
        const expectedId = grammarExampleId(context.grammar.get(unit.ref))
        if (!lesson.examples.some(example => example.id === expectedId)) {
          throw new Error(`${lesson.id}: grammar ${unit.ref} needs its authored example ${expectedId}`)
        }
      }
      const covered = new Set()
      for (const example of lesson.examples) {
        if (exampleIds.has(example.id)) throw new Error(`Duplicate lesson example ID: ${example.id}`)
        exampleIds.add(example.id)
        if (!isDeepStrictEqual(example, authored.get(example.id))) {
          throw new Error(`${lesson.id}/${example.id}: example must match an authored candidate in ${sequence.alignment}`)
        }
        const references = exampleUnits(example)
        for (const key of references) {
          if (!known.has(key)) {
            throw new Error(`${lesson.id}/${example.id}: ${key} before introduction or unknown`)
          }
          if (introduced.has(key)) covered.add(key)
        }
        if (!references.some(key => introduced.has(key))) {
          throw new Error(`${lesson.id}/${example.id}: example does not demonstrate a new lexical unit`)
        }
      }
      for (const key of introduced) {
        if (!covered.has(key)) throw new Error(`${lesson.id}: introduced ${key} has no example`)
      }
    }
    for (const kind of ['vocabulary', 'grammar']) {
      const missing = band[kind].filter(record => !known.has(`${kind}:${record.lb}`))
      if (missing.length) {
        throw new Error(`${sequence.alignment}: missing ${missing.length} ${kind} units: ${missing.map(record => record.lb).join(', ')}`)
      }
    }
    if (bandIndex === 0) {
      lessonComponentIntroductions(sequence, context.vocabulary, context.components.bindings)
    }
    return sequence
  })
}

export function validateLessonCurriculum(sequences, input) {
  if (sequences.length !== hskBands.length) throw new Error('Supply lessons for all seven HSK bands')
  return validateSequences(sequences, prepareLessonCurriculum(input))
}

export function validateLessonSequence(sequence, input, previousSequences = []) {
  const result = validateSequences([...previousSequences, sequence], prepareLessonCurriculum(input))
  return result[result.length - 1]
}
