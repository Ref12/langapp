import { legacySudokuGameSchema, sudokuGameSchema, type SudokuGame, type SudokuPuzzle, type SudokuSymbol } from './sudoku-contracts'
import { countSudokuSolutions, validSudoku } from './sudoku-generator'

export function sudokuEntryValue(entries: number): number {
  return entries !== 0 && (entries & (entries - 1)) === 0 ? Math.log2(entries) + 1 : 0
}

export function sudokuComplete(game: SudokuGame): boolean {
  return game.entries.every((entry, index) => entry === 1 << (game.solution[index] - 1))
}

export function sudokuCheckCounts(game: SudokuGame) {
  let correct = 0, incorrect = 0, unresolved = 0
  game.entries.forEach((entries, index) => {
    if (game.givens[index]) return
    const value = sudokuEntryValue(entries)
    if (!value) unresolved++
    else if (value === game.solution[index]) correct++
    else incorrect++
  })
  return { correct, incorrect, unresolved }
}

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
    ...puzzle, version: 2, id: 'current', gameId: crypto.randomUUID(), revision: 0,
    symbols: symbols.slice(0, puzzle.size), entries: puzzle.givens.map(value => value ? 1 << (value - 1) : 0),
    checked: null, history: [],
  })
}

function migrateLegacy(value: unknown): SudokuGame {
  const legacy = legacySudokuGameSchema.parse(value)
  const count = legacy.size ** 2, all = (1 << legacy.size) - 1
  if (legacy.values.length !== count || legacy.excluded.length !== count
    || legacy.values.some(value => value > legacy.size)
    || legacy.excluded.some((mask, index) => mask > all || (legacy.givens[index] !== 0 && mask !== 0))) {
    throw new Error('The saved Sudoku board is inconsistent.')
  }
  const values = [...legacy.values], excluded = [...legacy.excluded]
  for (const move of [...legacy.history].reverse()) {
    if (move.index >= count || legacy.givens[move.index] !== 0
      || move.before.value > legacy.size || move.after.value > legacy.size || move.before.excluded > all || move.after.excluded > all
      || move.after.value !== values[move.index] || move.after.excluded !== excluded[move.index]) {
      throw new Error('The saved Sudoku undo history is inconsistent.')
    }
    values[move.index] = move.before.value
    excluded[move.index] = move.before.excluded
  }
  const convert = (value: number, excluded: number) => value ? 1 << (value - 1) : excluded ? all & ~excluded : 0
  const { values: oldValues, excluded: oldExcluded, history, ...base } = legacy
  return {
    ...base, version: 2, entries: oldValues.map((value, index) => convert(value, oldExcluded[index])), checked: null,
    history: history.map(move => ({
      index: move.index, before: convert(move.before.value, move.before.excluded), after: convert(move.after.value, move.after.excluded),
    })).filter(move => move.before !== move.after),
  }
}

export function readSudokuGame(value: unknown): SudokuGame {
  const current = typeof value === 'object' && value !== null && 'version' in value
  const game = sudokuGameSchema.parse(current ? value : migrateLegacy(value))
  const count = game.size ** 2, mask = (1 << game.size) - 1
  if ([game.givens, game.solution, game.entries, ...(game.checked ? [game.checked] : [])].some(values => values.length !== count)
    || game.symbols.length !== game.size || new Set(game.symbols.map(item => item.character)).size !== game.size
    || [...game.givens, ...game.solution].some(value => value > game.size)
    || game.solution.includes(0) || !validSudoku(game.solution, game.size)
    || game.givens.some((value, i) => value !== 0 && (value !== game.solution[i] || (1 << (value - 1)) !== game.entries[i]
      || (game.checked !== null && (1 << (value - 1)) !== game.checked[i])))
    || [...game.entries, ...(game.checked ?? [])].some(value => value > mask)) {
    throw new Error('The saved Sudoku board is inconsistent.')
  }
  if (countSudokuSolutions(game.givens, game.size) !== 1) throw new Error('The saved Sudoku puzzle must have exactly one solution.')
  const entries = [...game.entries]
  for (const move of [...game.history].reverse()) {
    if (move.index >= count || game.givens[move.index] !== 0 || move.before > mask || move.after > mask || move.after !== entries[move.index]) {
      throw new Error('The saved Sudoku undo history is inconsistent.')
    }
    entries[move.index] = move.before
  }
  return game
}

export type SudokuAction =
  | { type: 'toggle'; index: number; value: number }
  | { type: 'clear'; index: number }
  | { type: 'undo' }
  | { type: 'check' }

export function applySudokuAction(game: SudokuGame, action: SudokuAction): SudokuGame {
  const entries = [...game.entries]
  if (action.type === 'check') return { ...game, revision: game.revision + 1, checked: [...entries] }
  if (action.type === 'undo') {
    const previous = game.history.at(-1)
    if (!previous) throw new Error('There is no Sudoku move to undo.')
    entries[previous.index] = previous.before
    return { ...game, revision: game.revision + 1, entries, history: game.history.slice(0, -1) }
  }
  const index = action.index
  if (!Number.isInteger(index) || index < 0 || index >= game.size ** 2 || game.givens[index] !== 0) throw new Error('Choose an editable Sudoku cell.')
  if (action.type === 'toggle' && (!Number.isInteger(action.value) || action.value < 1 || action.value > game.size)) throw new Error('Choose a character from this puzzle.')
  const before = entries[index]
  entries[index] = action.type === 'clear' ? 0 : entries[index] ^ (1 << (action.value - 1))
  return { ...game, revision: game.revision + 1, entries, history: [...game.history, { index, before, after: entries[index] }].slice(-200) }
}
