import { z } from 'zod'
import { numberedPinyin } from './readable-labels.mjs'

const id = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const label = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const unique = (schema, message, minimum, maximum) => {
  let values = z.array(schema)
  if (minimum !== undefined) values = values.min(minimum)
  if (maximum !== undefined) values = values.max(maximum)
  return values.refine(items =>
    new Set(items.map(value => typeof value === 'string' ? value : `${value.kind}:${value.ref}`)).size === items.length,
  message)
}
const prose = z.string().trim().min(1).max(5000).regex(/^[^\u3400-\u9fff<>]+$/)
const syllable = z.string().min(1).refine(value => /^[a-z\u0300\u0301\u0304\u0308\u030c]+$/.test(value.normalize('NFD')),
  'Use one lowercase pinyin syllable')
const utterance = z.object({
  id,
  segments: z.array(z.union([
    z.object({ word: label }).strict(),
    z.object({ punctuation: z.string().min(1).regex(/^[，。？！、：；…,.?!:; ]+$/) }).strict(),
  ])).min(1).refine(parts => parts.some(part => 'word' in part), 'An example needs vocabulary'),
  translation: prose,
  grammar: unique(label, 'Duplicate grammar reference'),
}).strict()
const lexicalUnit = z.object({
  kind: z.enum(['vocabulary', 'grammar']),
  ref: label,
  note: prose,
}).strict()

const pronunciationSchema = z.object({
  pinyin: prose,
  tones: z.object({
    syllable: z.string().regex(/^[a-z\u00fc]+$/),
    introduction: prose,
    examples: z.array(z.object({
      tone: z.number().int().min(1).max(5),
      pinyin: syllable,
      name: prose.max(80),
      contour: prose.max(120),
      instruction: prose,
    }).strict()).length(5),
    neutralContext: z.object({
      syllables: z.array(syllable).min(2),
      focus: z.number().int().min(2),
      explanation: prose,
    }).strict(),
  }).strict(),
}).strict()

export const lessonSchema = z.object({
  id,
  title: prose.max(120),
  objectives: z.array(prose).min(1),
  units: unique(lexicalUnit, 'Duplicate lexical unit', 4, 6),
  examples: z.array(utterance).min(1),
}).strict()

export const lessonSequenceSchema = z.object({
  schemaVersion: z.literal(2),
  language: z.literal('chinese'),
  alignment: z.literal('hsk-1'),
  title: prose.max(120),
  status: z.literal('draft'),
  coverage: z.literal('partial'),
  source: z.object({
    kind: z.literal('original'),
    startingPoint: z.string().min(1),
  }).strict(),
  introduction: prose,
  pronunciation: pronunciationSchema,
  lessons: z.array(lessonSchema).min(1),
}).strict()

function uniqueIds(entries, context) {
  const ids = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate ${context}: ${entry.id}`)
    ids.add(entry.id)
  }
  return ids
}

function inventoryMap(entries, context) {
  uniqueIds(entries, context)
  const labels = new Map()
  for (const entry of entries) {
    label.parse(entry.lb)
    if (labels.has(entry.lb)) throw new Error(`Duplicate ${context} label: ${entry.lb}`)
    labels.set(entry.lb, entry)
  }
  return labels
}

function validateTones(tones) {
  const base = numberedPinyin(tones.syllable).slice(0, -1)
  for (const [index, example] of tones.examples.entries()) {
    if (example.tone !== index + 1 || numberedPinyin(example.pinyin) !== `${base}${example.tone}`) {
      throw new Error('Tone examples must use the same syllable with tones 1-5 in order')
    }
  }
  const sounds = tones.neutralContext.syllables.map(numberedPinyin)
  const focus = tones.neutralContext.focus
  if (focus > sounds.length || sounds[focus - 1] !== `${base}5` || !/[1-4]$/.test(sounds[focus - 2])) {
    throw new Error('Neutral context must focus on the unmarked comparison syllable after a full-tone syllable')
  }
}

export function validateLessonSequence(input, inventory) {
  const sequence = lessonSequenceSchema.parse(input)
  const vocabulary = inventoryMap(inventory.vocabulary, 'vocabulary')
  const grammar = inventoryMap(inventory.grammar, 'grammar')
  const grammarVocabulary = inventory.grammarVocabulary ?? {}
  uniqueIds(sequence.lessons, 'lesson')
  validateTones(sequence.pronunciation.tones)

  const known = { vocabulary: new Set(), grammar: new Set() }
  for (const lesson of sequence.lessons) {
    uniqueIds(lesson.examples, 'example')
    const introduced = { vocabulary: new Set(), grammar: new Set() }
    for (const unit of lesson.units) {
      const registry = unit.kind === 'vocabulary' ? vocabulary : grammar
      if (!registry.has(unit.ref)) throw new Error(`${lesson.id}: unknown ${unit.kind}: ${unit.ref}`)
      if (known[unit.kind].has(unit.ref)) throw new Error(`${lesson.id}: lexical unit already introduced: ${unit.ref}`)
      introduced[unit.kind].add(unit.ref)
      known[unit.kind].add(unit.ref)
    }
    for (const grammarLabel of introduced.grammar) {
      for (const word of grammarVocabulary[grammarLabel] ?? []) {
        if (!known.vocabulary.has(word)) {
          throw new Error(`${lesson.id}: grammar ${grammarLabel} requires vocabulary before or in the same lesson: ${word}`)
        }
      }
    }

    const covered = { vocabulary: new Set(), grammar: new Set() }
    for (const example of lesson.examples) {
      let coversCurrentUnit = false
      for (const segment of example.segments) {
        if (!('word' in segment)) continue
        if (!known.vocabulary.has(segment.word)) {
          throw new Error(`${lesson.id}/${example.id}: vocabulary before introduction or unknown: ${segment.word}`)
        }
        if (introduced.vocabulary.has(segment.word)) {
          covered.vocabulary.add(segment.word)
          coversCurrentUnit = true
        }
      }
      for (const grammarLabel of example.grammar) {
        if (!known.grammar.has(grammarLabel)) {
          throw new Error(`${lesson.id}/${example.id}: grammar before introduction or unknown: ${grammarLabel}`)
        }
        if (introduced.grammar.has(grammarLabel)) {
          covered.grammar.add(grammarLabel)
          coversCurrentUnit = true
        }
      }
      if (!coversCurrentUnit) throw new Error(`${lesson.id}/${example.id}: example does not demonstrate a new lexical unit`)
    }
    for (const kind of ['vocabulary', 'grammar']) {
      for (const unit of introduced[kind]) {
        if (!covered[kind].has(unit)) throw new Error(`${lesson.id}: introduced ${kind} has no example: ${unit}`)
      }
    }
  }
  return sequence
}
