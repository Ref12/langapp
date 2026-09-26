import { z } from 'zod'
import { characterSchema } from '../characters/contracts'

export const sudokuSizeSchema = z.union([z.literal(4), z.literal(6), z.literal(9)])
export type SudokuSize = z.infer<typeof sudokuSizeSchema>
export const sudokuDifficultySchema = z.enum(['easy', 'medium', 'hard'])
export type SudokuDifficulty = z.infer<typeof sudokuDifficultySchema>
export const SUDOKU_BOXES: Record<SudokuSize, { rows: number; columns: number }> = {
  4: { rows: 2, columns: 2 }, 6: { rows: 2, columns: 3 }, 9: { rows: 3, columns: 3 },
}
export const sudokuRequestSchema = z.object({
  size: sudokuSizeSchema,
  difficulty: sudokuDifficultySchema,
  seed: z.number().int().min(0).max(0xffffffff),
}).strict()
export type SudokuRequest = z.infer<typeof sudokuRequestSchema>
const cells = z.array(z.number().int().min(0).max(9)).min(16).max(81)
export const sudokuPuzzleSchema = sudokuRequestSchema.extend({
  givens: cells,
  solution: cells,
}).strict()
export type SudokuPuzzle = z.infer<typeof sudokuPuzzleSchema>
export const sudokuSymbolSchema = z.object({
  character: characterSchema,
  contexts: z.array(z.object({
    text: z.string().min(1).max(100),
    pinyin: z.string().min(1).max(200),
    meaning: z.string().min(1).max(1000),
  }).strict()).max(3),
}).strict()
export type SudokuSymbol = z.infer<typeof sudokuSymbolSchema>
const cellState = z.object({ value: z.number().int().min(0).max(9), excluded: z.number().int().min(0).max(511) }).strict()
export const sudokuGameSchema = sudokuPuzzleSchema.extend({
  id: z.literal('current'),
  gameId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  symbols: z.array(sudokuSymbolSchema).min(4).max(9),
  values: cells,
  excluded: z.array(z.number().int().min(0).max(511)).min(16).max(81),
  history: z.array(z.object({
    index: z.number().int().min(0).max(80),
    before: cellState,
    after: cellState,
  }).strict()).max(200),
}).strict()
export type SudokuGame = z.infer<typeof sudokuGameSchema>
