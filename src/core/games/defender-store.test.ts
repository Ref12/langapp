import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { loadCatalog } from '../study/catalog'
import { createDefenderGame, defenderKnowledgeWords, pauseDefender, tickDefender } from './defender'
import { saveDefenderGame } from './defender-store'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())
async function create() {
  const catalog = await loadCatalog()
  const units = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary').slice(0, 20)
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  return createDefenderGame(defenderKnowledgeWords(catalog, await loadWorkspace()), { mode: 'tap', direction: 'chinese', pace: 'standard' }, 1)
}

it('saves checkpoints without affecting learning evidence and refuses a stale tab', async () => {
  const game = await create()
  const before = await loadWorkspace()
  const saved = await saveDefenderGame(pauseDefender(game))
  const next = tickDefender(game, 1).game
  const updated = await saveDefenderGame(pauseDefender(next), saved)
  expect(updated.run.elapsed).toBeCloseTo(1)
  await expect(saveDefenderGame(game, saved)).rejects.toThrow('another tab')
  expect(await loadWorkspace()).toEqual(before)
})

it('reports failed checkpoint saves without replacing the previous snapshot', async () => {
  const game = await create(), saved = await saveDefenderGame(game)
  vi.spyOn(db.defenderGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await expect(saveDefenderGame(pauseDefender(game), saved)).rejects.toThrow('Storage full')
  expect(await db.defenderGames.get('current')).toEqual(saved)
})

it('keeps checkpoints profile-local and out of backups, clearing them on restore', async () => {
  await saveDefenderGame(await create())
  const other = new LearningDatabase('defender-profile-test')
  try { await other.open(); expect(await other.defenderGames.count()).toBe(0) } finally { await other.delete() }
  const backup = await exportWorkspaceBackup()
  expect(backup).not.toContain('defenderGames')
  await restoreBackup(backup)
  expect(await db.defenderGames.count()).toBe(0)
})

it('can prepare a run from the entire supported knowledge inventory', async () => {
  const catalog = await loadCatalog()
  const workspace = await loadWorkspace()
  workspace.knowledge = [...catalog.units.values()].map(unit => ({
    ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary',
  }))
  const available = defenderKnowledgeWords(catalog, workspace)
  expect(available.length).toBeGreaterThan(12)
  expect(createDefenderGame(available, { mode: 'type', direction: 'character-pinyin', pace: 'standard' }, 1).run.words).toHaveLength(12)
})
