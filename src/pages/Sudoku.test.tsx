import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { withAutoCompletedSpeechPreparation } from '../test/mock-speech-preparation'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { savePreferences } from '../core/learning'
import { generateSudoku } from '../core/games/sudoku-generator'
import { updateSudoku } from '../core/games/sudoku-store'
import { createSudokuGame } from '../core/games/sudoku-state'
import { clearVoiceCache, getPlaybackState, setSpeechVoicePreferences, stopBrowserSpeech } from '../core/assistant/speech'
import type { SudokuRequest } from '../core/games/sudoku-contracts'
import { loadCatalog, renderExample } from '../core/study/catalog'
import { wordCharacters } from '../core/characters/dictionary'

const worker = vi.hoisted(() => ({ generateSudokuInWorker: vi.fn() }))
const phrasesAI = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../core/games/sudoku-client', () => worker)
vi.mock('../core/ai/structured', () => phrasesAI)
const characters = Array.from('天地人日月水火木金')
class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: ((event: { error: string }) => void) | null
}
const voice: SpeechSynthesisVoice = { voiceURI: 'test-zh', name: 'Test Mandarin', lang: 'zh-CN', localService: true, default: true }
let speak: ReturnType<typeof vi.fn<(utterance: Utterance) => void>>
let cancel: ReturnType<typeof vi.fn>
beforeEach(async () => {
  speak = vi.fn(); cancel = vi.fn()
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(Object.assign(new EventTarget(), { getVoices: () => [voice], speak, cancel })))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  stopBrowserSpeech(); setSpeechVoicePreferences(); clearVoiceCache()
  window.location.hash = '#games/sudoku'
  await db.delete(); await db.open(); await initializeWorkspace()
  worker.generateSudokuInWorker.mockReset().mockImplementation(async (request: SudokuRequest) => generateSudoku(request))
  phrasesAI.requestStructuredJSON.mockReset()
})
afterEach(() => { cleanup(); stopBrowserSpeech(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
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
async function newPuzzle(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Character key, pronunciation, and rules'))
  await user.click(screen.getByRole('button', { name: 'New puzzle' }))
}

it('explains the required character set without substituting unfamiliar characters', async () => {
  render(<App />)
  await screen.findByText('0 distinct characters in your learning set.')
  expect(screen.getByRole('button', { name: 'Generate puzzle' })).toBeDisabled()
  expect(worker.generateSudokuInWorker).not.toHaveBeenCalled()
})

it('persists multiple entries, promotes the last remaining candidate, and supports undo', async () => {
  await populate()
  const before = await loadWorkspace(), user = userEvent.setup(), game = await start(), index = game.givens.indexOf(0)
  await user.click(cell(index))
  await user.click(screen.getByRole('button', { name: `Add ${game.symbols[0].character}` }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(1))
  expect(cell(index).querySelector('.sudoku-candidates')).toBeNull()
  await user.click(screen.getByRole('button', { name: `Add ${game.symbols[1].character}` }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(3))
  expect(cell(index).querySelector('.sudoku-candidates')).toHaveTextContent(game.symbols[0].character)
  expect(cell(index).querySelector('.sudoku-candidates')).toHaveTextContent(game.symbols[1].character)
  cleanup(); render(<App />)
  await screen.findByRole('grid')
  await user.click(cell(index))
  await user.click(screen.getByRole('button', { name: `Remove ${game.symbols[0].character}` }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(2))
  expect(cell(index).querySelector('.sudoku-candidates')).toBeNull()
  expect(cell(index)).toHaveTextContent(game.symbols[1].character)
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(3))
  expect(await loadWorkspace()).toEqual(before)
})

it('Check grades only single proposals and clears stale grades on edited cells', async () => {
  await populate()
  const user = userEvent.setup()
  let game = await start()
  const [correct, wrong, multiple] = game.givens.flatMap((value, index) => value ? [] : [index])
  await act(async () => {
    game = await updateSudoku(game, { type: 'toggle', index: correct, value: game.solution[correct] })
    game = await updateSudoku(game, { type: 'toggle', index: wrong, value: game.solution[wrong] % 4 + 1 })
    game = await updateSudoku(game, { type: 'toggle', index: multiple, value: 1 })
    game = await updateSudoku(game, { type: 'toggle', index: multiple, value: 2 })
  })
  expect(document.querySelector('.checked-correct, .checked-incorrect')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Check' }))
  await waitFor(() => expect(cell(correct)).toHaveClass('checked-correct'))
  expect(cell(wrong)).toHaveClass('checked-incorrect')
  expect(cell(multiple)).not.toHaveClass('checked-correct', 'checked-incorrect')
  await user.click(cell(wrong))
  await user.click(screen.getByRole('button', { name: `Add ${game.symbols[game.solution[wrong] - 1].character}` }))
  await waitFor(() => expect(cell(wrong)).not.toHaveClass('checked-incorrect'))
  expect(cell(correct)).toHaveClass('checked-correct')
  cleanup(); render(<App />)
  await screen.findByRole('grid')
  expect(cell(correct)).toHaveClass('checked-correct')
  expect(cell(wrong)).not.toHaveClass('checked-incorrect')
})

it('protects fixed clues and recognizes a fully resolved puzzle without changing learning evidence', async () => {
  await populate()
  const before = await loadWorkspace(), user = userEvent.setup()
  let game = await start()
  await user.click(cell(game.givens.findIndex(Boolean)))
  await user.click(within(screen.getByRole('group', { name: 'Puzzle characters' })).getAllByRole('button')[0])
  expect((await db.sudokuGames.get('current'))?.revision).toBe(0)
  await act(async () => {
    for (let i = 0; i < game.entries.length; i++) if (!game.givens[i]) game = await updateSudoku(game, { type: 'toggle', index: i, value: game.solution[i] })
  })
  await screen.findByText('Puzzle complete. Well done!')
  expect(await loadWorkspace()).toEqual(before)
})

it('speaks only explicit character activations by default and offers Hear for the selection', async () => {
  await populate()
  await savePreferences({ defaultSpeechRate: .25 })
  const user = userEvent.setup(), game = await start()
  expect(speak).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Hear selected character' })).toBeDisabled()
  const given = game.givens.findIndex(Boolean), character = game.symbols[game.givens[given] - 1].character
  act(() => cell(given).focus())
  expect(speak).not.toHaveBeenCalled()
  await user.click(cell(given))
  expect(speak).toHaveBeenCalledTimes(1)
  expect(speak.mock.calls[0][0]).toMatchObject({ text: character, lang: 'zh-CN', rate: .25, voice })
  expect(screen.getByRole('button', { name: `Hear character ${character}` })).toBeEnabled()
  expect(document.querySelector('.sudoku-selected-pinyin')).toBeNull()
  await user.click(screen.getByRole('button', { name: `Hear character ${character}` }))
  expect(speak).toHaveBeenCalledTimes(2)
})

it('persists mute, stops current speech, and keeps manual Hear working without autoplay on reload or unmute', async () => {
  await populate()
  const user = userEvent.setup(), game = await start(), given = game.givens.findIndex(Boolean)
  const character = game.symbols[game.givens[given] - 1].character
  await user.click(cell(given))
  expect(getPlaybackState().activeId).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'Mute automatic character audio' }))
  await waitFor(async () => expect((await db.preferences.get('workspace'))?.sudokuAutoSpeak).toBe(false))
  expect(getPlaybackState().activeId).toBeUndefined()
  expect(cancel).toHaveBeenCalled()
  const count = speak.mock.calls.length
  await user.click(cell(given))
  expect(speak).toHaveBeenCalledTimes(count)
  await user.click(screen.getByRole('button', { name: `Hear character ${character}` }))
  expect(speak).toHaveBeenCalledTimes(count + 1)
  cleanup(); render(<App />)
  await screen.findByRole('grid')
  expect(screen.getByRole('button', { name: 'Unmute automatic character audio' })).toBeInTheDocument()
  expect(speak).toHaveBeenCalledTimes(count + 1)
  await user.click(screen.getByRole('button', { name: 'Unmute automatic character audio' }))
  await screen.findByRole('button', { name: 'Mute automatic character audio' })
  expect(speak).toHaveBeenCalledTimes(count + 1)
})

it('speaks tapped candidates and character-key symbols without double playback or changing entries', async () => {
  await populate()
  const user = userEvent.setup()
  let game = await start()
  const index = game.givens.indexOf(0)
  await act(async () => {
    game = await updateSudoku(game, { type: 'toggle', index, value: 1 })
    game = await updateSudoku(game, { type: 'toggle', index, value: 2 })
  })
  const before = speak.mock.calls.length
  await user.click(cell(index).querySelector('[data-sudoku-symbol="2"]')!)
  expect(speak).toHaveBeenCalledTimes(before + 1)
  expect(speak.mock.lastCall![0].text).toBe(game.symbols[1].character)
  expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(3)
  await user.click(screen.getByLabelText('Character key, pronunciation, and rules'))
  await user.click(screen.getByRole('button', { name: `Learn about ${game.symbols[2].character}` }))
  expect(speak.mock.lastCall![0].text).toBe(game.symbols[2].character)
  cleanup()
  expect(getPlaybackState().activeId).toBeUndefined()
})

it('keeps selected pinyin off by default, lists multiple dictionary readings, and persists the independent toggle', async () => {
  const game = createSudokuGame(generateSudoku({ size: 4, difficulty: 'easy', seed: 2 }),
    Array.from('行好茶学').map(character => ({ character, contexts: [] })), () => .5)
  await db.sudokuGames.put(game)
  await savePreferences({ pinyin: false, sudokuAutoSpeak: false })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('grid')
  await user.click(screen.getByRole('button', { name: 'Add 行' }))
  expect(document.querySelector('.sudoku-selected-pinyin')).toBeNull()
  await user.click(screen.getByLabelText('Character key, pronunciation, and rules'))
  const checkbox = screen.getByRole('checkbox', { name: 'Show pinyin on selection' })
  expect(checkbox).not.toBeChecked()
  await user.click(checkbox)
  await waitFor(() => expect(document.querySelector('.sudoku-selected-pinyin')).toHaveTextContent('Possible readings:'))
  expect(document.querySelector('.sudoku-selected-pinyin')).toHaveTextContent('xíng')
  expect(document.querySelector('.sudoku-selected-pinyin')).toHaveTextContent('háng')
  expect(speak).not.toHaveBeenCalled()
  expect((await db.preferences.get('workspace'))?.pinyin).toBe(false)
  cleanup(); render(<App />)
  await screen.findByRole('grid')
  await user.click(cell(game.givens.indexOf(0)))
  await waitFor(() => expect(document.querySelector('.sudoku-selected-pinyin')).toHaveTextContent('行'))
})

it('surfaces failed saves and supports numeric candidate toggles and erase', async () => {
  await populate()
  const user = userEvent.setup(), game = await start(), index = game.givens.indexOf(0)
  vi.spyOn(db.sudokuGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await user.click(cell(index))
  await user.keyboard('1')
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(0)
  await user.keyboard('1')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(1))
  await user.keyboard('2')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(3))
  await user.keyboard('{Delete}')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(0))
  await user.keyboard('{ArrowRight}')
  expect(cell(Math.floor(index / 4) * 4 + (index + 1) % 4)).toHaveFocus()
})

it('cancels replacement without losing the saved puzzle even if generation replies later', async () => {
  await populate()
  const user = userEvent.setup(), game = await start()
  let finish!: (value: ReturnType<typeof generateSudoku>) => void
  worker.generateSudokuInWorker.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await newPuzzle(user)
  await user.click(screen.getByRole('button', { name: 'Generate puzzle' }))
  await user.click(await screen.findByRole('button', { name: 'Cancel generation' }))
  await act(async () => finish(generateSudoku({ size: 4, difficulty: 'easy', seed: 2 })))
  await screen.findByText('Puzzle generation canceled. Your previous puzzle is unchanged.')
  expect((await db.sudokuGames.get('current'))?.gameId).toBe(game.gameId)
})

it('loads old scratch-marker saves and upgrades them on the next action', async () => {
  const puzzle = generateSudoku({ size: 4, difficulty: 'easy', seed: 10 })
  const index = puzzle.givens.indexOf(0)
  const excluded = Array(16).fill(0); excluded[index] = 1
  await db.table('sudokuGames').put({
    ...puzzle, id: 'current', gameId: 'old-board', revision: 0,
    symbols: characters.slice(0, 4).map(character => ({ character, contexts: [] })),
    values: [...puzzle.givens], excluded, history: [],
  })
  render(<App />)
  await screen.findByRole('grid')
  expect(cell(index).querySelector('.sudoku-candidates')).toHaveTextContent(characters[1])
  expect(cell(index).querySelector('.sudoku-candidates')).not.toHaveTextContent(characters[0])
  await userEvent.setup().click(screen.getByRole('button', { name: 'Check' }))
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.version).toBe(2))
  expect((await db.sudokuGames.get('current'))?.gameId).toBe('old-board')
  expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(14)
})

