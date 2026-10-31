import { z } from 'zod'
import exercisePrompt from '../../../settings/system-prompts/exercises.md?raw'
import { omit } from '../omit'
import { requestStructuredJSON } from '../ai/structured'
import { AITransportError } from '../ai/provider'
import type { AIConnectionInput } from '../assistant/contracts'
import { renderExample, type Catalog, type Unit } from './catalog'
import { exerciseSchema, type Exercise, type MatchExercise, type TilesExercise } from './contracts'

// AI exercise generation over the learner's known units. The model proposes
// exercises; the app validates every Chinese string against the allowed
// vocabulary and drops anything it cannot account for. Nothing is repaired.

export const EXERCISES_PER_SESSION = 20
export const MIN_EXERCISES_PER_SESSION = 8
export const MAX_EXERCISES_PER_SESSION = 40
/** One AI request never asks for more than this many exercises; larger lessons go out as parallel requests. */
export const MAX_EXERCISES_PER_REQUEST = 20
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
  tiles: z.array(z.string()).min(2).max(16), distractors: z.array(z.string()).max(3), acceptedAnswers: z.array(z.string()).max(8).optional(), explanation: z.string(),
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
            required: ['id', 'type', 'targets', 'translation', 'tiles', 'distractors', 'acceptedAnswers', 'explanation'],
            properties: {
              id: stringSchema(200), type: { type: 'string', enum: ['tiles'] },
              targets: { type: 'array', minItems: 1, maxItems: 6, items: stringSchema(200) },
              translation: stringSchema(400),
              tiles: { type: 'array', minItems: 2, maxItems: 16, items: stringSchema(12) },
              distractors: { type: 'array', minItems: 0, maxItems: 3, items: stringSchema(12) },
              acceptedAnswers: { type: 'array', minItems: 0, maxItems: 4, items: stringSchema(80) },
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
  /** The known forms found in the text, left to right, longest first at each position; characters no form covers are skipped. */
  segment(text: string): string[]
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
    segment(text: string) {
      const found: string[] = []
      for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
        let start = 0
        while (start < run.length) {
          let length = Math.min(longest, run.length - start)
          while (length > 0 && !set.has(run.slice(start, start + length))) length--
          if (length > 0) { found.push(run.slice(start, start + length)); start += length } else start++
        }
      }
      return found
    },
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
  /** Free phrases (a collection's whole lines) practised as targets. They have no curriculum record; their own text is allowed. */
  phrases?: PhraseTarget[]
}

export interface PhraseTarget { ref: string; text: string; translation?: string; /** Set for a single word drawn from a media source (a source entry); absent for a whole sentence. */ pinyin?: string }

/** Every substring of a phrase's Han runs (up to 12 characters) counts as known text for that phrase's exercises. */
function phraseForms(phrases: PhraseTarget[] = []): string[] {
  const forms = new Set<string>()
  for (const phrase of phrases) {
    for (const run of phrase.text.match(/\p{Script=Han}+/gu) ?? []) {
      for (let start = 0; start < run.length; start++) for (let length = 1; length <= 12 && start + length <= run.length; length++) forms.add(run.slice(start, start + length))
    }
  }
  return [...forms]
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
  const phrases = input.phrases ?? []
  const otherVocabulary = input.allowed.filter(unit => unit.kind === 'vocabulary' && !focus.has(unit.ref))
  const otherGrammar = input.allowed.filter(unit => unit.kind === 'grammar' && !focus.has(unit.ref))
  const vocabulary = sample(otherVocabulary, Math.max(0, MAX_VOCABULARY_IN_PROMPT - input.targets.length - input.review.length), input.allowed.length)
  return {
    system: exercisePrompt.trim(),
    user: JSON.stringify({
      mode: input.mode,
      requestedExercises: count,
      targets: [...input.targets.map(unit => describeUnit(input.catalog, unit)),
        ...phrases.map(phrase => ({ ref: phrase.ref, kind: phrase.pinyin ? 'word' : 'phrase', chinese: phrase.text, ...(phrase.pinyin ? { pinyin: phrase.pinyin } : {}), ...(phrase.translation ? { meaning: phrase.translation } : {}) }))],
      alsoReview: input.review.map(unit => describeUnit(input.catalog, unit)),
      otherKnownVocabulary: vocabulary.map(unit => unit.kind === 'vocabulary' ? `${unit.record.ch} (${unit.record.pr}): ${unit.record.ds}` : ''),
      otherKnownGrammar: otherGrammar.slice(0, 60).map(unit => unit.kind === 'grammar' ? `${unit.record.pt}: ${unit.record.ds}` : ''),
      rules: [
        'Every Chinese word in every exercise must come from targets, alsoReview or otherKnownVocabulary. No other words.',
        `Each target must appear in at least two exercises, ideally of different types. Produce about ${count} exercises.`,
        'Reference targets and alsoReview items by their ref string in the targets field.',
        'The English prompt of a tiles exercise must render every meaning-bearing word of the Chinese answer: 都 is "all", 也 is "also", 了 is shown where English marks it, measure-word quantities are stated ("three cups of tea"). "They rest in the afternoon." is wrong for 她们下午都休息; write "They all rest in the afternoon.".',
        'For a tiles exercise, put other natural answers built from the same tiles in acceptedAnswers (for example 她们都下午休息 beside 她们下午都休息), or [] when there are none.',
        ...(phrases.length ? ['A target of kind phrase is a whole sentence the learner met: use its words and fragments freely, and build exercises on the phrase itself.'] : []),
      ],
    }),
  }
}

