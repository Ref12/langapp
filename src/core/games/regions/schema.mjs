// @ts-check
import { z } from 'zod'

export const RULES_VERSION = 'regions-no-touch-v1'
export const GENERATOR_VERSION = 'region-growth-v1'
export const SOLVER_VERSION = 'region-logic-v1'
export const DIFFICULTIES = /** @type {const} */ (['easy', 'medium', 'hard'])
export const SIZE_MIN = 5
export const SIZE_MAX = 9
// Attempt seeds use uint32 arithmetic; going beyond this would repeat the stream.
export const MAX_ATTEMPTS = 0xffffffff
export const attemptSchema = z.number().int().min(1).max(MAX_ATTEMPTS)

const index = z.number().int().nonnegative().max(SIZE_MAX - 1)
const cell = z.number().int().nonnegative().max(SIZE_MAX * SIZE_MAX - 1)
const cells = z.array(cell).max(SIZE_MAX * SIZE_MAX)
export const seedSchema = z.number().int().nonnegative().max(0xffffffff)
export const sizeSchema = z.number().int().min(SIZE_MIN).max(SIZE_MAX)
export const difficultySchema = z.enum(DIFFICULTIES)
export const houseKindSchema = z.enum(['row', 'column', 'region'])
export const houseSchema = z.object({ kind: houseKindSchema, index }).strict()

export const boardSchema = z.object({
  size: sizeSchema,
  regions: z.array(index).min(SIZE_MIN * SIZE_MIN).max(SIZE_MAX * SIZE_MAX),
}).strict().superRefine((board, ctx) => {
  if (board.regions.length !== board.size * board.size) {
    ctx.addIssue({ code: 'custom', path: ['regions'], message: 'Expected size squared cells' })
  }
  if (board.regions.some(region => region >= board.size)) {
    ctx.addIssue({ code: 'custom', path: ['regions'], message: 'Region index exceeds board size' })
  }
})

export const stepSchema = z.discriminatedUnion('technique', [
  z.object({
    technique: z.literal('single'), house: houseSchema, cell, eliminated: cells,
  }).strict(),
  z.object({
    technique: z.literal('confinement'), source: houseSchema, target: houseSchema,
    eliminated: cells.min(1),
  }).strict(),
  z.object({
    technique: z.literal('adjacency'), source: houseSchema, eliminated: cells.min(1),
  }).strict(),
  z.object({
    technique: z.literal('pair'), sources: z.array(houseSchema).length(2),
    targets: z.array(houseSchema).length(2), eliminated: cells.min(1),
  }).strict(),
  z.object({
    technique: z.literal('triple'), sources: z.array(houseSchema).length(3),
    targets: z.array(houseSchema).length(3), eliminated: cells.min(1),
  }).strict(),
])

export const puzzleSchema = z.object({
  id: z.string().regex(/^regions-v1-[5-9]-[0-9a-f]{8}-[1-9][0-9]*$/),
  size: sizeSchema,
  regions: boardSchema.innerType().shape.regions,
  attempt: attemptSchema,
  difficulty: difficultySchema,
  solution: z.array(index).min(SIZE_MIN).max(SIZE_MAX),
  trace: z.array(stepSchema).min(SIZE_MIN).max(SIZE_MAX * SIZE_MAX),
}).strict()

export const quotasSchema = z.object({
  easy: z.number().int().min(0).max(MAX_ATTEMPTS),
  medium: z.number().int().min(0).max(MAX_ATTEMPTS),
  hard: z.number().int().min(0).max(MAX_ATTEMPTS),
}).strict().refine(quotas => Object.values(quotas).some(count => count > 0),
  'At least one puzzle is required')

export const recipeSchema = z.object({
  size: sizeSchema,
  seed: seedSchema,
  quotas: quotasSchema,
  maxAttempts: attemptSchema,
}).strict()

export const bankSchema = z.object({
  schemaVersion: z.literal(1),
  rulesVersion: z.literal(RULES_VERSION),
  generatorVersion: z.literal(GENERATOR_VERSION),
  solverVersion: z.literal(SOLVER_VERSION),
  recipe: recipeSchema,
  puzzles: z.array(puzzleSchema).min(1).max(MAX_ATTEMPTS),
}).strict()
