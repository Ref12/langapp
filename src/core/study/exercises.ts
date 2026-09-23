import { z } from 'zod'
import exercisePrompt from '../../../settings/system-prompts/exercises.md?raw'
import { requestStructuredJSON } from '../ai/structured'
import { AITransportError } from '../ai/provider'
import type { AIConnectionInput } from '../assistant/contracts'
import { renderExample, type Catalog, type Unit } from './catalog'
import { exerciseSchema, type Exercise } from './contracts'

// AI exercise generation over the learner's known units. The model proposes
// exercises; the app validates every Chinese string against the allowed
// vocabulary and drops anything it cannot account for. Nothing is repaired.

export const EXERCISES_PER_SESSION = 10
export const MIN_USABLE_EXERCISES = 4
const MAX_VOCABULARY_IN_PROMPT = 400
const han = /\p{Script=Han}/u

const proposedChoice = z.object({
  id: z.string().min(1).max(200), type: z.literal('choice'),
  targets: z.array(z.string()).min(1).max(6), direction: z.enum(['zh-to-en', 'en-to-zh']),
  question: z.string(), options: z.array(z.string()).min(2).max(4), answer: z.number().int(), explanation: z.string(),
}).strict()
const proposedTiles = z.object({
  id: z.string().min(1).max(200), type: z.literal('tiles'),
  targets: z.array(z.string()).min(1).max(6), translation: z.string(),
  tiles: z.array(z.string()).min(2).max(16), distractors: z.array(z.string()).max(3), explanation: z.string(),
}).strict()
const proposalSchema = z.object({ exercises: z.array(z.discriminatedUnion('type', [proposedChoice, proposedTiles])).max(40) }).strict()

const stringSchema = (maxLength: number) => ({ type: 'string', maxLength })
export const exerciseJSONSchema = {
  type: 'object', additionalProperties: false, required: ['exercises'],
  properties: {
    exercises: {
      type: 'array', minItems: 1, maxItems: 40,
      items: {
        anyOf: [
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'type', 'targets', 'direction', 'question', 'options', 'answer', 'explanation'],
            properties: {
              id: stringSchema(200), type: { type: 'string', enum: ['choice'] },
              targets: { type: 'array', minItems: 1, maxItems: 6, items: stringSchema(200) },
              direction: { type: 'string', enum: ['zh-to-en', 'en-to-zh'] },
              question: stringSchema(400), options: { type: 'array', minItems: 2, maxItems: 4, items: stringSchema(200) },
              answer: { type: 'integer', minimum: 0, maximum: 3 }, explanation: stringSchema(400),
            },
          },
          {
            type: 'object', additionalProperties: false,
            required: ['id', 'type', 'targets', 'translation', 'tiles', 'distractors', 'explanation'],
            properties: {
              id: stringSchema(200), type: { type: 'string', enum: ['tiles'] },
              targets: { type: 'array', minItems: 1, maxItems: 6, items: stringSchema(200) },
              translation: stringSchema(400),
              tiles: { type: 'array', minItems: 2, maxItems: 16, items: stringSchema(12) },
              distractors: { type: 'array', minItems: 0, maxItems: 3, items: stringSchema(12) },
              explanation: stringSchema(400),
            },
          },
        ],
      },
    },
  },
}

export interface Segmenter {
  /** Returns true when every Han run in the text is a concatenation of allowed forms. */
  covers(text: string): boolean
  forms: Set<string>
}

export function createSegmenter(forms: Iterable<string>): Segmenter {
  const set = new Set([...forms].filter(form => han.test(form)))
  const longest = Math.max(1, ...[...set].map(form => form.length))
  const segmentable = (run: string): boolean => {
    const reachable = new Array<boolean>(run.length + 1).fill(false)
    reachable[0] = true
    for (let start = 0; start < run.length; start++) {
      if (!reachable[start]) continue
      for (let length = 1; length <= longest && start + length <= run.length; length++) {
        if (set.has(run.slice(start, start + length))) reachable[start + length] = true
      }
    }
    return reachable[run.length]
  }
  return {
    forms: set,
    covers(text: string) {
      const runs = text.match(/\p{Script=Han}+/gu) ?? []
      return runs.every(segmentable)
    },
  }
}

export interface GenerationInput {
  mode: 'new' | 'review'
  targets: Unit[]
  review: Unit[]
  /** Every unit in the learner's knowledge set plus the targets. */
  allowed: Unit[]
  catalog: Catalog
  count?: number
}

function describeUnit(catalog: Catalog, unit: Unit) {
  if (unit.kind === 'vocabulary') {
    return { ref: unit.ref, kind: 'vocabulary', chinese: unit.record.ch, pinyin: unit.record.pr, meaning: unit.record.ds }
  }
  const example = renderExample(catalog, unit.record.ex)
  return {
    ref: unit.ref, kind: 'grammar', pattern: unit.record.pt, pinyin: unit.record.pr, meaning: unit.record.ds,
    example: { chinese: example.text, translation: unit.record.ex.translation },
  }
}

function sample<T>(items: T[], size: number, seed: number): T[] {
  if (items.length <= size) return items
  const result = [...items]
  let state = seed
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) % 2147483648
    const other = state % (index + 1)
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result.slice(0, size)
}

