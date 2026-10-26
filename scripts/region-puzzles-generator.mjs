// @ts-check
import { z } from 'zod'
import {
  DIFFICULTIES, GENERATOR_VERSION, MAX_ATTEMPTS, RULES_VERSION, SOLVER_VERSION,
  attemptSchema, difficultySchema, recipeSchema, seedSchema, sizeSchema,
} from '../src/core/games/regions/schema.mjs'
import {
  canonicalBoardKey, countSolutions, neighbors, validateBoard, validateSolution,
} from '../src/core/games/regions/rules.mjs'
import { gradeBoard } from '../src/core/games/regions/logic.mjs'
import { validateBank } from '../src/core/games/regions/validate.mjs'

/** @typedef {import('../src/core/games/regions/types').RegionRecipe} Recipe */
/** @typedef {import('../src/core/games/regions/types').RegionPuzzle} Puzzle */
/** @typedef {import('../src/core/games/regions/types').RegionBank} Bank */

/** Published recipes are fixed. Custom recipes share the same versioned
 * algorithm, PRNG, seed derivation, tie-breaking and solver.
 * @type {Recipe[]} */
export const DEFAULT_RECIPES = [5, 6, 7, 8, 9].map(size => ({
  size,
  seed: (0x72656700 + size) >>> 0,
  quotas: { easy: 2, medium: 2, hard: size === 9 ? 1 : 2 },
  maxAttempts: 5000,
}))

export const generationRequestSchema = z.object({
  size: sizeSchema,
  count: attemptSchema,
  seed: seedSchema.optional(),
  difficulty: z.union([z.literal('any'), difficultySchema]).default('any'),
  maxAttempts: attemptSchema.optional(),
}).strict()

/** @typedef {z.input<typeof generationRequestSchema>} GenerationRequest */
/** @typedef {{attempt: number, maxAttempts: number, target: number, counts: Recipe['quotas']}} GenerationProgress */
/** @typedef {{onProgress?: (progress: GenerationProgress) => void}} GenerationOptions */

/** Mulberry32, specified with integer operations; no Math.random or clock seed.
 * @param {number} seed */
function randomSource(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** @template T @param {T[]} values @param {() => number} random */
function shuffle(values, random) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/** Each attempt has an independent seed, so it can be reproduced without
 * generating any earlier attempts. Growth always attaches orthogonally.
 * @param {number} size @param {number} seed @param {number} attempt */
export function generateCandidate(size, seed, attempt) {
  sizeSchema.parse(size)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) {
    throw new Error(`Expected uint32 seed and attempt from 1 to ${MAX_ATTEMPTS}`)
  }
  const random = randomSource((seed ^ Math.imul(attempt, 0x9e3779b1) ^ Math.imul(size, 0x85ebca6b)) >>> 0)
  const allColumns = Array.from({ length: size }, (_, index) => index)
  /** @type {number[]} */
  const solution = []
  let nodes = 0
  function place() {
    if (++nodes > 1000000) throw new Error('Solution-seed search exceeded its node budget')
    if (solution.length === size) return true
    for (const column of shuffle(allColumns, random)) {
      if (solution.includes(column) ||
          (solution.length && Math.abs(solution[solution.length - 1] - column) <= 1)) continue
      solution.push(column)
      if (place()) return true
      solution.pop()
    }
    return false
  }
  if (!place()) throw new Error(`Could not construct a marker permutation for size ${size}`)

  const regions = new Array(size * size).fill(-1)
  solution.forEach((column, row) => { regions[row * size + column] = row })
  // Uneven growth rates produce both small footholds and broad regions.
  const weights = allColumns.map(() => 0.03 + random() ** 3)
  for (let remaining = size * size - size; remaining > 0; remaining--) {
    /** @type {{cell: number, region: number, weight: number}[]} */
    const frontier = []
    for (let cell = 0; cell < regions.length; cell++) {
      if (regions[cell] !== -1) continue
      const adjoining = [...new Set(neighbors(cell, size).map(other => regions[other]).filter(region => region >= 0))]
      for (const region of adjoining) frontier.push({ cell, region, weight: weights[region] })
    }
    if (!frontier.length) throw new Error('Region growth ran out of frontier cells')
    let choice = random() * frontier.reduce((sum, entry) => sum + entry.weight, 0)
    let selected = frontier[frontier.length - 1]
    for (const entry of frontier) {
      choice -= entry.weight
      if (choice < 0) {
        selected = entry
        break
      }
    }
    regions[selected.cell] = selected.region
  }
  // Canonical first-seen labeling makes consumers independent of seed markers.
  /** @type {Map<number, number>} */
  const labels = new Map()
  const board = validateBoard({
    size,
    regions: regions.map(region => {
      if (!labels.has(region)) labels.set(region, labels.size)
      return /** @type {number} */ (labels.get(region))
    }),
  })
  validateSolution(board, solution)
  return { board, solution }
}

