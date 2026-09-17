import { z } from 'zod'

const label = z.string().min(1).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
export const wordLabelSchema = z.string().regex(/^[a-z]+[1-5](?:-[a-z]+[1-5])*--[a-z]+(?:-[a-z]+)*$/)
// Keep target language in referenced utterances, not untracked prose.
const prose = z.string().trim().min(1).max(4000).regex(/^[^\u3400-\u9fff<>]+$/)
  .regex(/^(?![\s\S]*[a-z]+[1-5]--[a-z])/, 'Keep vocabulary labels in structured references, not narration prose')
const segment = z.union([
  z.object({ word: wordLabelSchema }).strict(),
  z.object({ punctuation: z.string().min(1).regex(/^[，。？！、：；…,.?!:; ]+$/) }).strict(),
])
export const utteranceSchema = z.object({
  segments: z.array(segment).min(1).max(80),
  translation: prose,
}).strict().refine(value => value.segments.some(part => 'word' in part), 'An utterance needs vocabulary')

const common = {
  label,
  lesson: label,
  title: prose.max(120),
  description: prose,
  requires: z.object({
    grammar: z.array(label),
    concepts: z.array(label),
  }).strict(),
}
export const learningModelSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('concept'),
    category: z.enum(['sound-system', 'pragmatics', 'learning-strategy', 'culture']),
    examples: z.array(utteranceSchema).min(1),
  }).strict(),
  z.object({ ...common, kind: z.literal('phrase'), utterance: utteranceSchema }).strict(),
  z.object({
    ...common,
    kind: z.literal('conversation'),
    speakers: z.array(z.object({ label, name: prose.max(80) }).strict()).min(2),
    turns: z.array(z.object({ speaker: label, utterance: utteranceSchema }).strict()).min(2),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('exercise'),
    prompt: prose,
    cue: utteranceSchema.optional(),
    answer: utteranceSchema,
    explanation: prose,
    responseSeconds: z.number().int().min(3).max(30),
  }).strict(),
])

const sectionCommon = { title: prose.max(120), description: prose }
export const lessonSectionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...sectionCommon, kind: z.literal('vocabulary'), role: z.enum(['new', 'review']),
    words: z.array(wordLabelSchema).min(1),
  }).strict(),
  z.object({
    ...sectionCommon, kind: z.literal('grammar'), role: z.enum(['new', 'review']),
    grammar: label, examples: z.array(utteranceSchema),
  }).strict(),
  z.object({
    ...sectionCommon, kind: z.literal('models'), models: z.array(label).min(1),
  }).strict(),
])
export const lessonDefinitionSchema = z.object({
  label,
  unit: label,
  part: z.number().int().min(1),
  title: prose.max(120),
  description: prose,
  objectives: z.array(prose).min(1),
  sections: z.array(lessonSectionSchema).min(1),
}).strict()

export const labelRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  words: z.array(z.object({
    label: wordLabelSchema,
    id: z.string().regex(/^zh-(?:hsk(?:[1-6]|7-9)-\d{5}|hsk2026-\d{5}|hsklegacy-\d{5}|hskpractice-\d{6})-s\d{3}$/),
  }).strict()).min(1),
  grammar: z.array(z.object({ label, id: z.string().regex(/^zh-hsk[1-6]-g\d{3}$/) }).strict()).min(1),
}).strict()

export const learningSourceSchema = z.object({
  schemaVersion: z.literal(2),
  level: z.literal(1),
  title: prose,
  source: z.literal('original-zh'),
  reviewStatus: z.literal('draft'),
  lessons: z.array(lessonDefinitionSchema).min(1),
  models: z.array(learningModelSchema).min(1),
}).strict()
export const learningDocumentSchema = learningSourceSchema.extend({ labels: labelRegistrySchema }).strict()

/** @param {number} level @param {import('zod').infer<typeof lessonDefinitionSchema>} lesson */
export function lessonRouteId(level, lesson) {
  return `zh-level-${String(level).padStart(2, '0')}:${lesson.unit}:part-${lesson.part}`
}

/** @param {import('zod').infer<typeof learningModelSchema>} model */
export function modelUtterances(model) {
  switch (model.kind) {
    case 'concept': return model.examples
    case 'phrase': return [model.utterance]
    case 'conversation': return model.turns.map(turn => turn.utterance)
    case 'exercise': return [...(model.cue ? [model.cue] : []), model.answer]
  }
}