export function buildGenerationPrompt(input: GenerationInput): { system: string; user: string } {
  const count = input.count ?? EXERCISES_PER_SESSION
  const focus = new Set([...input.targets, ...input.review].map(unit => unit.ref))
  const otherVocabulary = input.allowed.filter(unit => unit.kind === 'vocabulary' && !focus.has(unit.ref))
  const otherGrammar = input.allowed.filter(unit => unit.kind === 'grammar' && !focus.has(unit.ref))
  const vocabulary = sample(otherVocabulary, Math.max(0, MAX_VOCABULARY_IN_PROMPT - input.targets.length - input.review.length), input.allowed.length)
  return {
    system: exercisePrompt.trim(),
    user: JSON.stringify({
      mode: input.mode,
      requestedExercises: count,
      targets: input.targets.map(unit => describeUnit(input.catalog, unit)),
      alsoReview: input.review.map(unit => describeUnit(input.catalog, unit)),
      otherKnownVocabulary: vocabulary.map(unit => unit.kind === 'vocabulary' ? `${unit.record.ch} (${unit.record.pr}): ${unit.record.ds}` : ''),
      otherKnownGrammar: otherGrammar.slice(0, 60).map(unit => unit.kind === 'grammar' ? `${unit.record.pt}: ${unit.record.ds}` : ''),
      rules: [
        'Every Chinese word in every exercise must come from targets, alsoReview or otherKnownVocabulary. No other words.',
        `Each target must appear in at least two exercises, ideally of different types. Produce about ${count} exercises.`,
        'Reference targets and alsoReview items by their ref string in the targets field.',
      ],
    }),
  }
}

export interface ValidationResult {
  exercises: Exercise[]
  rejected: string[]
}

function shuffleIndexes(count: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[order[index], order[other]] = [order[other], order[index]]
  }
  // Avoid presenting the answer order unchanged when there is any alternative.
  if (count > 1 && order.every((value, index) => value === index)) return [...order.slice(1), order[0]]
  return order
}

export function validateProposal(value: unknown, input: GenerationInput): ValidationResult {
  const parsed = proposalSchema.safeParse(value)
  if (!parsed.success) throw new AITransportError('The AI returned exercises in an unsupported shape. Enable structured output in Settings or try again.')
  const allowedRefs = new Set([...input.targets, ...input.review].map(unit => unit.ref))
  const segmenter = createSegmenter(input.allowed.flatMap(unit => unit.kind === 'vocabulary' ? [unit.record.ch] : []))
  const rejected: string[] = []
  const exercises: Exercise[] = []
  const ids = new Set<string>()
  for (const proposal of parsed.data.exercises) {
    const reject = (reason: string) => rejected.push(`${proposal.id}: ${reason}`)
    if (ids.has(proposal.id)) { reject('duplicate id'); continue }
    const targets = [...new Set(proposal.targets)]
    if (targets.some(ref => !allowedRefs.has(ref))) { reject('targets an item outside this session'); continue }
    if (!segmenter.covers(proposal.explanation)) { reject('explanation uses vocabulary outside the known set'); continue }
    let candidate: unknown
    if (proposal.type === 'choice') {
      const chinese = proposal.direction === 'zh-to-en' ? [proposal.question] : proposal.options
      const english = proposal.direction === 'zh-to-en' ? proposal.options : [proposal.question]
      if (chinese.some(text => !han.test(text))) { reject('Chinese side has no Chinese text'); continue }
      if (chinese.some(text => !segmenter.covers(text))) { reject('uses vocabulary outside the known set'); continue }
      if (english.some(text => han.test(text))) { reject('English side contains Chinese text'); continue }
      candidate = { ...proposal, targets }
    } else {
      const tiles = proposal.tiles.map(tile => tile.trim())
      const distractors = proposal.distractors.map(tile => tile.trim())
      if ([...tiles, ...distractors].some(tile => !han.test(tile) || !segmenter.covers(tile))) { reject('tile uses vocabulary outside the known set'); continue }
      if (distractors.some(tile => tiles.includes(tile))) { reject('distractor duplicates an answer tile'); continue }
      if (han.test(proposal.translation)) { reject('translation contains Chinese text'); continue }
      candidate = { ...proposal, targets, tiles, distractors, shuffled: shuffleIndexes(tiles.length + distractors.length) }
    }
    const result = exerciseSchema.safeParse(candidate)
    if (!result.success) { reject(result.error.issues.map(issue => issue.message).join('; ').slice(0, 200)); continue }
    ids.add(proposal.id)
    exercises.push(result.data)
  }
  return { exercises, rejected }
}

export async function generateExercises(connection: AIConnectionInput, input: GenerationInput, signal?: AbortSignal): Promise<ValidationResult> {
  const prompt = buildGenerationPrompt(input)
  const value = await requestStructuredJSON(connection, {
    name: 'study_exercises', schema: exerciseJSONSchema, system: prompt.system, user: prompt.user, signal,
  })
  const result = validateProposal(value, input)
  if (result.exercises.length < MIN_USABLE_EXERCISES) {
    throw new AITransportError(`The AI produced only ${result.exercises.length} usable exercises (${result.rejected.length} rejected). Try again or choose a stronger model.`)
  }
  return result
}

export function checkAnswer(exercise: Exercise, response: unknown): { correct: boolean; response: string } {
  if (exercise.type === 'choice') {
    const index = typeof response === 'number' ? response : Number.NaN
    if (!Number.isInteger(index) || index < 0 || index >= exercise.options.length) throw new Error('Choose one of the available answers.')
    return { correct: index === exercise.answer, response: String(index) }
  }
  if (!Array.isArray(response) || response.some(item => typeof item !== 'string')) throw new Error('Arrange the tiles before checking.')
  const tiles = response as string[]
  const correct = tiles.length === exercise.tiles.length && tiles.every((tile, index) => tile === exercise.tiles[index])
  return { correct, response: JSON.stringify(tiles) }
}