it('surfaces playback errors without preventing entry edits', async () => {
  await populate()
  const game = await start(), user = userEvent.setup(), index = game.givens.indexOf(0)
  await user.click(cell(index))
  await user.click(screen.getByRole('button', { name: `Add ${game.symbols[0].character}` }))
  act(() => speak.mock.lastCall![0].onerror?.({ error: 'not-allowed' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Speech was blocked')
  await waitFor(async () => expect((await db.sudokuGames.get('current'))?.entries[index]).toBe(1))
})

it('shows contextual pinyin for a character supplied only through a compound word', async () => {
  const game = createSudokuGame(generateSudoku({ size: 4, difficulty: 'easy', seed: 4 }), [
    { character: '名', contexts: [{ text: '名字', pinyin: 'míng zi', meaning: 'name' }] },
    ...Array.from('天地人').map(character => ({ character, contexts: [] })),
  ])
  await db.sudokuGames.put(game)
  await savePreferences({ sudokuShowPinyin: true, sudokuAutoSpeak: false })
  render(<App />)
  await screen.findByRole('grid')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Add 名' }))
  await waitFor(() => expect(document.querySelector('.sudoku-selected-pinyin')).toHaveTextContent('míng'))
  expect(document.querySelector('.sudoku-selected-pinyin')).not.toHaveTextContent('No standalone')
})

it('keeps typed phrase characters in first-appearance order, deduplicates and truncates, and preserves the source on reload', async () => {
  await db.characterStates.bulkPut(Array.from('我学习中').map(character => ({ character, manualAddedAt: 1, practiceCompletions: 0 })))
  const user = userEvent.setup()
  render(<App />)
  await screen.findByLabelText('Character source')
  await user.selectOptions(screen.getByLabelText('Grid size'), '4')
  await user.selectOptions(screen.getByLabelText('Character source'), 'custom')
  await user.type(screen.getByLabelText('Chinese phrase or sentence'), '我我学习中文。')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate puzzle' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Generate puzzle' }))
  await screen.findByRole('grid')
  const game = (await db.sudokuGames.get('current'))!
  expect(game.symbols.map(symbol => symbol.character)).toEqual(Array.from('我学习中'))
  expect(game.phrase).toMatchObject({ source: 'custom', text: '我我学习中文。' })
  expect(phrasesAI.requestStructuredJSON).not.toHaveBeenCalled()
  cleanup(); render(<App />)
  await screen.findByRole('grid')
  expect(document.querySelector('.sudoku-source-phrase')).toHaveTextContent('我我学习中文。')
  expect(within(screen.getByRole('group', { name: 'Puzzle characters' })).getAllByRole('button').map(button => button.textContent)).toEqual(Array.from('我学习中'))
  await newPuzzle(user)
  expect(screen.getByLabelText('Character source')).toHaveValue('custom')
  expect(screen.getByLabelText('Chinese phrase or sentence')).toHaveValue('我我学习中文。')
})

