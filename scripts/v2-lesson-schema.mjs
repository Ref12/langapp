import { z } from 'zod'
import { numberedPinyin } from './readable-labels.mjs'

const id = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const label = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
/** @template {z.ZodTypeAny} T @param {T} schema */
const references = schema => z.array(schema).refine(values => new Set(values).size === values.length, 'Duplicate reference')
// Target-language text belongs in inventory references, not untracked narration.
const prose = z.string().trim().min(1).max(4000).regex(/^[^\u3400-\u9fff<>]+$/)
const role = z.enum(['new', 'review'])
const syllable = z.string().min(1).refine(value => /^[a-z\u0300\u0301\u0304\u0308\u030c]+$/.test(value.normalize('NFD')),
  'Use one lowercase pinyin syllable, not a word reference or sentence')
const utterance = z.object({
  segments: z.array(z.union([
    z.object({ word: label }).strict(),
    z.object({ punctuation: z.string().min(1).regex(/^[，。？！、：；…,.?!:; ]+$/) }).strict(),
  ])).min(1).refine(parts => parts.some(part => 'word' in part), 'An utterance needs vocabulary'),
  translation: prose,
  grammar: references(label),
}).strict()
const page = { id, title: prose.max(120), requires: references(id) }

export const lessonPageSchema = z.discriminatedUnion('template', [
  z.object({
    ...page, template: z.literal('overview'),
    data: z.object({ introduction: prose }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('vocabulary'),
    data: z.object({ word: label, role, note: prose }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('concept'),
    data: z.object({ body: prose, examples: z.array(utterance) }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('tone-comparison'),
    data: z.object({
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
      practice: prose,
    }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('grammar'),
    data: z.object({ grammar: label, role, explanation: prose, examples: z.array(utterance).min(1) }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('dialogue'),
    data: z.object({
      setting: prose,
      speakers: z.array(z.object({ id, name: prose.max(80) }).strict()).min(2),
      turns: z.array(z.object({ speaker: id, utterance }).strict()).min(2),
    }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('recall'),
    data: z.object({ prompt: prose, answer: utterance, explanation: prose }).strict(),
  }).strict(),
  z.object({
    ...page, template: z.literal('summary'),
    data: z.object({ reflection: z.array(prose).min(1), limitation: prose }).strict(),
  }).strict(),
])

export const lessonSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  language: z.literal('chinese'),
  title: prose.max(120),
  status: z.literal('draft'),
  placement: z.object({ level: z.number().int().positive(), module: id }).strict(),
  alignment: z.enum(['hsk-1', 'hsk-2', 'hsk-3', 'hsk-4', 'hsk-5', 'hsk-6', 'hsk-7-9']),
  source: z.object({ kind: z.literal('original'), adaptedFrom: z.string().min(1), lesson: id }).strict(),
  prerequisites: references(id),
  objectives: z.array(prose).min(1),
  pages: z.array(lessonPageSchema).min(2),
}).strict()

export function pageUtterances(page) {
  switch (page.template) {
    case 'concept':
    case 'grammar': return page.data.examples
    case 'dialogue': return page.data.turns.map(turn => turn.utterance)
    case 'recall': return [page.data.answer]
    default: return []
  }
}

function uniqueIds(entries, context) {
  const ids = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate ${context}: ${entry.id}`)
    ids.add(entry.id)
  }
  return ids
}

function inventoryLabels(entries, context) {
  uniqueIds(entries, context)
  const labels = new Set()
  for (const entry of entries) {
    label.parse(entry.lb)
    if (labels.has(entry.lb)) throw new Error(`Duplicate ${context} label: ${entry.lb}`)
    labels.add(entry.lb)
  }
  return labels
}

// Callers supply teaching order explicitly; inventory order and HSK bands are not lesson order.
export function validateLessonSequence(input, inventory) {
  const lessons = z.array(lessonSchema).min(1).parse(input)
  uniqueIds(lessons, 'lesson')
  const vocabulary = inventoryLabels(inventory.vocabulary, 'vocabulary')
  const grammar = inventoryLabels(inventory.grammar, 'grammar')
  const known = { vocabulary: new Set(), grammar: new Set() }
  const completed = new Set()
  for (const lesson of lessons) {
    uniqueIds(lesson.pages, 'page')
    for (const prerequisite of lesson.prerequisites) {
      if (!completed.has(prerequisite)) throw new Error(`${lesson.id}: prerequisite must precede lesson: ${prerequisite}`)
    }
    const seenPages = new Set()
    for (const [index, page] of lesson.pages.entries()) {
      const context = `${lesson.id}/${page.id}`
      if ((page.template === 'overview') !== (index === 0) ||
          (page.template === 'summary') !== (index === lesson.pages.length - 1)) {
        throw new Error(`${context}: overview must be first and summary last, with neither repeated`)
      }
      for (const prerequisite of page.requires) {
        if (!seenPages.has(prerequisite)) throw new Error(`${context}: required page must precede use: ${prerequisite}`)
      }
      if (page.template === 'tone-comparison') {
        const base = numberedPinyin(page.data.syllable).slice(0, -1)
        for (const [index, example] of page.data.examples.entries()) {
          if (example.tone !== index + 1 || numberedPinyin(example.pinyin) !== `${base}${example.tone}`) {
            throw new Error(`${context}: tone examples must use the same syllable with tones 1-5 in order`)
          }
        }
        const neutral = page.data.neutralContext
        const sounds = neutral.syllables.map(numberedPinyin)
        if (neutral.focus > sounds.length || sounds[neutral.focus - 1] !== `${base}5` ||
            !/[1-4]$/.test(sounds[neutral.focus - 2])) {
          throw new Error(`${context}: neutral context must focus on the unmarked comparison syllable after a full-tone syllable`)
        }
      }
      if (page.template === 'vocabulary' || page.template === 'grammar') {
        const kind = page.template
        const reference = kind === 'vocabulary' ? page.data.word : page.data.grammar
        const registry = kind === 'vocabulary' ? vocabulary : grammar
        if (!registry.has(reference)) throw new Error(`${context}: unknown ${kind}: ${reference}`)
        if (known[kind].has(reference) !== (page.data.role === 'review')) {
          throw new Error(`${context}: ${kind} must be new at first introduction and review afterward: ${reference}`)
        }
        known[kind].add(reference)
      }
      if (page.template === 'grammar' && page.data.examples.some(example => !example.grammar.includes(page.data.grammar))) {
        throw new Error(`${context}: grammar examples must declare the construction being taught`)
      }
      if (page.template === 'dialogue') {
        const speakers = uniqueIds(page.data.speakers, 'speaker')
        if (page.data.turns.some(turn => !speakers.has(turn.speaker))) {
          throw new Error(`${context}: unknown dialogue speaker`)
        }
      }
      for (const utterance of pageUtterances(page)) {
        for (const segment of utterance.segments) {
          if ('word' in segment && !known.vocabulary.has(segment.word)) {
            throw new Error(`${context}: vocabulary before introduction or unknown: ${segment.word}`)
          }
        }
        for (const reference of utterance.grammar) {
          if (!known.grammar.has(reference)) throw new Error(`${context}: grammar before introduction or unknown: ${reference}`)
        }
      }
      seenPages.add(page.id)
    }
    completed.add(lesson.id)
  }
  return lessons
}
