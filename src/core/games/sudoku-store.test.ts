import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { generateSudoku } from './sudoku-generator'
import { createSudokuGame } from './sudoku-state'
import { updateSudoku } from './sudoku-store'

const symbols = Array.from('天地人日月水火木金').map(character => ({ character, contexts: [] }))
const create = () => createSudokuGame(generateSudoku({ size: 4, difficulty: 'easy', seed: 1 }), symbols)
beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())

it('persists candidates and Check results without changing learning, rejecting stale edits', async () => {
  const learning = await loadWorkspace(), game = create(), index = game.givens.indexOf(0)
  await db.sudokuGames.put(game)
  const next = await updateSudoku(game, { type: 'toggle', index, value: 3 })
  expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(4)
  await expect(updateSudoku(game, { type: 'toggle', index, value: 1 })).rejects.toThrow('another tab')
  await updateSudoku(next, { type: 'check' })
  expect((await db.sudokuGames.get('current'))?.checked).toEqual(next.entries)
  expect(await loadWorkspace()).toEqual(learning)
})

it('surfaces failed saves and isolates puzzles between profiles', async () => {
  const game = create()
  await db.sudokuGames.put(game)
  vi.spyOn(db.sudokuGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await expect(updateSudoku(game, { type: 'toggle', index: game.givens.indexOf(0), value: 1 })).rejects.toThrow('Storage full')
  expect(await db.sudokuGames.get('current')).toEqual(game)
  const other = new LearningDatabase('sudoku-profile-isolation-test')
  try { await other.open(); expect(await other.sudokuGames.count()).toBe(0) } finally { await other.delete() }
})

it('excludes puzzles from backups and clears them on restore', async () => {
  await db.sudokuGames.put(create())
  const backup = await exportWorkspaceBackup()
  expect(backup).not.toContain('sudoku')
  await restoreBackup(backup)
  expect(await db.sudokuGames.count()).toBe(0)
})