export interface ValidationResult {
  exercises: Exercise[]
  rejected: string[]
}

function randomIndexes(count: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[order[index], order[other]] = [order[other], order[index]]
  }
  return order
}

export function shuffleIndexes(count: number): number[] {
  const order = randomIndexes(count)
  // Avoid presenting the answer order unchanged when there is any alternative.
  if (count > 1 && order.every((value, index) => value === index)) return [...order.slice(1), order[0]]
  return order
}

/** What an answer is compared by: Han text without spaces or punctuation. */
export function answerKey(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '')
}

export function validateProposal(value: unknown, input: GenerationInput): ValidationResult {
  const parsed = proposalSchema.safeParse(value)
  if (!parsed.success) throw new AITransportError('The AI returned exercises in an unsupported shape. Enable structured output in Settings or try again.')
  const allowedRefs = new Set([...input.targets, ...input.review].map(unit => unit.ref))
  for (const phrase of input.phrases ?? []) allowedRefs.add(phrase.ref)
  const segmenter = createSegmenter([...input.allowed.flatMap(unit => unit.kind === 'vocabulary' ? [unit.record.ch] : []), ...phraseForms(input.phrases)])
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
      const main = answerKey(tiles.join(''))
      // Alternatives face the same checks as the answer; the bad ones are dropped quietly and the exercise stays.
      const accepted = [...new Map((proposal.acceptedAnswers ?? []).map(answer => [answerKey(answer), answer.replace(/\s+/g, '')] as const)).entries()]
        .filter(([key, answer]) => key !== main && han.test(answer) && segmenter.covers(answer) && !/[A-Za-z0-9]/.test(key))
        .map(([, answer]) => answer).slice(0, 4)
      candidate = { ...omit(proposal, 'acceptedAnswers'), targets, tiles, distractors, ...(accepted.length ? { acceptedAnswers: accepted } : {}), shuffled: shuffleIndexes(tiles.length + distractors.length) }
    }
    const result = exerciseSchema.safeParse(candidate)
    if (!result.success) { reject(result.error.issues.map(issue => issue.message).join('; ').slice(0, 200)); continue }
    ids.add(proposal.id)
    const exercise = result.data
    if (exercise.type === 'choice') {
      // Shuffle only validated, newly generated choices; identity is a valid permutation.
      const order = randomIndexes(exercise.options.length)
      exercises.push({ ...exercise, options: order.map(index => exercise.options[index]), answer: order.indexOf(exercise.answer) })
    } else {
      exercises.push(exercise)
    }
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

/** Splits a lesson's exercise count into request sizes of at most MAX_EXERCISES_PER_REQUEST, as even as possible (40 gives 20 + 20). */
export function splitCount(count: number): number[] {
  const requests = Math.max(1, Math.ceil(count / MAX_EXERCISES_PER_REQUEST))
  const base = Math.floor(count / requests)
  return Array.from({ length: requests }, (_, index) => base + (index < count - base * requests ? 1 : 0))
}

