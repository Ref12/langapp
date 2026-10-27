import { db } from '../database'
import { applySudokuAction, readSudokuGame, type SudokuAction } from './sudoku-state'
import type { SudokuGame } from './sudoku-contracts'
import { createSavedSudokuBoard, MAX_SAVED_SUDOKU_BOARDS, readSavedSudokuBoard, SAVED_SUDOKU_PREFIX, type SavedSudokuBoard } from './sudoku-saved'

// Saved boards share the sudokuGames table with the live game (id 'current'), so they ride along in backups.
const boards = () => db.table<SavedSudokuBoard, string>('sudokuGames')
const savedRows = () => boards().where('id').startsWith(SAVED_SUDOKU_PREFIX)

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

/** Newest first. Rows that fail validation are skipped. */
export async function listSavedSudokuBoards(): Promise<SavedSudokuBoard[]> {
  const rows = await savedRows().toArray()
  const valid: SavedSudokuBoard[] = []
  for (const row of rows) { try { valid.push(readSavedSudokuBoard(row)) } catch { /* skip an unreadable row */ } }
  return valid.sort((a, b) => b.savedAt - a.savedAt)
}

/** Stores a snapshot of the live board as a new row; the live row is never written. */
export async function saveSudokuBoard(expected: SudokuGame, now = Date.now()): Promise<SavedSudokuBoard> {
  return db.transaction('rw', db.sudokuGames, async () => {
    const live = await db.sudokuGames.get('current')
    if (!live || live.gameId !== expected.gameId || live.revision !== expected.revision) {
      throw new Error('This Sudoku puzzle changed in another tab. Try again on the current board.')
    }
    if (await savedRows().count() >= MAX_SAVED_SUDOKU_BOARDS) {
      throw new Error(`You already have ${MAX_SAVED_SUDOKU_BOARDS} saved boards. Delete one before saving another.`)
    }
    const row = createSavedSudokuBoard(readSudokuGame(live), now)
    await boards().put(row)
    return row
  })
}

/** Replaces the live board with a validated copy of the snapshot (new game id, so other tabs notice). */
export async function resumeSudokuBoard(id: string): Promise<SudokuGame> {
  return db.transaction('rw', db.sudokuGames, async () => {
    const row = await boards().get(id)
    if (!row || !id.startsWith(SAVED_SUDOKU_PREFIX)) throw new Error('That saved board no longer exists.')
    const game = { ...readSavedSudokuBoard(row).game, gameId: crypto.randomUUID(), revision: 0 }
    await db.sudokuGames.put(game)
    return game
  })
}

export async function deleteSavedSudokuBoard(id: string): Promise<void> {
  if (!id.startsWith(SAVED_SUDOKU_PREFIX)) throw new Error('Only saved boards can be deleted.')
  await boards().delete(id)
}

/** True when the live board has edits that no saved board captures. */
export function hasUnsavedSudokuProgress(game: SudokuGame, saved: readonly SavedSudokuBoard[]): boolean {
  return game.revision > 0 && !saved.some(row => row.sourceGameId === game.gameId && row.sourceRevision === game.revision)
}
