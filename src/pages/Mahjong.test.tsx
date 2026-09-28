import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import { trackWord } from '../core/learning'
import { availablePairs, createMahjong, isFree, matches, remainingTiles, type MahjongTile } from '../core/games/mahjong'
import * as mahjongStore from '../core/games/mahjong-store'
import { getPlaybackState, stopBrowserSpeech } from '../core/assistant/speech'
import { withAutoCompletedSpeechPreparation } from '../test/mock-speech-preparation'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''; rate = 1; volume = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}
const voice: SpeechSynthesisVoice = { name: 'Test Mandarin', lang: 'zh-CN', voiceURI: 'mahjong-zh', localService: true, default: true }
const synthesis = Object.assign(new EventTarget(), {
  getVoices: () => [voice], speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
})

beforeEach(async () => {
  window.location.hash = '#games/mahjong'
  await db.delete()
  await db.open()
  await initializeWorkspace()
  synthesis.speak.mockReset(); synthesis.cancel.mockReset()
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  stopBrowserSpeech()
})
afterEach(() => { cleanup(); stopBrowserSpeech(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const labels = { character: 'Character', pinyin: 'Pinyin', meaning: 'English' }
const tileName = (tile: MahjongTile) => `${labels[tile.face]}: ${tile.word[tile.face]}`
const tileButton = (tile: MahjongTile) => screen.getAllByRole('button', { name: tileName(tile) }).find(button => button.getAttribute('data-tile-id') === String(tile.id))!

async function introduce() {
  const catalog = await loadCatalog()
  const units = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary').slice(0, 25)
  await db.knowledge.bulkPut(units.map(unit => ({
    ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const,
  })))
  return units
}

async function deal() {
  render(<App />)
  const button = await screen.findByRole('button', { name: 'Deal tiles' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.setup().click(button)
  await screen.findByRole('group', { name: 'Mahjong tiles' })
  return (await db.mahjongGames.get('current'))!
}

it('offers the game from Games and explains how to get enough introduced vocabulary', async () => {
  window.location.hash = '#games'
  render(<App />)
  await userEvent.setup().click(await screen.findByRole('link', { name: 'Play Mahjong' }))
  await screen.findByText(/0 distinct short words/)
  expect(screen.getByRole('button', { name: 'Deal tiles' })).toBeDisabled()
  expect(within(screen.getByRole('region', { name: 'New Mahjong board' })).getByRole('link', { name: 'Dictionary' })).toHaveAttribute('href', '#dictionary')
  expect(await db.mahjongGames.count()).toBe(0)
})

it('uses both legacy learning words and current knowledge without adding untaught vocabulary', async () => {
  for (const id of ['zh:tea', 'zh:rain', 'zh:cup', 'zh:friend']) await trackWord(id, 'test')
  const game = await deal()
  expect(new Set(game.tiles.map(tile => tile.word.id))).toEqual(new Set(['zh:tea', 'zh:rain', 'zh:cup', 'zh:friend']))
})

it('plays layered cross-representation pairs, persists after reload, and never awards learning progress', async () => {
  const units = await introduce()
  const before = await loadWorkspace()
  const user = userEvent.setup()
  let game = await deal()
  expect(game.tiles.every(tile => units.some(unit => unit.ref === tile.word.id))).toBe(true)
  expect(document.querySelector('.mahjong-board rt')).toBeNull()
  const remaining = remainingTiles(game)
  const blocked = remaining.find(tile => !isFree(tile, remaining))!
  expect(tileButton(blocked)).toBeDisabled()
  expect(synthesis.speak).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Hint' }))
  await waitFor(() => expect(document.querySelectorAll('.mahjong-tile.hinted')).toHaveLength(2))
  expect(synthesis.speak).not.toHaveBeenCalled()
  const [first, second] = availablePairs(game)[0]
  await user.click(tileButton(first))
  expect(tileButton(first)).toHaveAttribute('aria-pressed', 'true')
  expect(synthesis.speak).not.toHaveBeenCalled()
  await user.click(tileButton(second))
  await waitFor(async () => expect((await db.mahjongGames.get('current'))?.removed).toHaveLength(2))
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalledOnce())
  expect(synthesis.speak.mock.lastCall![0]).toMatchObject({ text: first.word.character, lang: 'zh-CN' })
  cleanup()
  render(<App />)
  await screen.findByRole('group', { name: 'Mahjong tiles' })
  expect(synthesis.speak).toHaveBeenCalledOnce()
  expect(document.querySelector(`[data-tile-id="${first.id}"]`)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(tileButton(first)).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Reshuffle' }))
  await waitFor(async () => expect((await db.mahjongGames.get('current'))?.shuffles).toBe(1))
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  expect(synthesis.speak).toHaveBeenCalledOnce()
  game = (await db.mahjongGames.get('current'))!
  while (remainingTiles(game).length) {
    if (!availablePairs(game).length) {
      await user.click(screen.getByRole('button', { name: 'Reshuffle' }))
      await waitFor(async () => expect((await db.mahjongGames.get('current'))?.revision).toBeGreaterThan(game.revision))
      game = (await db.mahjongGames.get('current'))!
    }
    const pair = availablePairs(game)[0]
    for (const tile of pair) await user.click(tileButton(tile))
    await waitFor(async () => expect((await db.mahjongGames.get('current'))?.revision).toBeGreaterThan(game.revision))
    game = (await db.mahjongGames.get('current'))!
  }
  await screen.findByRole('heading', { name: 'Board cleared!' })
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalledTimes(1 + game.tiles.length / 2))
  expect(getPlaybackState().activeId).toBeDefined()
  expect(await loadWorkspace()).toEqual(before)
  expect(screen.getByRole('button', { name: 'Deal tiles' })).toBeEnabled()
}, 20000)

it('lets the player choose pair types and cancel replacing an unfinished board', async () => {
  await introduce()
  const user = userEvent.setup()
  const game = await deal()
  await user.click(screen.getByText('Rules and new board'))
  await user.click(screen.getByRole('button', { name: 'New board' }))
  await user.click(screen.getByRole('button', { name: 'Keep playing' }))
  expect((await db.mahjongGames.get('current'))?.gameId).toBe(game.gameId)
  await user.click(screen.getByRole('button', { name: 'New board' }))
  await user.selectOptions(screen.getByLabelText('Tile pairs'), 'character-pinyin')
  await user.click(screen.getByRole('button', { name: 'Replace board' }))
  await waitFor(async () => expect((await db.mahjongGames.get('current'))?.mode).toBe('character-pinyin'))
  expect(within(screen.getByRole('group', { name: 'Mahjong tiles' })).queryByRole('button', { name: /^English:/ })).not.toBeInTheDocument()
})

it('keeps the board unchanged and surfaces a failed match save', async () => {
  await introduce()
  const game = await deal()
  const user = userEvent.setup()
  vi.spyOn(db.mahjongGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  const pair = availablePairs(game)[0]
  for (const tile of pair) await user.click(tileButton(tile))
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  expect((await db.mahjongGames.get('current'))?.removed).toEqual([])
  expect(synthesis.speak).not.toHaveBeenCalled()
  await act(async () => { vi.restoreAllMocks() })
})

it.each(['mixed', 'character-meaning', 'character-pinyin', 'pinyin-meaning'] as const)('speaks the Chinese word with the selected voice and rate for %s pairs', async mode => {
  const game = createMahjong([
    { id: 'tea', character: '茶', pinyin: 'chá', meaning: 'tea' },
    { id: 'rain', character: '雨', pinyin: 'yǔ', meaning: 'rain' },
    { id: 'water', character: '水', pinyin: 'shuǐ', meaning: 'water' },
    { id: 'friend', character: '朋友', pinyin: 'péng you', meaning: 'friend' },
  ], mode)
  await db.preferences.update('workspace', {
    defaultSpeechRate: 0.5,
    speechVoices: { 'zh-Hans': { name: voice.name, voiceURI: voice.voiceURI, lang: voice.lang, localService: true } },
  })
  await db.mahjongGames.put(game)
  render(<App />)
  await screen.findByRole('group', { name: 'Mahjong tiles' })
  const pair = availablePairs(game)[0]
  const user = userEvent.setup()
  for (const tile of pair) await user.click(tileButton(tile))
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalledOnce())
  expect(synthesis.speak.mock.lastCall![0]).toMatchObject({ text: pair[0].word.character, lang: 'zh-CN', rate: 0.5, voice })
  expect((await db.mahjongGames.get('current'))?.removed).toHaveLength(2)
})

it('does not speak when two free tiles are not a pair', async () => {
  await introduce()
  const game = await deal()
  const remaining = remainingTiles(game)
  const first = remaining.find(tile => isFree(tile, remaining))!
  const second = remaining.find(tile => isFree(tile, remaining) && tile.id !== first.id && !matches(first, tile))!
  const user = userEvent.setup()
  await user.click(tileButton(first))
  await user.click(tileButton(second))
  await waitFor(async () => expect((await db.mahjongGames.get('current'))?.mistakes).toBe(1))
  expect(synthesis.speak).not.toHaveBeenCalled()
})

it.each(['navigation', 'hidden', 'pagehide'] as const)('stops match audio on %s', async reason => {
  await introduce()
  const game = await deal()
  const user = userEvent.setup()
  for (const tile of availablePairs(game)[0]) await user.click(tileButton(tile))
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalledOnce())
  expect(getPlaybackState().activeId).toBeDefined()
  if (reason === 'navigation') await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Games' }))
  if (reason === 'hidden') {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
  }
  if (reason === 'pagehide') fireEvent(window, new PageTransitionEvent('pagehide'))
  expect(getPlaybackState().activeId).toBeUndefined()
})

it('does not start delayed match speech after leaving during a save', async () => {
  await introduce()
  const game = await deal()
  const persist = mahjongStore.updateMahjong
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(mahjongStore, 'updateMahjong').mockImplementationOnce(async (...args) => {
    await pending
    return persist(...args)
  })
  const user = userEvent.setup()
  try {
    for (const tile of availablePairs(game)[0]) await user.click(tileButton(tile))
    expect(synthesis.speak).not.toHaveBeenCalled()
    await act(async () => {
      window.location.hash = '#games'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
  } finally { await act(async () => release()) }
  await waitFor(async () => expect((await db.mahjongGames.get('current'))?.removed).toHaveLength(2))
  expect(synthesis.speak).not.toHaveBeenCalled()
})

it('displays precomposed pinyin letters even when a saved board has combining tone marks', async () => {
  const game = createMahjong([
    { id: 'good', character: '\u597d', pinyin: 'ha\u030co', meaning: 'good' },
    { id: 'tea', character: '\u8336', pinyin: 'cha\u0301', meaning: 'tea' },
    { id: 'you', character: '\u4f60', pinyin: 'ni\u030c', meaning: 'you' },
    { id: 'go', character: '\u53bb', pinyin: 'qu\u0300', meaning: 'go' },
  ], 'character-pinyin')
  await db.mahjongGames.put(game)
  render(<App />)
  const tile = (await screen.findAllByRole('button', { name: 'Pinyin: h\u01ceo' }))[0]
  expect(tile.textContent).toBe('h\u01ceo')
  expect(tile.textContent).not.toContain('\u030c')
  expect((await db.mahjongGames.get('current'))?.gameId).toBe(game.gameId)
})

it.each([
  ['pagoda', 'Pagoda', 40],
  ['bridges', 'Twin bridges', 42],
] as const)('selects and resumes the %s configuration without resetting it during play', async (id, name, tileCount) => {
  await introduce()
  const user = userEvent.setup()
  render(<App />)
  const select = await screen.findByLabelText('Tile configuration')
  await user.selectOptions(select, id)
  expect(screen.getByRole('img', { name: `${name} tile configuration preview` })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Deal tiles' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Deal tiles' }))
  await screen.findByRole('group', { name: 'Mahjong tiles' })
  const saved = (await db.mahjongGames.get('current'))!
  expect(saved.layout).toBe(id)
  expect(saved.tiles).toHaveLength(tileCount)
  expect(saved.layoutSnapshot?.name).toBe(name)
  cleanup()
  render(<App />)
  await screen.findByRole('group', { name: 'Mahjong tiles' })
  await user.click(screen.getByRole('button', { name: 'Reshuffle' }))
  await waitFor(async () => expect((await db.mahjongGames.get('current'))?.shuffles).toBe(1))
  expect((await db.mahjongGames.get('current'))?.layoutSnapshot).toEqual(saved.layoutSnapshot)
  await user.click(screen.getByLabelText('Rules and new board'))
  await user.click(screen.getByRole('button', { name: 'New board' }))
  expect(screen.getByLabelText('Tile configuration')).toHaveValue(id)
  await user.selectOptions(screen.getByLabelText('Tile configuration'), 'courtyard')
  await user.click(screen.getByRole('button', { name: 'Keep playing' }))
  expect((await db.mahjongGames.get('current'))?.gameId).toBe(saved.gameId)
})
