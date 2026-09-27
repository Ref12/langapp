import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../database'
import { loadCatalog, renderExample } from '../study/catalog'
import { wordCharacters } from '../characters/dictionary'
import { createSudokuGame, readSudokuGame } from './sudoku-state'
import { generateSudoku } from './sudoku-generator'
import { sudokuCharacters } from './sudoku-characters'
import { generateSudokuPhrase, knownSudokuPhrases, prepareSudokuPhrase } from './sudoku-phrases'
import type { SudokuPhrase } from './sudoku-contracts'

const transport = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => transport)
beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace(); transport.requestStructuredJSON.mockReset() })
afterEach(() => vi.restoreAllMocks())
const phrase: SudokuPhrase = { source: 'custom', text: '我我学习中文。', pinyin: '', translation: 'I study Chinese.' }
const symbols = Array.from('我学习中文').map(character => ({ character, contexts: [] }))

it('deduplicates and truncates the phrase palette in first-appearance order, without shuffling', async () => {
  const prepared = await prepareSudokuPhrase(phrase, symbols, 4)
  expect(prepared.symbols.map(symbol => symbol.character)).toEqual(Array.from('我学习中'))
  expect(prepared.symbols.find(symbol => symbol.character === '中')?.readings).toEqual(['zhōng'])
  const game = createSudokuGame(generateSudoku({ size: 4, difficulty: 'easy', seed: 1 }), prepared.symbols, () => 0, prepared.phrase)
  expect(game.symbols.map(symbol => symbol.character)).toEqual(Array.from('我学习中'))
  expect(game.phrase?.text).toBe(phrase.text)
  expect(readSudokuGame(JSON.parse(JSON.stringify(game)))).toEqual(game)
  expect(() => readSudokuGame({ ...game, symbols: [...game.symbols].reverse() })).toThrow('phrase order')
})

it('does not require ignored trailing characters, but refuses unknown selected characters and short phrases', async () => {
  await expect(prepareSudokuPhrase(phrase, symbols.slice(0, 4), 4)).resolves.toMatchObject({ symbols: expect.any(Array) })
  await expect(prepareSudokuPhrase(phrase, symbols.slice(1), 4)).rejects.toThrow('我')
  await expect(prepareSudokuPhrase({ ...phrase, text: '我我我' }, symbols, 4)).rejects.toThrow('1 distinct')
})

it('offers only authored sentences whose vocabulary is already introduced', async () => {
  const catalog = await loadCatalog()
  expect(knownSudokuPhrases(catalog, await loadWorkspace())).toEqual([])
  const example = catalog.orderedGroups.flatMap(({ group }) => group.examples).find(example => wordCharacters(renderExample(catalog, example).text).length >= 4)!
  const refs = new Set(example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : []))
  const units = [...catalog.units.values()].filter(unit => refs.has(unit.ref))
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  const workspace = await loadWorkspace()
  const phrases = knownSudokuPhrases(catalog, workspace)
  expect(phrases.length).toBeGreaterThan(0)
  expect(phrases.some(phrase => phrase.text === renderExample(catalog, example).text)).toBe(true)
  const allowed = new Set(sudokuCharacters(catalog, workspace).map(symbol => symbol.character))
  for (const phrase of phrases) {
    expect(phrase.source).toBe('lesson')
    expect(phrase.pinyin).not.toBe('')
    expect(Array.from(phrase.text).filter(character => /\p{Script=Han}/u.test(character)).every(character => allowed.has(character))).toBe(true)
  }
})

it('requests AI only explicitly, validates known vocabulary, and generates pinyin locally', async () => {
  const catalog = await loadCatalog()
  const units = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary' && ['我', '学习', '中文'].includes(unit.record.ch))
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  await db.aiConnections.put({ id: 'assistant', revision: 'r1', updatedAt: 1, baseUrl: 'https://example.test/v1', apiKey: 'synthetic-key', model: 'model', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
  const workspace = await loadWorkspace()
  expect(transport.requestStructuredJSON).not.toHaveBeenCalled()
  transport.requestStructuredJSON.mockResolvedValueOnce({ text: '我学习中文。', translation: 'I study Chinese.' })
  const generated = await generateSudokuPhrase(catalog, workspace, 4, new AbortController().signal)
  expect(generated).toMatchObject({ source: 'ai', pinyin: '', text: '我学习中文。' })
  expect(transport.requestStructuredJSON).toHaveBeenCalledTimes(1)
  const prepared = await prepareSudokuPhrase(generated, sudokuCharacters(catalog, workspace), 4)
  expect(prepared.symbols[1]).toMatchObject({ character: '学', readings: ['xué'] })
  transport.requestStructuredJSON.mockResolvedValueOnce({ text: '我喜欢喝咖啡。', translation: 'I like coffee.' })
  await expect(generateSudokuPhrase(catalog, workspace, 4, new AbortController().signal)).rejects.toThrow('unknown vocabulary')
  expect(await loadWorkspace()).toEqual(workspace)
})

it('rejects canceled AI requests before any provider call', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(generateSudokuPhrase(await loadCatalog(), await loadWorkspace(), 4, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(transport.requestStructuredJSON).not.toHaveBeenCalled()
})
