import { beforeEach, expect, it, vi, afterEach } from 'vitest'
import { db, initializeWorkspace, loadWorkspace, LearningDatabase } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { words } from '../../data/mandarin'
import { availablePairs, createMahjong } from './mahjong'
import { updateMahjong } from './mahjong-store'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())
const vocabulary = words.map(word => ({ id: word.id, character: word.native, pinyin: word.pinyin, meaning: word.meaning }))

it('persists moves without affecting learning, and rejects stale actions from another tab', async () => {
  const before = await loadWorkspace()
  const game = createMahjong(vocabulary)
  await db.mahjongGames.put(game)
  const pair = availablePairs(game)[0]
  const next = await updateMahjong(game, { type: 'match', first: pair[0].id, second: pair[1].id })
  expect(await db.mahjongGames.get('current')).toEqual(next)
  expect(await loadWorkspace()).toEqual(before)
  await expect(updateMahjong(game, { type: 'undo' })).rejects.toThrow('another tab')
  const hinted = await updateMahjong(next, { type: 'hint' })
  expect(hinted.hints).toBe(1)
  const shuffled = await updateMahjong(hinted, { type: 'shuffle' })
  expect(shuffled.history).toEqual([])
  expect(await loadWorkspace()).toEqual(before)
})

it('surfaces storage errors rather than claiming a move was saved', async () => {
  const game = createMahjong(vocabulary)
  await db.mahjongGames.put(game)
  const pair = availablePairs(game)[0]
  vi.spyOn(db.mahjongGames, 'put').mockRejectedValueOnce(new Error('Disk full'))
  await expect(updateMahjong(game, { type: 'match', first: pair[0].id, second: pair[1].id })).rejects.toThrow('Disk full')
  expect(await db.mahjongGames.get('current')).toEqual(game)
})

it('keeps boards profile-local and clears them when restoring a workspace backup', async () => {
  const other = new LearningDatabase('mahjong-profile-isolation-test')
  try {
    await other.open()
    await db.mahjongGames.put(createMahjong(vocabulary))
    expect(await other.mahjongGames.count()).toBe(0)
    const backup = await exportWorkspaceBackup()
    expect(backup).not.toContain('mahjong')
    await restoreBackup(backup)
    expect(await db.mahjongGames.count()).toBe(0)
  } finally { await other.delete() }
})
