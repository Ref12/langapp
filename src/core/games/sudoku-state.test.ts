import { expect, it } from 'vitest'
import { generateSudoku } from './sudoku-generator'
import { applySudokuAction, createSudokuGame, readSudokuGame, sudokuCheckCounts, sudokuEntryValue } from './sudoku-state'

const characters = Array.from('天地人日月水火木金').map(character => ({ character, contexts: [] }))
const create = () => createSudokuGame(generateSudoku({ size: 4, difficulty: 'medium', seed: 42 }), characters, () => .5)

it('toggles candidate sets and treats only a singleton as the proposed answer', () => {
  const game = create(), index = game.givens.indexOf(0), given = game.givens.findIndex(Boolean)
  expect(() => applySudokuAction(game, { type: 'clear', index: given })).toThrow('editable')
  expect(() => applySudokuAction(game, { type: 'toggle', index, value: 9 })).toThrow('character')
  const first = applySudokuAction(game, { type: 'toggle', index, value: 2 })
  expect(sudokuEntryValue(first.entries[index])).toBe(2)
  const multiple = applySudokuAction(first, { type: 'toggle', index, value: 3 })
  expect(multiple.entries[index]).toBe(6)
  expect(sudokuEntryValue(multiple.entries[index])).toBe(0)
  const last = applySudokuAction(multiple, { type: 'toggle', index, value: 2 })
  expect(sudokuEntryValue(last.entries[index])).toBe(3)
  expect(applySudokuAction(last, { type: 'undo' }).entries).toEqual(multiple.entries)
  expect(applySudokuAction(last, { type: 'clear', index }).entries[index]).toBe(0)
  expect(readSudokuGame(JSON.parse(JSON.stringify(multiple)))).toEqual(multiple)
})

it('checks single answers against the solution, leaving blank and multiple entries unresolved', () => {
  let game = create()
  const blanks = game.givens.flatMap((value, index) => value ? [] : [index])
  game = applySudokuAction(game, { type: 'toggle', index: blanks[0], value: game.solution[blanks[0]] })
  game = applySudokuAction(game, { type: 'toggle', index: blanks[1], value: game.solution[blanks[1]] % 4 + 1 })
  game = applySudokuAction(game, { type: 'toggle', index: blanks[2], value: 1 })
  game = applySudokuAction(game, { type: 'toggle', index: blanks[2], value: 2 })
  expect(game.checked).toBeNull()
  const checked = applySudokuAction(game, { type: 'check' })
  expect(checked.checked).toEqual(game.entries)
  expect(sudokuCheckCounts(checked)).toEqual({ correct: 1, incorrect: 1, unresolved: blanks.length - 2 })
  expect(checked.history).toEqual(game.history)
  const changed = applySudokuAction(checked, { type: 'toggle', index: blanks[1], value: game.solution[blanks[1]] })
  expect(changed.checked![blanks[1]]).not.toBe(changed.entries[blanks[1]])
})

it('migrates old answers and excluded scratch markers without losing the puzzle or undo history', () => {
  const original = create(), index = original.givens.indexOf(0)
  const { version, entries, checked, ...base } = original
  void version; void checked
  const values = entries.map(sudokuEntryValue), excluded = Array(16).fill(0)
  excluded[index] = 3
  const legacy = {
    ...base, values, excluded,
    history: [
      { index, before: { value: 0, excluded: 0 }, after: { value: 0, excluded: 1 } },
      { index, before: { value: 0, excluded: 1 }, after: { value: 0, excluded: 3 } },
    ],
  }
  const migrated = readSudokuGame(legacy)
  expect(migrated.version).toBe(2)
  expect(migrated.gameId).toBe(original.gameId)
  expect(migrated.givens).toEqual(original.givens)
  expect(migrated.solution).toEqual(original.solution)
  expect(migrated.entries[index]).toBe(12)
  expect(applySudokuAction(migrated, { type: 'undo' }).entries[index]).toBe(14)
  expect(readSudokuGame(migrated)).toEqual(migrated)
  expect(() => readSudokuGame({ ...legacy, values: Array(16).fill(0) })).toThrow()
})

it('rejects tampered clues, solutions, symbols, candidate masks, checked state, and history', () => {
  const game = create(), given = game.givens.findIndex(Boolean), index = game.givens.indexOf(0)
  const bad = [...game.entries]; bad[given] = 0
  expect(() => readSudokuGame({ ...game, entries: bad })).toThrow()
  expect(() => readSudokuGame({ ...game, solution: Array(16).fill(1) })).toThrow()
  expect(() => readSudokuGame({ ...game, symbols: Array(4).fill(characters[0]) })).toThrow()
  expect(() => readSudokuGame({ ...game, entries: Array(16).fill(16) })).toThrow()
  expect(() => readSudokuGame({ ...game, checked: [0] })).toThrow()
  const changed = applySudokuAction(game, { type: 'toggle', index, value: 2 })
  expect(() => readSudokuGame({ ...changed, entries: game.entries })).toThrow('history')
})

it('keeps a bounded replayable history without mutating the original game', () => {
  const initial = create(), index = initial.givens.indexOf(0)
  let game = initial
  for (let i = 0; i < 205; i++) game = applySudokuAction(game, { type: 'toggle', index, value: 1 })
  expect(game.history).toHaveLength(200)
  expect(readSudokuGame(game)).toEqual(game)
  expect(initial.history).toEqual([])
  expect(initial.entries[index]).toBe(0)
})