/** Fails closed when a requested tier cannot be filled within the recipe.
 * @param {Recipe} input @param {GenerationOptions} options @returns {Bank} */
export function generateBank(input, options = {}) {
  const recipe = recipeSchema.parse(input)
  return collectBank(recipe, Object.values(recipe.quotas).reduce((sum, count) => sum + count, 0), options)
}

/** Collect a requested total, categorized by the actual weakest solving tier.
 * The resulting exact quotas form a self-contained replayable v1 recipe.
 * @param {GenerationRequest} input @param {GenerationOptions} options @returns {Bank} */
export function generatePuzzles(input, options = {}) {
  const request = generationRequestSchema.parse(input)
  const maxAttempts = request.maxAttempts ?? Math.min(MAX_ATTEMPTS, Math.max(5000, request.count * 1000))
  if (request.count > maxAttempts) throw new Error('Puzzle count cannot exceed the maximum attempts')
  const quotas = {
    easy: request.difficulty === 'any' || request.difficulty === 'easy' ? request.count : 0,
    medium: request.difficulty === 'any' || request.difficulty === 'medium' ? request.count : 0,
    hard: request.difficulty === 'any' || request.difficulty === 'hard' ? request.count : 0,
  }
  return collectBank({
    size: request.size,
    seed: request.seed ?? (0x72656700 + request.size),
    quotas,
    maxAttempts,
  }, request.count, options)
}

/** @param {Recipe} recipe @param {number} target @param {GenerationOptions} options @returns {Bank} */
function collectBank(recipe, target, { onProgress }) {
  /** @type {Puzzle[]} */
  const puzzles = []
  const keys = new Set()
  const counts = { easy: 0, medium: 0, hard: 0 }
  const diagnostics = { nonunique: 0, ungraded: 0, duplicate: 0, filtered: 0 }
  let attempted = 0
  const reportProgress = () => onProgress?.({
    attempt: attempted, maxAttempts: recipe.maxAttempts, target, counts: { ...counts },
  })
  for (let attempt = 1; attempt <= recipe.maxAttempts && puzzles.length < target; attempt++) {
    if (attempted % 1000 === 0) reportProgress()
    attempted = attempt
    const { board, solution } = generateCandidate(recipe.size, recipe.seed, attempt)
    const exact = countSolutions(board)
    if (exact.count !== 1) {
      diagnostics.nonunique++
      continue
    }
    const grade = gradeBoard(board)
    if (!grade) {
      diagnostics.ungraded++
      continue
    }
    if (counts[grade.difficulty] >= recipe.quotas[grade.difficulty]) {
      diagnostics.filtered++
      continue
    }
    const key = canonicalBoardKey(board)
    if (keys.has(key)) {
      diagnostics.duplicate++
      continue
    }
    keys.add(key)
    puzzles.push({
      id: `regions-v1-${recipe.size}-${recipe.seed.toString(16).padStart(8, '0')}-${attempt}`,
      ...board, attempt, difficulty: grade.difficulty, solution, trace: grade.trace,
    })
    counts[grade.difficulty]++
  }
  reportProgress()
  if (puzzles.length < target) {
    throw new Error(`Size ${recipe.size}: exhausted ${recipe.maxAttempts} attempts; ` +
      `achieved ${JSON.stringify(counts)}, requested ${target} with tier limits ${JSON.stringify(recipe.quotas)}, ` +
      `rejections ${JSON.stringify(diagnostics)}. No partial bank was emitted. ` +
      'Increase --max-attempts, change --seed, or request fewer puzzles/a different difficulty.')
  }
  puzzles.sort((a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty) ||
    a.attempt - b.attempt)
  return validateBank({
    schemaVersion: 1,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    solverVersion: SOLVER_VERSION,
    recipe: { ...recipe, quotas: counts }, puzzles,
  })
}

/** @param {Bank} bank */
export function serializeBank(bank) {
  return `${JSON.stringify(bank, null, 2)}\n`
}
