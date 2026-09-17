import generated from './learning-content.generated.json'
import { learningDocumentSchema, lessonRouteId } from '../core/learning-content-schema.mjs'
import curriculum from './curriculum.generated.json'

export const learningContent = learningDocumentSchema.parse(generated)
const vocabulary = new Map(curriculum.words.map(word => [word.id, word]))
const grammar = new Map(curriculum.grammar.map(item => [item.id, item]))
export const contentWords = new Map(learningContent.labels.words.map(entry => {
  const word = vocabulary.get(entry.id)
  if (!word) throw new Error(`Unknown canonical vocabulary for ${entry.label}`)
  return [entry.label, { ...word, label: entry.label }]
}))
export const contentGrammar = new Map(learningContent.labels.grammar.map(entry => {
  const item = grammar.get(entry.id)
  if (!item) throw new Error(`Unknown canonical grammar for ${entry.label}`)
  return [entry.label, { ...item, label: entry.label }]
}))
export const contentWordLabels = new Map(learningContent.labels.words.map(entry => [entry.id, entry.label]))
export const contentGrammarLabels = new Map(learningContent.labels.grammar.map(entry => [entry.id, entry.label]))
export const contentModels = new Map(learningContent.models.map(model => [model.label, model]))
export const lessonDefinitions = new Map(learningContent.lessons.map(lesson => [lessonRouteId(learningContent.level, lesson), lesson]))
export const lessonRoutes = new Map(learningContent.lessons.map(lesson => [lesson.label, lessonRouteId(learningContent.level, lesson)]))

export function lessonLearningModels(lessonId: string) {
  const lesson = lessonDefinitions.get(lessonId)
  if (!lesson) return []
  return lesson.sections.flatMap(section => section.kind === 'models' ? section.models.map(label => {
    const model = contentModels.get(label)
    if (!model) throw new Error(`Unknown lesson model: ${label}`)
    return model
  }) : [])
}
