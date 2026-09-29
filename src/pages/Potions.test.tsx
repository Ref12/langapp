import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import { stopBrowserSpeech } from '../core/assistant/speech'
import { withAutoCompletedSpeechPreparation } from '../test/mock-speech-preparation'
import { canMovePotion, phraseText, type PotionsGame } from '../core/games/potions'
import * as potionsStore from '../core/games/potions-store'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''; rate = 1; volume = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}
const voice: SpeechSynthesisVoice = { name: 'Test Mandarin', lang: 'zh-CN', voiceURI: 'potions-zh', localService: true, default: true }
const synthesis = Object.assign(new EventTarget(), {
  getVoices: () => [voice], speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
})
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')

beforeEach(async () => {
  window.location.hash = '#games/potions'
  await db.delete()
  await db.open()
  await initializeWorkspace()
  synthesis.speak.mockReset(); synthesis.cancel.mockReset()
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  stopBrowserSpeech()
})
afterEach(() => {
  cleanup(); stopBrowserSpeech(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

const vial = (index: number) => document.querySelector<HTMLButtonElement>(`[data-potions-vial="${index}"]`)!

async function introduce() {
  const catalog = await loadCatalog()
  const examples = catalog.orderedGroups.flatMap(({ group }) => group.examples)
    .filter(example => {
      const words = example.segments.filter(segment => segment.word).length
      return words >= 2 && words <= 4
    }).slice(0, 8)
  const refs = new Set(examples.flatMap(example => example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : [])))
  const units = [...catalog.units.values()].filter(unit => refs.has(unit.ref))
  await db.knowledge.bulkPut(units.map(unit => ({
    ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const,
  })))
}

async function play(level = 1) {
  render(<App />)
  const button = await screen.findByRole('button', { name: `Play level ${level}` })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.setup().click(button)
  await screen.findByRole('group', { name: 'Vials' })
  return (await db.potionGames.get('current'))!
}

/** Leaves the puzzle one pour away from being brewed. */
async function almostSolved(game: PotionsGame) {
  const rows = game.phrases.map((phrase, index) => phrase.words.map((text, position) => ({ id: `${index}-${position}`, text, phrase: index })))
  const stray = rows[0].pop()!
  const next = { ...game, revision: game.revision + 1, moves: 4, history: [], rows: [...rows, [stray]] }
  await act(async () => { await db.potionGames.put(next) })
  await waitFor(() => expect(document.querySelectorAll('[data-potions-vial]')).toHaveLength(next.rows.length))
  return { game: next, stray: rows.length }
}

it('is offered from Games and asks for known lesson phrases first', async () => {
  window.location.hash = '#games'
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('link', { name: 'Play Potions' }))
  await screen.findByText('0 lesson phrases are fully known and ready to brew.')
  expect(screen.getByRole('button', { name: 'Play level 1' })).toBeDisabled()
  expect(document.querySelector('.potions-board')).toBeNull()
})

it('pours a word onto the word it follows, refuses others, and keeps the puzzle across reloads', async () => {
  await introduce()
  const game = await play()
  const user = userEvent.setup()
  const from = game.rows.findIndex(row => row.length)
  const empty = game.rows.findIndex(row => !row.length)
  const lifted = game.rows[from][game.rows[from].length - 1]
  expect(vial(from)).toHaveAccessibleName(`Vial ${from + 1}: ${game.rows[from].map(tile => tile.text).join(' ')}`)
  expect(vial(empty)).toHaveAccessibleName(`Vial ${empty + 1}: empty`)
  await user.click(vial(empty))
  await screen.findByText('That vial is empty. Choose a vial with words in it.')
  await user.click(vial(from))
  expect(vial(from)).toHaveAttribute('aria-pressed', 'true')
  await user.click(vial(empty))
  await waitFor(async () => expect((await db.potionGames.get('current'))?.moves).toBe(1))
  await waitFor(() => expect(vial(empty)).toHaveTextContent(lifted.text))
  const blocked = (await db.potionGames.get('current'))!
  let refused: [number, number] | undefined
  for (let source = 0; source < blocked.rows.length && !refused; source++) {
    for (let target = 0; target < blocked.rows.length; target++) {
      const check = canMovePotion(blocked, source, target)
      if (!check.ok && check.reason?.includes('does not follow')) { refused = [source, target]; break }
    }
  }
  expect(refused).toBeDefined()
  await user.click(vial(refused![0]))
  await user.click(vial(refused![1]))
  await screen.findByText(/does not follow/)
  expect((await db.potionGames.get('current'))?.moves).toBe(1)
  await user.click(screen.getByRole('button', { name: /Undo/ }))
  await waitFor(async () => expect((await db.potionGames.get('current'))?.moves).toBe(0))
  cleanup(); render(<App />)
  await screen.findByRole('group', { name: 'Vials' })
  expect(vial(from).textContent).toContain(lifted.text)
})

it('speaks a brewed phrase, awards stars, records progress, and offers the next level', async () => {
  await introduce()
  const started = await play()
  const { game, stray } = await almostSolved(started)
  const user = userEvent.setup()
  await user.click(vial(stray))
  await user.click(vial(0))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent(`Level ${game.level} brewed!`)
  expect(dialog.querySelector('.potions-stars')).toHaveAccessibleName('3 of 3 stars')
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalled())
  expect(synthesis.speak.mock.lastCall![0]).toMatchObject({ text: phraseText(game.phrases[0]), lang: 'zh-CN' })
  await waitFor(async () => expect((await db.potionProgress.get('progress'))?.stars).toEqual({ 1: 3 }))
  expect((await db.potionGames.get('current'))?.phase).toBe('complete')
  await user.click(screen.getByRole('button', { name: 'Next level' }))
  await waitFor(async () => expect((await db.potionGames.get('current'))?.level).toBe(2))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((await db.potionGames.get('current'))?.phase).toBe('play')
})

