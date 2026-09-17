import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { labelRegistrySchema, learningSourceSchema, lessonRouteId, modelUtterances } from '../src/core/learning-content-schema.mjs'
import { validateLabelRegistry } from './readable-labels.mjs'

export { modelUtterances } from '../src/core/learning-content-schema.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const learningContentSource = resolve(root, 'curriculum', 'chinese', 'teaching', 'content', 'level-01.yaml')
export const labelRegistrySource = resolve(root, 'curriculum', 'chinese', 'teaching', 'content', 'labels.yaml')
const outputPath = resolve(root, 'src', 'data', 'learning-content.generated.json')

function uniqueMap(entries, context) {
  const result = new Map()
  for (const entry of entries) {
    if (result.has(entry.label)) throw new Error(`Duplicate ${context} label: ${entry.label}`)
    result.set(entry.label, entry)
  }
  return result
}

export function validateLearningContent(input, curriculum, registry) {
  const source = learningSourceSchema.parse(input)
  const labels = validateLabelRegistry(labelRegistrySchema.parse(registry), curriculum)
  const words = new Map(labels.words.map(entry => [entry.label, entry.id]))
  const grammar = new Map(labels.grammar.map(entry => [entry.label, entry.id]))
  const lessons = uniqueMap(source.lessons, 'lesson')
  const models = uniqueMap(source.models, 'model')
  const levelId = `zh-level-${String(source.level).padStart(2, '0')}`
  const expectedLessons = curriculum.lessons.filter(lesson => lesson.levelId === levelId)
  const routes = source.lessons.map(lesson => lessonRouteId(source.level, lesson))
  if (JSON.stringify(routes) !== JSON.stringify(expectedLessons.map(lesson => lesson.id))) {
    throw new Error('Lesson definitions must cover this level exactly in curriculum order')
  }
  const order = new Map(source.lessons.map((lesson, index) => [lesson.label, index]))
  const vocabulary = new Set()
  const constructions = new Set()
  const cutoffs = new Map()
  const resolveWord = label => {
    const id = words.get(label)
    if (!id) throw new Error(`Unknown vocabulary label: ${label}`)
    return id
  }
  const resolveGrammar = label => {
    const id = grammar.get(label)
    if (!id) throw new Error(`Unknown grammar label: ${label}`)
    return id
  }
  for (const [index, lesson] of source.lessons.entries()) {
    const expected = expectedLessons[index]
    const newWords = lesson.sections.flatMap(section =>
      section.kind === 'vocabulary' && section.role === 'new' ? section.words.map(resolveWord) : [])
    const newGrammar = lesson.sections.flatMap(section =>
      section.kind === 'grammar' && section.role === 'new' ? [resolveGrammar(section.grammar)] : [])
    if (JSON.stringify(newWords) !== JSON.stringify(expected.wordIds) ||
        JSON.stringify(newGrammar) !== JSON.stringify(expected.grammarIds)) {
      throw new Error(`${lesson.label}: new vocabulary and grammar must match the existing lesson inventory and order`)
    }
    for (const section of lesson.sections) {
      if (section.kind === 'vocabulary' && section.role === 'review') {
        if (section.words.some(label => !vocabulary.has(resolveWord(label)))) {
          throw new Error(`${lesson.label}: review vocabulary must come from an earlier lesson`)
        }
      }
      if (section.kind === 'grammar' && section.role === 'review' && !constructions.has(resolveGrammar(section.grammar))) {
        throw new Error(`${lesson.label}: review grammar must come from an earlier lesson`)
      }
    }
    newWords.forEach(id => vocabulary.add(id))
    newGrammar.forEach(id => constructions.add(id))
    cutoffs.set(lesson.label, { vocabulary: new Set(vocabulary), grammar: new Set(constructions) })
  }
  const checkUtterance = (utterance, lesson, context) => {
    for (const segment of utterance.segments) {
      if ('word' in segment && !cutoffs.get(lesson).vocabulary.has(resolveWord(segment.word))) {
        throw new Error(`${context}: vocabulary ${segment.word} is after the lesson cutoff`)
      }
    }
  }
  for (const model of source.models) {
    if (!lessons.has(model.lesson)) throw new Error(`${model.label}: unknown introduction lesson`)
    const cutoff = cutoffs.get(model.lesson)
    for (const utterance of modelUtterances(model)) checkUtterance(utterance, model.lesson, model.label)
    for (const label of model.requires.grammar) {
      if (!cutoff.grammar.has(resolveGrammar(label))) throw new Error(`${model.label}: grammar ${label} is after the lesson cutoff`)
    }
    for (const label of model.requires.concepts) {
      const prerequisite = models.get(label)
      if (!prerequisite || prerequisite.kind !== 'concept' || order.get(prerequisite.lesson) > order.get(model.lesson)) {
        throw new Error(`${model.label}: concept ${label} must be introduced earlier`)
      }
    }
    if (model.kind === 'conversation') {
      const speakers = uniqueMap(model.speakers, 'speaker')
      if (model.turns.some(turn => !speakers.has(turn.speaker))) throw new Error(`${model.label}: unknown conversation speaker`)
    }
  }
  const introduced = new Set()
  for (const lesson of source.lessons) {
    const included = new Set()
    for (const section of lesson.sections) {
      if (section.kind === 'grammar') {
        section.examples.forEach(example => checkUtterance(example, lesson.label, lesson.label))
      }
      if (section.kind !== 'models') continue
      for (const label of section.models) {
        const model = models.get(label)
        if (!model || order.get(model.lesson) > order.get(lesson.label)) throw new Error(`${lesson.label}: unknown or future model ${label}`)
        if (included.has(label)) throw new Error(`${lesson.label}: duplicate model reference ${label}`)
        included.add(label)
        for (const concept of model.requires.concepts) {
          if (!introduced.has(concept)) throw new Error(`${lesson.label}: concept ${concept} must appear before its dependent model`)
        }
        if (model.lesson === lesson.label) introduced.add(label)
      }
    }
    if (!included.size) throw new Error(`${lesson.label}: a lesson needs instructional models`)
  }
  for (const model of source.models) {
    if (!introduced.has(model.label)) throw new Error(`${model.label}: model missing from its introduction lesson`)
  }
  const units = new Set(source.lessons.map(lesson => lesson.unit))
  for (const unit of units) {
    for (const kind of ['concept', 'phrase', 'conversation', 'exercise']) {
      if (!source.models.some(model => lessons.get(model.lesson).unit === unit && model.kind === kind)) {
        throw new Error(`${unit}: missing ${kind} model`)
      }
    }
  }
  return { ...source, labels }
}

export async function generateLearningContent(curriculum, { check = false } = {}) {
  const source = parse(await readFile(learningContentSource, 'utf8'))
  const registry = parse(await readFile(labelRegistrySource, 'utf8'))
  const document = validateLearningContent(source, curriculum, registry)
  const expected = `${JSON.stringify(document, null, 2)}\n`
  if (check) {
    let actual
    try {
      actual = await readFile(outputPath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      throw new Error('Missing learning-content.generated.json; run npm run curriculum:generate', { cause: error })
    }
    if (actual !== expected) throw new Error('Stale learning-content.generated.json; run npm run curriculum:generate')
  } else {
    await writeFile(outputPath, expected)
  }
  return document
}
