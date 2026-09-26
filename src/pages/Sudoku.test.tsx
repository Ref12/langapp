import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { generateSudoku } from '../core/games/sudoku-generator'
import { updateSudoku } from '../core/games/sudoku-store'
import type { SudokuRequest } from '../core/games/sudoku-contracts'

const worker = vi.hoisted(() => ({ generateSudokuInWorker: vi.fn() }))
vi.mock('../core/games/sudoku-client', () => worker)
const characters = Array.from('天地人日月水火木金')
beforeEach(async () => {
  window.location.hash = '#games/sudoku'
  await db.delete(); await db.open(); await initializeWorkspace()
  worker.generateSudokuInWorker.mockReset().mockImplementation(async (request: SudokuRequest) => generateSudoku(request))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function populate() {
  await db.characterStates.bulkPut(characters.map(character => ({ character, manualAddedAt: 1, practiceCompletions: 0 })))
}
async function start() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByLabelText('Grid size')
  await user.selectOptions(screen.getByLabelText('Grid size'), '4')
  const button = screen.getByRole('button', { name: 'Generate puzzle' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  await screen.findByRole('grid', { name: '4 by 4 character Sudoku' })
  return (await db.sudokuGames.get('current'))!
}
const cell = (index: number) => document.querySelector<HTMLButtonElement>(`[data-cell-index="${index}"]`)!

it('explains the required character set and never silently substitutes unfamiliar characters', async () => {
  render(<App />)
  await screen.findByText('0 distinct characters in your learning set.')
  expect(screen.getByRole('button', { name: 'Generate puzzle' })).toBeDisabled()
  expect(within(screen.getByRole('region', { name: 'New Sudoku puzzle' })).getByRole('link', { name: 'Dictionary' })).toBeInTheDocument()
  expect(worker.generateSudokuInWorker).not.toHaveBeenCalled()
})

it('persists crossed-out scratch markers, entries and undo without changing learning evidence', async () => {
  await populate()
  const before = await loadWorkspace(), user = userEvent.setup()
  const game = await start(), index = game.givens.indexOf(0)
  expect(game.symbols.every(symbol => characters.includes(symbol.character))).toBe(true)
  expect(screen.getAllByRole('gridcell')).toHaveLength(16)
  expect(document.querySelector('.sudoku-grid rt')).toBeNull()
  await user.click(cell(index))
  await user.click(screen.getByRole('button', { name: 'Scratch' }))
  expect(cell(index).querySelectorAll('.sudoku-marks > span')).toHaveLength(4)
  await user.click(screen.getByRole('button', { name: `Rule out ${game.symbols[0].character}` }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.excluded[index]).toBe(1))
  expect(cell(index).querySelectorAll('.ruled-out')).toHaveLength(1)
  cleanup(); render(<App />)
  await screen.findByRole('grid')
  expect(cell(index).querySelectorAll('.ruled-out')).toHaveLength(1)
  await user.click(cell(index))
  await user.click(screen.getByRole('button', { name: `Place ${game.symbols[1].character}` }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.values[index]).toBe(2))
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.values[index]).toBe(0))
  expect(cell(index).querySelectorAll('.ruled-out')).toHaveLength(1)
  expect(await loadWorkspace()).toEqual(before)
})

it('highlights conflicts, protects clues, and recognizes a completed puzzle', async () => {
  await populate()
  const before = await loadWorkspace(), user = userEvent.setup()
  let game = await start()
  const given = game.givens.findIndex(Boolean)
  const index = game.givens.findIndex((value, i) => !value && game.givens.slice(Math.floor(i / 4) * 4, Math.floor(i / 4) * 4 + 4).some(Boolean))
  await user.click(cell(given))
  expect(cell(given)).toHaveAttribute('aria-readonly', 'true')
  expect(within(screen.getByRole('group', { name: 'Puzzle characters' })).getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)
  await user.click(cell(index))
  const row = Math.floor(index / 4)
  const duplicate = game.values.slice(row * 4, row * 4 + 4).find(Boolean)!
  await user.click(screen.getByRole('button', { name: `Place ${game.symbols[duplicate - 1].character}` }))
  await waitFor(() => expect(cell(index)).toHaveClass('conflict'))
  await act(async () => {
    game = (await db.sudokuGames.get('current'))!
    for (let i = 0; i < game.values.length; i++) if (game.givens[i] === 0) game = await updateSudoku(game, { type: 'place', index: i, value: game.solution[i] })
  })
  await screen.findByText('Puzzle complete. Well done!')
  expect(screen.getByRole('button', { name: 'Generate puzzle' })).toBeEnabled()
  expect(await loadWorkspace()).toEqual(before)
})

it('surfaces save failures and lets replacement be canceled without losing the game', async () => {
  await populate()
  const user = userEvent.setup(), game = await start()
  vi.spyOn(db.sudokuGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  const index = game.givens.indexOf(0)
  await user.click(cell(index))
  await user.click(screen.getByRole('button', { name: `Place ${game.symbols[0].character}` }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  expect((await db.sudokuGames.get('current'))?.values[index]).toBe(0)
  await user.click(screen.getByRole('button', { name: 'New puzzle' }))
  await user.selectOptions(screen.getByLabelText('Grid size'), '6')
  await user.click(screen.getByRole('button', { name: 'Keep playing' }))
  expect((await db.sudokuGames.get('current'))?.gameId).toBe(game.gameId)
})

it('cancels generation without replacing a saved puzzle, even if the worker replies later', async () => {
  await populate()
  const user = userEvent.setup(), game = await start()
  let finish!: (value: ReturnType<typeof generateSudoku>) => void
  worker.generateSudokuInWorker.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await user.click(screen.getByRole('button', { name: 'New puzzle' }))
  await user.click(screen.getByRole('button', { name: 'Generate puzzle' }))
  await user.click(await screen.findByRole('button', { name: 'Cancel generation' }))
  await act(async () => finish(generateSudoku({ size: 4, difficulty: 'easy', seed: 2 })))
  await screen.findByText('Puzzle generation canceled. Your previous puzzle is unchanged.')
  expect((await db.sudokuGames.get('current'))?.gameId).toBe(game.gameId)
})

it('moves selection with arrow keys and maps numeric shortcuts to characters', async () => {
  await populate()
  const user = userEvent.setup(), game = await start(), index = game.givens.indexOf(0)
  await user.click(cell(index))
  await user.keyboard('1')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.values[index]).toBe(1))
  await user.keyboard('{Delete}')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.values[index]).toBe(0))
  await user.keyboard('n2')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.excluded[index]).toBe(2))
  await user.keyboard('{ArrowRight}')
  const next = Math.floor(index / 4) * 4 + (index + 1) % 4
  expect(cell(next)).toHaveFocus()
})
