import { expect, it } from 'vitest'
import { generateSudoku } from './sudoku-generator'
import { applySudokuAction, createSudokuGame, readSudokuGame } from './sudoku-state'

const characters = Array.from('天地人日月水火木金').map(character => ({ character, contexts: [] }))
const create = () => createSudokuGame(generateSudoku({ size: 4, difficulty: 'medium', seed: 42 }), characters, () => .5)

it('keeps fixed clues, supports crossed-out candidates, and restores prior values and notes with undo', () => {
  const game = create()
  const index = game.givens.indexOf(0), given = game.givens.findIndex(Boolean)
  expect(() => applySudokuAction(game, { type: 'place', index: given, value: 0 })).toThrow('editable')
  expect(() => applySudokuAction(game, { type: 'place', index, value: 9 })).toThrow('character')
  const marked = applySudokuAction(game, { type: 'exclude', index, value: 2 })
  expect(marked.excluded[index]).toBe(2)
  expect(marked.values[index]).toBe(0)
  const restored = applySudokuAction(marked, { type: 'exclude', index, value: 2 })
  expect(restored.excluded[index]).toBe(0)
  const placed = applySudokuAction(marked, { type: 'place', index, value: 3 })
  expect(placed.values[index]).toBe(3)
  expect(placed.excluded[index]).toBe(2)
  expect(() => applySudokuAction(placed, { type: 'exclude', index, value: 1 })).toThrow('Erase')
  const erased = applySudokuAction(placed, { type: 'place', index, value: 0 })
  expect(erased.excluded[index]).toBe(2)
  expect(applySudokuAction(erased, { type: 'undo' }).values).toEqual(placed.values)
  expect(readSudokuGame(JSON.parse(JSON.stringify(erased)))).toEqual(erased)
})

it('rejects tampered clues, solutions, symbols, masks, and undo history', () => {
  const game = create(), given = game.givens.findIndex(Boolean), index = game.givens.indexOf(0)
  const badValues = [...game.values]; badValues[given] = 0
  expect(() => readSudokuGame({ ...game, values: badValues })).toThrow()
  expect(() => readSudokuGame({ ...game, solution: Array(16).fill(1) })).toThrow()
  expect(() => readSudokuGame({ ...game, symbols: Array(4).fill(characters[0]) })).toThrow()
  expect(() => readSudokuGame({ ...game, excluded: Array(16).fill(16) })).toThrow()
  const changed = applySudokuAction(game, { type: 'place', index, value: 2 })
  expect(() => readSudokuGame({ ...changed, values: game.values })).toThrow('history')
})

it('keeps a bounded, replayable history without mutating the original puzzle', () => {
  const initial = create(), index = initial.givens.indexOf(0)
  let game = initial
  for (let i = 0; i < 205; i++) game = applySudokuAction(game, { type: 'exclude', index, value: 1 })
  expect(game.history).toHaveLength(200)
  expect(readSudokuGame(game)).toEqual(game)
  expect(initial.history).toEqual([])
  expect(initial.excluded.every(value => value === 0)).toBe(true)
})