it('offers authored examples based on known vocabulary and keeps random mode available', async () => {
  const catalog = await loadCatalog()
  const example = catalog.orderedGroups.flatMap(({ group }) => group.examples).find(example => wordCharacters(renderExample(catalog, example).text).length >= 4)!
  const refs = new Set(example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : []))
  const units = [...catalog.units.values()].filter(unit => refs.has(unit.ref))
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  const user = userEvent.setup()
  render(<App />)
  await screen.findByLabelText('Character source')
  expect(screen.getByLabelText('Character source')).toHaveValue('random')
  await user.selectOptions(screen.getByLabelText('Grid size'), '4')
  await user.selectOptions(screen.getByLabelText('Character source'), 'lesson')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate puzzle' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Generate puzzle' }))
  await screen.findByRole('grid')
  expect((await db.sudokuGames.get('current'))?.phrase?.source).toBe('lesson')
})

it('only requests an AI sentence explicitly and lets the learner review it before generating a puzzle', async () => {
  const catalog = await loadCatalog()
  const units = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary' && ['我', '学习', '中文'].includes(unit.record.ch))
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  await db.aiConnections.put({ id: 'assistant', revision: 'r1', updatedAt: 1, baseUrl: 'https://example.test/v1', apiKey: 'synthetic-key', model: 'model', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
  phrasesAI.requestStructuredJSON.mockResolvedValueOnce({ text: '我学习中文。', translation: 'I study Chinese.' })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByLabelText('Character source')
  await user.selectOptions(screen.getByLabelText('Grid size'), '4')
  await user.selectOptions(screen.getByLabelText('Character source'), 'ai')
  expect(phrasesAI.requestStructuredJSON).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Suggest phrase with AI' }))
  await screen.findByText('I study Chinese.')
  expect(phrasesAI.requestStructuredJSON).toHaveBeenCalledTimes(1)
  expect(await db.sudokuGames.count()).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Generate puzzle' }))
  await screen.findByRole('grid')
  expect((await db.sudokuGames.get('current'))?.phrase?.source).toBe('ai')
  expect(phrasesAI.requestStructuredJSON).toHaveBeenCalledTimes(1)
})
