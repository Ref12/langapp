import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { generateSudoku } from './sudoku-generator'
import { createSudokuGame } from './sudoku-state'
import { deleteSavedSudokuBoard, hasUnsavedSudokuProgress, listSavedSudokuBoards, resumeSudokuBoard, saveSudokuBoard, updateSudoku } from './sudoku-store'
import { MAX_SAVED_SUDOKU_BOARDS } from './sudoku-saved'

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

it('keeps the live puzzle out of backups and clears it on restore', async () => {
  await db.sudokuGames.put(create())
  const backup = await exportWorkspaceBackup()
  expect(backup).not.toContain('sudoku')
  await restoreBackup(backup)
  expect(await db.sudokuGames.count()).toBe(0)
})

it('saves a snapshot with label, thumbnail and counts without touching the live row', async () => {
  const game = create(), index = game.givens.indexOf(0)
  await db.sudokuGames.put(game)
  const played = await updateSudoku(game, { type: 'toggle', index, value: 2 })
  const live = await db.sudokuGames.get('current')
  const row = await saveSudokuBoard(played, 1234)
  expect(await db.sudokuGames.get('current')).toEqual(live)
  expect(row).toMatchObject({ savedAt: 1234, label: played.symbols.map(symbol => symbol.character).join(' '), size: 4, difficulty: 'easy', checked: false })
  expect(row.filled).toBe(played.givens.filter(Boolean).length + 1)
  expect(row.thumbnail.startsWith('<svg')).toBe(true)
  expect(row.thumbnail.length).toBeLessThan(4000)
  expect(row.game).toEqual(played)
  expect(hasUnsavedSudokuProgress(played, await listSavedSudokuBoards())).toBe(false)
  const next = await updateSudoku(played, { type: 'check' })
  expect(hasUnsavedSudokuProgress(next, await listSavedSudokuBoards())).toBe(true)
  await expect(saveSudokuBoard(played)).rejects.toThrow('another tab')
})

it('keeps a 9 x 9 thumbnail under 4 kB even with every candidate set', async () => {
  const game = createSudokuGame(generateSudoku({ size: 9, difficulty: 'hard', seed: 5 }), symbols)
  const full = { ...game, entries: game.entries.map((entries, i) => game.givens[i] ? entries : 511) }
  await db.sudokuGames.put(game)
  const { sudokuThumbnail } = await import('./sudoku-saved')
  expect(sudokuThumbnail(full).length).toBeLessThan(4000)
})

it('resumes a validated copy over the live game, lists newest first, and deletes', async () => {
  const game = create(), index = game.givens.indexOf(0)
  await db.sudokuGames.put(game)
  const first = await saveSudokuBoard(game, 1)
  const played = await updateSudoku(game, { type: 'toggle', index, value: 1 })
  const second = await saveSudokuBoard(played, 2)
  expect((await listSavedSudokuBoards()).map(row => row.id)).toEqual([second.id, first.id])
  const resumed = await resumeSudokuBoard(first.id)
  const live = (await db.sudokuGames.get('current'))!
  expect(live).toEqual(resumed)
  expect(live.entries).toEqual(game.entries)
  expect(live.gameId).not.toBe(game.gameId)
  expect(live.revision).toBe(0)
  await deleteSavedSudokuBoard(first.id)
  expect((await listSavedSudokuBoards()).map(row => row.id)).toEqual([second.id])
  await expect(resumeSudokuBoard(first.id)).rejects.toThrow('no longer exists')
  await expect(deleteSavedSudokuBoard('current')).rejects.toThrow()
  await db.table('sudokuGames').put({ ...second, id: 'saved-bad', game: { ...second.game, solution: second.game.solution.map(() => 1) } })
  await expect(resumeSudokuBoard('saved-bad')).rejects.toThrow()
})

it('caps saved boards at 30', async () => {
  const game = create()
  await db.sudokuGames.put(game)
  for (let i = 0; i < MAX_SAVED_SUDOKU_BOARDS; i++) await saveSudokuBoard(game, i)
  await expect(saveSudokuBoard(game)).rejects.toThrow('30 saved boards')
  expect(await db.table('sudokuGames').count()).toBe(MAX_SAVED_SUDOKU_BOARDS + 1)
})

it('round-trips saved boards through a backup but not the live game', async () => {
  const game = create()
  await db.sudokuGames.put(game)
  const row = await saveSudokuBoard(game, 99)
  const backup = await exportWorkspaceBackup()
  expect(backup).toContain('sudokuBoards')
  await restoreBackup(backup)
  expect(await db.sudokuGames.get('current')).toBeUndefined()
  expect(await listSavedSudokuBoards()).toEqual([row])
  await expect(restoreBackup(backup.replace('"savedAt": 99', '"savedAt": -1'))).rejects.toThrow()
})
