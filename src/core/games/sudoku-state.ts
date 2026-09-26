import { sudokuGameSchema, type SudokuGame, type SudokuPuzzle, type SudokuSymbol } from './sudoku-contracts'
import { countSudokuSolutions, validSudoku } from './sudoku-generator'

export function createSudokuGame(puzzle: SudokuPuzzle, characters: SudokuSymbol[], random: () => number = Math.random): SudokuGame {
  if (characters.length < puzzle.size || new Set(characters.map(item => item.character)).size !== characters.length) {
    throw new Error(`Choose at least ${puzzle.size} distinct characters from your learning set.`)
  }
  const symbols = [...characters]
  for (let i = symbols.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[symbols[i], symbols[j]] = [symbols[j], symbols[i]]
  }
  return readSudokuGame({
    ...puzzle, id: 'current', gameId: crypto.randomUUID(), revision: 0,
    symbols: symbols.slice(0, puzzle.size), values: [...puzzle.givens],
    excluded: Array(puzzle.size ** 2).fill(0), history: [],
  })
}

export function readSudokuGame(value: unknown): SudokuGame {
  const game = sudokuGameSchema.parse(value)
  const count = game.size ** 2, mask = (1 << game.size) - 1
  if ([game.givens, game.solution, game.values, game.excluded].some(values => values.length !== count)
    || game.symbols.length !== game.size || new Set(game.symbols.map(item => item.character)).size !== game.size
    || [...game.givens, ...game.solution, ...game.values].some(value => value > game.size)
    || game.solution.includes(0) || !validSudoku(game.solution, game.size)
    || game.givens.some((value, i) => value !== 0 && (value !== game.solution[i] || value !== game.values[i]))
    || game.excluded.some((value, i) => value > mask || (game.givens[i] !== 0 && value !== 0))) {
    throw new Error('The saved Sudoku board is inconsistent.')
  }
  if (countSudokuSolutions(game.givens, game.size) !== 1) throw new Error('The saved Sudoku puzzle must have exactly one solution.')
  const values = [...game.values], excluded = [...game.excluded]
  for (const move of [...game.history].reverse()) {
    if (move.index >= count || game.givens[move.index] !== 0
      || move.before.value > game.size || move.after.value > game.size || move.before.excluded > mask || move.after.excluded > mask
      || move.after.value !== values[move.index] || move.after.excluded !== excluded[move.index]) {
      throw new Error('The saved Sudoku undo history is inconsistent.')
    }
    values[move.index] = move.before.value
    excluded[move.index] = move.before.excluded
  }
  return game
}

export type SudokuAction =
  | { type: 'place'; index: number; value: number }
  | { type: 'exclude'; index: number; value: number }
  | { type: 'clear-marks'; index: number }
  | { type: 'undo' }

export function applySudokuAction(game: SudokuGame, action: SudokuAction): SudokuGame {
  const values = [...game.values], excluded = [...game.excluded]
  if (action.type === 'undo') {
    const previous = game.history.at(-1)
    if (!previous) throw new Error('There is no Sudoku move to undo.')
    values[previous.index] = previous.before.value
    excluded[previous.index] = previous.before.excluded
    return { ...game, revision: game.revision + 1, values, excluded, history: game.history.slice(0, -1) }
  }
  const index = action.index
  if (!Number.isInteger(index) || index < 0 || index >= game.size ** 2 || game.givens[index] !== 0) {
    throw new Error('Choose an editable Sudoku cell.')
  }
  if (action.type !== 'clear-marks' && (!Number.isInteger(action.value) || action.value < (action.type === 'exclude' ? 1 : 0) || action.value > game.size)) {
    throw new Error('Choose a character from this puzzle.')
  }
  if (action.type === 'exclude' && values[index] !== 0) throw new Error('Erase this entry before adding scratch markers.')
  const before = { value: values[index], excluded: excluded[index] }
  if (action.type === 'place') values[index] = action.value
  else if (action.type === 'exclude') excluded[index] ^= 1 << (action.value - 1)
  else excluded[index] = 0
  const after = { value: values[index], excluded: excluded[index] }
  return { ...game, revision: game.revision + 1, values, excluded, history: [...game.history, { index, before, after }].slice(-200) }
}
