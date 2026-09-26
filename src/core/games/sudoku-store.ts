import { db } from '../database'
import { applySudokuAction, readSudokuGame, type SudokuAction } from './sudoku-state'
import type { SudokuGame } from './sudoku-contracts'

export async function updateSudoku(expected: SudokuGame, action: SudokuAction): Promise<SudokuGame> {
  return db.transaction('rw', db.sudokuGames, async () => {
    const value = await db.sudokuGames.get('current')
    if (!value || value.gameId !== expected.gameId || value.revision !== expected.revision) {
      throw new Error('This Sudoku puzzle changed in another tab. Try again on the current board.')
    }
    const next = applySudokuAction(readSudokuGame(value), action)
    await db.sudokuGames.put(next)
    return next
  })
}
