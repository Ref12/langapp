import { SUDOKU_BOXES, sudokuRequestSchema, type SudokuDifficulty, type SudokuPuzzle, type SudokuRequest, type SudokuSize } from './sudoku-contracts'

// These are clue-density settings, not claims about required solving techniques.
export const SUDOKU_CLUES: Record<SudokuSize, Record<SudokuDifficulty, number>> = {
  4: { easy: 8, medium: 6, hard: 4 },
  6: { easy: 22, medium: 16, hard: 12 },
  9: { easy: 46, medium: 36, hard: 28 },
}

export function sudokuUnits(size: SudokuSize): number[][] {
  const box = SUDOKU_BOXES[size]
  const units: number[][] = []
  for (let i = 0; i < size; i++) {
    units.push(Array.from({ length: size }, (_, j) => i * size + j))
    units.push(Array.from({ length: size }, (_, j) => j * size + i))
  }
  for (let row = 0; row < size; row += box.rows) for (let column = 0; column < size; column += box.columns) {
    units.push(Array.from({ length: size }, (_, i) => (row + Math.floor(i / box.columns)) * size + column + i % box.columns))
  }
  return units
}

export function sudokuConflicts(values: readonly number[], size: SudokuSize): Set<number> {
  const conflicts = new Set<number>()
  for (const unit of sudokuUnits(size)) {
    const first = new Map<number, number>()
    for (const index of unit) {
      const value = values[index]
      if (!value) continue
      const previous = first.get(value)
      if (previous !== undefined) { conflicts.add(previous); conflicts.add(index) }
      else first.set(value, index)
    }
  }
  return conflicts
}

export function validSudoku(values: readonly number[], size: SudokuSize): boolean {
  return values.length === size ** 2 && values.every(value => Number.isInteger(value) && value >= 0 && value <= size)
    && sudokuConflicts(values, size).size === 0
}

export class SudokuSearchLimit extends Error {}

export function countSudokuSolutions(input: readonly number[], size: SudokuSize): number {
  if (!validSudoku(input, size)) return 0
  const cells = [...input], rows = Array<number>(size).fill(0), columns = [...rows], boxes = [...rows]
  const shape = SUDOKU_BOXES[size]
  const boxIndex = (index: number) => Math.floor(Math.floor(index / size) / shape.rows) * (size / shape.columns) + Math.floor(index % size / shape.columns)
  const all = (1 << size) - 1
  cells.forEach((value, i) => {
    if (!value) return
    const bit = 1 << (value - 1)
    rows[Math.floor(i / size)] |= bit
    columns[i % size] |= bit
    boxes[boxIndex(i)] |= bit
  })
  let count = 0, nodes = 0
  const search = () => {
    if (++nodes > 100_000) throw new SudokuSearchLimit('Sudoku uniqueness search exceeded its safe work limit.')
    let index = -1, candidates = 0, smallest = size + 1
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== 0) continue
      const available = all & ~(rows[Math.floor(i / size)] | columns[i % size] | boxes[boxIndex(i)])
      if (available === 0) return
      let bits = available, length = 0
      while (bits) { bits &= bits - 1; length++ }
      if (length < smallest) {
        index = i; candidates = available; smallest = length
        if (length === 1) break
      }
    }
    if (index === -1) { count++; return }
    const row = Math.floor(index / size), column = index % size, box = boxIndex(index)
    while (candidates && count < 2) {
      const bit = candidates & -candidates
      candidates ^= bit
      cells[index] = Math.log2(bit) + 1
      rows[row] |= bit; columns[column] |= bit; boxes[box] |= bit
      search()
      cells[index] = 0
      rows[row] ^= bit; columns[column] ^= bit; boxes[box] ^= bit
    }
  }
  search()
  return count
}

function shuffled(items: number[], random: () => number): number[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function generateSudoku(input: SudokuRequest): SudokuPuzzle {
  const request = sudokuRequestSchema.parse(input)
  const { size, difficulty } = request
  let seed = request.seed
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  const indices = Array.from({ length: size }, (_, i) => i)
  const shape = SUDOKU_BOXES[size]
  const groupOrder = (groupSize: number) => shuffled(Array.from({ length: size / groupSize }, (_, i) => i), random)
    .flatMap(group => shuffled(Array.from({ length: groupSize }, (_, i) => group * groupSize + i), random))
  const target = SUDOKU_CLUES[size][difficulty]
  for (let attempt = 0; attempt < 24; attempt++) {
    const rows = groupOrder(shape.rows), columns = groupOrder(shape.columns), symbols = shuffled(indices, random)
    // Permute a valid box-compatible grid, then remove clues only when a
    // separate solver still proves exactly one solution.
    const solution = rows.flatMap(row => columns.map(column => symbols[(row * shape.columns + Math.floor(row / shape.rows) + column) % size] + 1))
    const givens = [...solution]
    let clues = givens.length
    for (const index of shuffled(Array.from({ length: givens.length }, (_, i) => i), random)) {
      const value = givens[index]
      givens[index] = 0
      let unique = false
      try { unique = countSudokuSolutions(givens, size) === 1 } catch (error) {
        if (!(error instanceof SudokuSearchLimit)) throw error
      }
      if (unique) clues--
      else givens[index] = value
      if (clues === target) return { ...request, givens, solution }
    }
  }
  throw new Error('Could not generate a unique puzzle at this clue setting. Try a new puzzle or an easier setting.')
}
