import { SAVED_SUDOKU_PREFIX, SAVED_SUDOKU_THUMBNAIL_MAX, savedSudokuBoardSchema, SUDOKU_BOXES, type SavedSudokuBoard, type SudokuGame } from './sudoku-contracts'
import { readSudokuGame, sudokuEntryValue } from './sudoku-state'

export { MAX_SAVED_SUDOKU_BOARDS, SAVED_SUDOKU_PREFIX, savedSudokuBoardSchema, type SavedSudokuBoard } from './sudoku-contracts'
const MAX_THUMBNAIL = SAVED_SUDOKU_THUMBNAIL_MAX

const n = (value: number) => String(Math.round(value * 10) / 10)

/** A compact SVG (about 120 px) of the grid: givens and entries as tinted cells, candidates as dots. */
export function sudokuThumbnail(game: SudokuGame): string {
  const size = game.size, cell = 120 / size, box = SUDOKU_BOXES[size]
  const build = (allDots: boolean) => {
    let givens = '', entries = '', dots = ''
    game.entries.forEach((mask, index) => {
      const x = (index % size) * cell, y = Math.floor(index / size) * cell
      if (game.givens[index]) { givens += `M${n(x)} ${n(y)}h${n(cell)}v${n(cell)}h-${n(cell)}z`; return }
      if (sudokuEntryValue(mask)) { entries += `M${n(x)} ${n(y)}h${n(cell)}v${n(cell)}h-${n(cell)}z`; return }
      const set = game.symbols.map((_, i) => i).filter(i => mask & (1 << i))
      const columns = size === 4 ? 2 : 3, step = cell / (columns + 1)
      for (const i of allDots ? set : set.slice(0, 1)) {
        dots += `M${n(x + step * (i % columns + 1))} ${n(y + step * (Math.floor(i / columns) + 1))}h0`
      }
    })
    let lines = ''
    for (let i = 1; i < size; i++) {
      if (i % box.rows === 0) lines += `M0 ${n(i * cell)}h120`
      if (i % box.columns === 0) lines += `M${n(i * cell)} 0v120`
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">'
      + '<rect width="120" height="120" fill="#fff"/>'
      + (givens ? `<path fill="#94a3b8" d="${givens}"/>` : '') + (entries ? `<path fill="#7dd3fc" d="${entries}"/>` : '')
      + (dots ? `<path stroke="#d97706" stroke-width="2.4" stroke-linecap="round" d="${dots}"/>` : '')
      + (lines ? `<path stroke="#334155" stroke-width="1.5" d="${lines}"/>` : '')
      + '<rect x=".5" y=".5" width="119" height="119" fill="none" stroke="#334155"/></svg>'
  }
  const full = build(true)
  return full.length <= MAX_THUMBNAIL ? full : build(false)
}

export function sudokuFilledCount(game: SudokuGame): number {
  return game.entries.filter(entries => sudokuEntryValue(entries) !== 0).length
}

export function createSavedSudokuBoard(game: SudokuGame, now = Date.now()): SavedSudokuBoard {
  return {
    id: SAVED_SUDOKU_PREFIX + crypto.randomUUID(), kind: 'saved-board', savedAt: now,
    label: game.symbols.map(symbol => symbol.character).join(' '), size: game.size, difficulty: game.difficulty,
    filled: sudokuFilledCount(game), checked: game.checked?.every((entries, index) => entries === game.entries[index]) === true,
    thumbnail: sudokuThumbnail(game), sourceGameId: game.gameId, sourceRevision: game.revision, game,
  }
}

/** Parses a stored or imported saved board, including the full Sudoku validation of its snapshot. */
export function readSavedSudokuBoard(value: unknown): SavedSudokuBoard {
  const board = savedSudokuBoardSchema.parse(value)
  return { ...board, game: readSudokuGame(board.game) }
}
