import { beforeEach, expect, it } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../database'
import { trackWord } from '../learning'
import { loadCatalog } from '../study/catalog'
import { sudokuCharacters } from './sudoku-characters'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })

it('uses only introduced spellings and manual additions without inventing character readings', async () => {
  const catalog = await loadCatalog()
  const unit = [...catalog.units.values()].find(unit => unit.kind === 'vocabulary' && unit.record.ch === '学生')!
  if (unit.kind !== 'vocabulary') throw new Error('Expected vocabulary fixture')
  await db.knowledge.add({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' })
  await db.characterStates.bulkPut([
    { character: '水', manualAddedAt: 1, practiceCompletions: 0 },
    { character: '火', practiceCompletions: 1, lastPracticedAt: 1 },
  ])
  await trackWord('zh:tea', 'test')
  const symbols = sudokuCharacters(catalog, await loadWorkspace())
  expect(new Set(symbols.map(symbol => symbol.character))).toEqual(new Set(['学', '生', '水', '茶']))
  expect(symbols.find(symbol => symbol.character === '水')?.contexts).toEqual([])
  expect(symbols.find(symbol => symbol.character === '学')?.contexts).toEqual([{
    text: '学生', pinyin: unit.record.pr.normalize('NFC'), meaning: unit.record.ds,
  }])
  expect(symbols.find(symbol => symbol.character === '茶')?.contexts[0].meaning).toBe('tea')
})
