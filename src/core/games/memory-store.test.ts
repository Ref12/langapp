import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { starterWords } from '../../data/mandarin'
import { createMemoryGame } from './memory'
import { updateMemory } from './memory-store'

const words = starterWords.map(word => ({ id: word.id, character: word.native, pinyin: word.pinyin, meaning: word.meaning }))
beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())

it('persists study, partial turns, and matches without updating learning evidence', async () => {
  const before = await loadWorkspace()
  const game = createMemoryGame(words, 'triplets', 4)
  await db.memoryGames.put(game)
  let next = await updateMemory(game, { type: 'start' })
  const group = game.tiles.filter(tile => tile.word.id === game.tiles[0].word.id)
  for (const tile of group) next = await updateMemory(next, { type: 'reveal', id: tile.id })
  expect((await db.memoryGames.get('current'))?.matched).toHaveLength(3)
  expect(await loadWorkspace()).toEqual(before)
  await expect(updateMemory(game, { type: 'start' })).rejects.toThrow('another tab')
})

it('leaves the board unchanged after a failed save', async () => {
  const game = createMemoryGame(words, 'mixed', 4)
  await db.memoryGames.put(game)
  vi.spyOn(db.memoryGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await expect(updateMemory(game, { type: 'start' })).rejects.toThrow('Storage full')
  expect(await db.memoryGames.get('current')).toEqual(game)
})

it('isolates profiles and clears non-exported games on backup restore', async () => {
  await db.memoryGames.put(createMemoryGame(words, 'mixed', 4))
  const other = new LearningDatabase('memory-profile-isolation-test')
  try { await other.open(); expect(await other.memoryGames.count()).toBe(0) } finally { await other.delete() }
  const text = await exportWorkspaceBackup()
  expect(text).not.toContain('memoryGames')
  await restoreBackup(text)
  expect(await db.memoryGames.count()).toBe(0)
})
