import { z } from 'zod'
import { sudokuPuzzleSchema, sudokuRequestSchema, type SudokuPuzzle, type SudokuRequest } from './sudoku-contracts'
import { SUDOKU_CLUES } from './sudoku-generator'

const replySchema = z.union([z.object({ puzzle: sudokuPuzzleSchema }).strict(), z.object({ error: z.string().min(1) }).strict()])

export function generateSudokuInWorker(input: SudokuRequest, signal: AbortSignal): Promise<SudokuPuzzle> {
  signal.throwIfAborted()
  const request = sudokuRequestSchema.parse(input)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sudoku.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { cleanup(); reject(signal.reason) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Puzzle generation took too long. Please try again.')) }, 15_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => { cleanup(); reject(new Error('The puzzle generator could not start. Reload and try again.')) }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      cleanup()
      const reply = replySchema.safeParse(event.data)
      if (!reply.success) { reject(new Error('The puzzle generator returned an invalid response.')); return }
      if ('error' in reply.data) reject(new Error(reply.data.error))
      else if (reply.data.puzzle.size !== request.size || reply.data.puzzle.difficulty !== request.difficulty || reply.data.puzzle.seed !== request.seed
        || reply.data.puzzle.givens.filter(Boolean).length !== SUDOKU_CLUES[request.size][request.difficulty]) {
        reject(new Error('The generated puzzle does not match the requested settings.'))
      } else resolve(reply.data.puzzle)
    }
    try { worker.postMessage(request) } catch (error) { cleanup(); reject(error) }
  })
}
