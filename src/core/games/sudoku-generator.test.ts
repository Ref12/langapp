import { describe, expect, it } from 'vitest'
import { countSudokuSolutions, generateSudoku, SUDOKU_CLUES, sudokuConflicts, sudokuUnits, validSudoku } from './sudoku-generator'
import { type SudokuSize, sudokuDifficultySchema } from './sudoku-contracts'

const cases = ([4, 6, 9] as const).flatMap(size => sudokuDifficultySchema.options.flatMap(difficulty =>
  Array.from({ length: 16 }, (_, seed) => ({ size, difficulty, seed }))))

describe('Sudoku generation', () => {
  it.each(cases)('generates a unique $size x $size $difficulty puzzle with seed $seed', request => {
    const puzzle = generateSudoku(request)
    expect(validSudoku(puzzle.solution, request.size)).toBe(true)
    expect(puzzle.solution.every(value => value > 0)).toBe(true)
    expect(countSudokuSolutions(puzzle.givens, request.size)).toBe(1)
    expect(puzzle.givens.filter(Boolean)).toHaveLength(SUDOKU_CLUES[request.size][request.difficulty])
    expect(puzzle.givens.every((value, index) => !value || value === puzzle.solution[index])).toBe(true)
    for (const unit of sudokuUnits(request.size)) {
      expect(new Set(unit.map(index => puzzle.solution[index])).size).toBe(request.size)
    }
  })

  it('is reproducible by seed and produces different clue patterns for different seeds', () => {
    const request = { size: 9 as const, difficulty: 'hard' as const, seed: 84 }
    expect(generateSudoku(request)).toEqual(generateSudoku(request))
    expect(generateSudoku({ ...request, seed: 85 }).givens).not.toEqual(generateSudoku(request).givens)
  })

  it('distinguishes invalid, ambiguous, and uniquely solved grids without changing the input', () => {
    const puzzle = generateSudoku({ size: 4, difficulty: 'easy', seed: 42 })
    const original = [...puzzle.givens]
    expect(countSudokuSolutions(puzzle.givens, 4)).toBe(1)
    expect(puzzle.givens).toEqual(original)
    expect(countSudokuSolutions(Array(16).fill(0), 4)).toBe(2)
    const invalid = [...puzzle.solution]
    invalid[0] = invalid[1]
    expect(countSudokuSolutions(invalid, 4)).toBe(0)
    expect(sudokuConflicts(invalid, 4)).toContain(0)
    expect(sudokuConflicts(invalid, 4)).toContain(1)
    expect(validSudoku([1], 4)).toBe(false)
  })

  it('uses two-row, three-column boxes for 6x6 puzzles', () => {
    const boxes = sudokuUnits(6).slice(12)
    expect(boxes[0]).toEqual([0, 1, 2, 6, 7, 8])
    expect(boxes[1]).toEqual([3, 4, 5, 9, 10, 11])
    expect(() => generateSudoku({ size: 5 as SudokuSize, difficulty: 'easy', seed: 1 })).toThrow()
  })
})