it('closes the summary to show the finished vials and lists cleared levels', async () => {
  await introduce()
  const started = await play()
  const { stray } = await almostSolved(started)
  const user = userEvent.setup()
  await user.click(vial(stray))
  await user.click(vial(0))
  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: 'View the vials' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('group', { name: 'Vials' })).toBeInTheDocument()
  expect(document.querySelectorAll('.potions-vial.done')).toHaveLength(started.phrases.length)
  await user.click(screen.getByRole('button', { name: /Levels/ }))
  const levels = await screen.findByRole('list', { name: 'Levels' })
  expect(levels.querySelectorAll('button')).toHaveLength(2)
  expect(levels.querySelector('button')).toHaveAccessibleName('Level 1, 3 of 3 stars')
  await user.click(screen.getByRole('button', { name: 'Level 2, not yet cleared' }))
  await waitFor(async () => expect((await db.potionGames.get('current'))?.level).toBe(2))
})

it('discards an invalid saved puzzle without losing the level picker', async () => {
  await introduce()
  await db.table('potionGames').put({ id: 'current', gameId: 'broken' })
  render(<App />)
  await screen.findByText('The saved Phrase Potions puzzle is invalid. Start a level to replace it.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play level 1' })).toBeEnabled())
})

function mockPour() {
  const animation = Object.assign(new EventTarget(), { cancel: vi.fn() })
  const animate = vi.fn(() => animation)
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 20, y: 50, left: 20, top: 50, right: 110, bottom: 94, width: 90, height: 44, toJSON: () => ({}),
  })
  return { animation, animate }
}

it('saves before flying, locks repeat pours, then lands only the moved tile and celebrates', async () => {
  await introduce()
  const started = await play()
  const { game, stray } = await almostSolved(started)
  const { animation, animate } = mockPour()
  const user = userEvent.setup()
  await user.click(vial(stray))
  await user.click(vial(0))
  await waitFor(() => expect(animate).toHaveBeenCalledOnce())
  expect((await db.potionGames.get('current'))?.phase).toBe('complete')
  const flying = document.querySelector('.potions-fly')!
  expect(flying).toHaveAttribute('aria-hidden', 'true')
  expect(flying).toHaveTextContent(game.rows[stray][0].text)
  expect(document.querySelector('.potions-tile.ghost')).toHaveTextContent(game.rows[stray][0].text)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(synthesis.speak).not.toHaveBeenCalled()
  expect(vial(0)).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Restart' })).toBeDisabled()
  fireEvent.click(vial(stray))
  fireEvent.click(vial(0))
  expect((await db.potionGames.get('current'))?.moves).toBe(game.moves + 1)
  await act(async () => { animation.dispatchEvent(new Event('finish')) })
  await screen.findByRole('dialog')
  expect(document.querySelector('.potions-fly')).toBeNull()
  expect(document.querySelector('.potions-tile.ghost')).toBeNull()
  expect(document.querySelectorAll('.potions-tile.landed')).toHaveLength(1)
  expect(document.querySelectorAll('.potions-vial.fresh')).toHaveLength(1)
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalledOnce())
})

