import { generateSudoku } from './sudoku-generator'
import { sudokuRequestSchema } from './sudoku-contracts'

self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    const puzzle = generateSudoku(sudokuRequestSchema.parse(event.data))
    self.postMessage({ puzzle })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Sudoku generation failed.' })
  }
}