/**
 * Generates about `count` exercises: one request, or parallel requests of up to 20 whose results are joined. Never one request per word.
 * The count is what the model is asked for, not a target: a lesson keeps whatever survives validation (at least MIN_USABLE_EXERCISES per request).
 */
export async function generateBatched(connection: AIConnectionInput, input: GenerationInput, count: number, signal?: AbortSignal, onBatch?: (batch: ValidationResult) => void | Promise<void>): Promise<ValidationResult> {
  const sizes = splitCount(count)
  const parts = await Promise.all(sizes.map(async (size, index) => {
    const result = await generateExercises(connection, { ...input, count: size }, signal)
    const part = sizes.length === 1 ? result : { ...result, exercises: result.exercises.map(exercise => ({ ...exercise, id: `b${index + 1}-${exercise.id}` })) }
    // Each batch is handed over as it arrives, so a lesson does not wait for its slowest request.
    await onBatch?.(part)
    return part
  }))
  return { exercises: parts.flatMap(part => part.exercises), rejected: parts.flatMap(part => part.rejected) }
}

/** Like generateBatched, but a failed batch does not discard the others: every batch that succeeds is delivered, and the first failure is returned. */
export async function generateStreaming(connection: AIConnectionInput, input: GenerationInput, count: number, signal: AbortSignal | undefined, onBatch: (batch: ValidationResult) => void | Promise<void>): Promise<{ delivered: number; rejected: string[]; failure?: Error }> {
  const sizes = splitCount(count)
  let delivered = 0
  const rejected: string[] = []
  let failure: Error | undefined
  await Promise.all(sizes.map(async (size, index) => {
    try {
      const result = await generateExercises(connection, { ...input, count: size }, signal)
      const part = sizes.length === 1 ? result : { ...result, exercises: result.exercises.map(exercise => ({ ...exercise, id: `b${index + 1}-${exercise.id}` })) }
      rejected.push(...part.rejected)
      await onBatch(part)
      delivered += part.exercises.length
    } catch (reason) {
      failure ??= reason instanceof Error ? reason : new Error('The exercises could not be generated.')
    }
  }))
  return { delivered, rejected, ...(failure ? { failure } : {}) }
}

export type AnswerMatch = 'main' | 'alternative' | 'wrong'

/** How a built sentence compares with the exercise's answer: the tiles in order, an accepted alternative, or neither. */
export function matchTiles(exercise: TilesExercise, tiles: string[]): AnswerMatch {
  const given = answerKey(tiles.join(''))
  if (given === answerKey(exercise.tiles.join(''))) return 'main'
  return (exercise.acceptedAnswers ?? []).some(answer => answerKey(answer) === given) ? 'alternative' : 'wrong'
}

/**
 * A match response is the list of refs the learner paired wrongly (one entry per wrong pairing, charged to the item of the cell tapped first). Empty is a clean match.
 * Unknown refs are refused; the whole exercise is correct only with no misses.
 */
export function missedRefs(exercise: MatchExercise, response: unknown): string[] {
  if (!Array.isArray(response) || response.some(item => typeof item !== 'string')) throw new Error('Pair every word before checking.')
  const refs = new Set(exercise.pairs.map(pair => pair.ref))
  if (response.some(ref => !refs.has(ref as string))) throw new Error('That pairing does not belong to this exercise.')
  return response as string[]
}

function checkMatch(exercise: MatchExercise, response: unknown): { correct: boolean; response: string } {
  const misses = missedRefs(exercise, response)
  return { correct: misses.length === 0, response: JSON.stringify(misses) }
}

export function checkAnswer(exercise: Exercise, response: unknown): { correct: boolean; response: string } {
  if (exercise.type === 'choice') {
    const index = typeof response === 'number' ? response : Number.NaN
    if (!Number.isInteger(index) || index < 0 || index >= exercise.options.length) throw new Error('Choose one of the available answers.')
    return { correct: index === exercise.answer, response: String(index) }
  }
  if (exercise.type === 'match') return checkMatch(exercise, response)
  if (!Array.isArray(response) || response.some(item => typeof item !== 'string')) throw new Error('Arrange the tiles before checking.')
  const tiles = response as string[]
  return { correct: matchTiles(exercise, tiles) !== 'wrong', response: JSON.stringify(tiles) }
}
