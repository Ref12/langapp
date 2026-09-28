import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { loadCatalog, renderExample } from '../study/catalog'
import { buildPotionsLevel, phraseText, potionsRandom, type PotionPhrase, type PotionsGame } from './potions'
import { knownPotionPhrases } from './potions-phrases'
import { loadPotionsProgress, startPotionsLevel, updatePotions } from './potions-store'

const phrases: PotionPhrase[] = [
  { id: 'a', words: ['\u6211', '\u559c\u6b22', '\u8336'], pinyin: 'wo xi huan cha', translation: 'I like tea.' },
  { id: 'b', words: ['\u4ed6', '\u662f', '\u8001\u5e08'], pinyin: 'ta shi lao shi', translation: 'He is a teacher.' },
  { id: 'c', words: ['\u5979', '\u5728', '\u5bb6'], pinyin: 'ta zai jia', translation: 'She is at home.' },
]
beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())

function solvedRows(game: PotionsGame) {
  return game.phrases.map((phrase, index) => phrase.words.map((text, position) => ({ id: `${index}-${position}`, text, phrase: index })))
}

it('saves pours, records stars once a level is brewed, and never touches learning evidence', async () => {
  const before = await loadWorkspace()
  const game = await startPotionsLevel(buildPotionsLevel(phrases, 1, potionsRandom(1, phrases)))
  expect(await loadPotionsProgress()).toMatchObject({ maxLevel: 0, stars: {} })
  const from = game.rows.findIndex(row => row.length)
  const to = game.rows.findIndex(row => !row.length)
  const next = await updatePotions(game, { type: 'move', from, to })
  expect(next.revision).toBe(1)
  expect((await db.potionGames.get('current'))?.moves).toBe(1)
  await expect(updatePotions(game, { type: 'move', from, to })).rejects.toThrow('another tab')
  const rows = solvedRows(next)
  const last = rows[0].pop()!
  await db.potionGames.put({ ...next, rows: [...rows, [last]], phase: 'play' })
  const finished = await updatePotions({ ...next, rows: [...rows, [last]] }, { type: 'move', from: rows.length, to: 0 })
  expect(finished.phase).toBe('complete')
  expect(await loadPotionsProgress()).toMatchObject({ maxLevel: 1, stars: { 1: 3 }, brewed: expect.arrayContaining(game.phrases.map(phrase => phrase.id)) })
  expect(await loadWorkspace()).toEqual(before)
})

it('leaves the saved puzzle unchanged after a failed write', async () => {
  const game = await startPotionsLevel(buildPotionsLevel(phrases, 2, potionsRandom(2, phrases)))
  vi.spyOn(db.potionGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  const from = game.rows.findIndex(row => row.length)
  const to = game.rows.findIndex(row => !row.length)
  await expect(updatePotions(game, { type: 'move', from, to })).rejects.toThrow('Storage full')
  expect(await db.potionGames.get('current')).toEqual(game)
})

it('isolates profiles and clears potions progress on backup restore', async () => {
  await startPotionsLevel(buildPotionsLevel(phrases, 1, potionsRandom(1, phrases)))
  await db.potionProgress.put({ version: 1, id: 'progress', maxLevel: 3, stars: { 1: 3 }, brewed: ['a'] })
  const other = new LearningDatabase('potions-profile-isolation-test')
  try { await other.open(); expect(await other.potionGames.count()).toBe(0) } finally { await other.delete() }
  const text = await exportWorkspaceBackup()
  expect(text).not.toContain('potionGames')
  await restoreBackup(text)
  expect(await db.potionGames.count()).toBe(0)
  expect(await db.potionProgress.count()).toBe(0)
})

it('offers only lesson phrases whose every word is introduced, keeping punctuation on its word', async () => {
  const catalog = await loadCatalog()
  expect(knownPotionPhrases(catalog, await loadWorkspace())).toEqual([])
  const example = catalog.orderedGroups.flatMap(({ group }) => group.examples)
    .find(example => example.segments.filter(segment => segment.word).length >= 3
      && example.segments.some(segment => segment.punctuation !== undefined))!
  const refs = new Set(example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : []))
  const units = [...catalog.units.values()].filter(unit => refs.has(unit.ref))
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  const known = knownPotionPhrases(catalog, await loadWorkspace())
  const rendered = renderExample(catalog, example)
  const phrase = known.find(candidate => phraseText(candidate) === rendered.text)!
  expect(phrase).toBeDefined()
  expect(phrase.words).toHaveLength(example.segments.filter(segment => segment.word).length)
  expect(phrase.words.every(word => word.length <= 12)).toBe(true)
  expect(phrase.pinyin).toBe(rendered.pinyin)
  expect(known.every(candidate => candidate.words.length >= 2 && candidate.words.length <= 7)).toBe(true)
  expect(new Set(known.map(phraseText)).size).toBe(known.length)
})