it('keeps the source word and selection on a failed save without flying or speaking', async () => {
  await introduce()
  const started = await play()
  const { game, stray } = await almostSolved(started)
  const { animate } = mockPour()
  vi.spyOn(potionsStore, 'updatePotions').mockRejectedValueOnce(new Error('Storage full'))
  const user = userEvent.setup()
  await user.click(vial(stray))
  await user.click(vial(0))
  await screen.findByText(/Unable to complete this action. Storage full/)
  expect(animate).not.toHaveBeenCalled()
  expect(synthesis.speak).not.toHaveBeenCalled()
  expect(vial(stray)).toHaveAttribute('aria-pressed', 'true')
  expect(vial(stray)).toHaveTextContent(game.rows[stray][0].text)
  expect(vial(0)).toBeEnabled()
  expect((await db.potionGames.get('current'))?.moves).toBe(game.moves)
})

it.each(['hidden', 'pagehide', 'navigation'] as const)('cleans up an in-flight pour on %s without losing its saved move or starting speech', async reason => {
  await introduce()
  const started = await play()
  const { stray } = await almostSolved(started)
  const { animation, animate } = mockPour()
  const user = userEvent.setup()
  await user.click(vial(stray))
  await user.click(vial(0))
  await waitFor(() => expect(animate).toHaveBeenCalledOnce())
  if (reason === 'hidden') {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
  } else if (reason === 'pagehide') fireEvent(window, new Event('pagehide'))
  else await user.click(screen.getByRole('link', { name: 'Back to Games' }))
  await waitFor(() => expect(document.querySelector('.potions-fly')).toBeNull())
  expect(animation.cancel).toHaveBeenCalled()
  expect(synthesis.speak).not.toHaveBeenCalled()
  expect((await db.potionGames.get('current'))?.phase).toBe('complete')
})

it('skips flight for reduced motion and does not replay it after reload', async () => {
  await introduce()
  const started = await play()
  const { stray } = await almostSolved(started)
  const { animate } = mockPour()
  vi.stubGlobal('matchMedia', (media: string) => Object.assign(new EventTarget(), { matches: media === '(prefers-reduced-motion: reduce)', media }))
  const user = userEvent.setup()
  await user.click(vial(stray))
  await user.click(vial(0))
  await screen.findByRole('dialog')
  expect(animate).not.toHaveBeenCalled()
  expect(document.querySelector('.potions-tile.landed')).toBeNull()
  cleanup(); render(<App />)
  await screen.findByRole('dialog')
  expect(animate).not.toHaveBeenCalled()
  expect(document.querySelector('.potions-tile.landed')).toBeNull()
})

it('reveals only colors in smoky levels and charges each power-up once', async () => {
  await introduce()
  const started = await play()
  await act(async () => { await db.potionGames.put({ ...started, level: 25, hidden: true, revision: 1 }) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Colors' })).toBeEnabled())
  const user = userEvent.setup()
  expect(document.querySelectorAll('[data-potions-tile][data-potion-color="smoke"]')).toHaveLength(started.rows.flat().length)
  await user.click(screen.getByRole('button', { name: 'Colors' }))
  // Busy state also disables the buttons before the saved board is rendered.
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Colors' })).toBeDisabled()
    expect(document.querySelector('[data-potions-tile][data-potion-color="smoke"]')).toBeNull()
    expect(screen.getByRole('img', { name: '2 of 3 stars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spare vial' })).toBeEnabled()
  })
  await user.click(screen.getByRole('button', { name: 'Spare vial' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Spare vial' })).toBeDisabled()
    expect(document.querySelectorAll('[data-potions-vial]')).toHaveLength(started.rows.length + 1)
    expect(screen.getByRole('img', { name: '1 of 3 stars' })).toBeInTheDocument()
  })
})
