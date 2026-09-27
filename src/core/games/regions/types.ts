import type { z } from 'zod'
import type {
  bankSchema, boardSchema, difficultySchema, houseSchema, puzzleSchema,
  recipeSchema, stepSchema,
} from './schema.mjs'

export type RegionBoard = z.infer<typeof boardSchema>
export type RegionHouse = z.infer<typeof houseSchema>
export type RegionDifficulty = z.infer<typeof difficultySchema>
export type RegionStep = z.infer<typeof stepSchema>
export type RegionPuzzle = z.infer<typeof puzzleSchema>
export type RegionBank = z.infer<typeof bankSchema>
export type RegionRecipe = z.infer<typeof recipeSchema>
