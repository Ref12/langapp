import { afterEach, expect, it, vi } from 'vitest'
import { generateSudokuInWorker } from './sudoku-client'
import { generateSudoku } from './sudoku-generator'

class FakeWorker {
  static latest: FakeWorker
  onmessage?: (event: MessageEvent) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.latest = this }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const request = { size: 4 as const, difficulty: 'easy' as const, seed: 1 }

it('returns validated puzzles and terminates the worker', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const generated = generateSudoku(request)
  const result = generateSudokuInWorker(request, new AbortController().signal)
  FakeWorker.latest.onmessage?.(new MessageEvent('message', { data: { puzzle: generated } }))
  await expect(result).resolves.toEqual(generated)
  expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce()
})

it('cancels generation without waiting for the worker and rejects malformed replies', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const controller = new AbortController()
  const result = generateSudokuInWorker(request, controller.signal)
  controller.abort()
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce()
  const malformed = generateSudokuInWorker(request, new AbortController().signal)
  FakeWorker.latest.onmessage?.(new MessageEvent('message', { data: { wrong: true } }))
  await expect(malformed).rejects.toThrow('invalid response')
})

it('bounds generation time and rejects results for different settings', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  vi.useFakeTimers()
  const result = generateSudokuInWorker(request, new AbortController().signal)
  const assertion = expect(result).rejects.toThrow('took too long')
  await vi.advanceTimersByTimeAsync(15_000)
  await assertion
  expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce()
  const mismatched = generateSudokuInWorker(request, new AbortController().signal)
  FakeWorker.latest.onmessage?.(new MessageEvent('message', { data: { puzzle: generateSudoku({ ...request, seed: 2 }) } }))
  await expect(mismatched).rejects.toThrow('requested settings')
})
