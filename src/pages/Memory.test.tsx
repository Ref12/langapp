import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { trackWord } from '../core/learning'
import { loadCatalog } from '../core/study/catalog'
import { memoryGroupSize, type MemoryMode } from '../core/games/memory'

beforeEach(async () => { window.location.hash = '#games/memory'; await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const tile = (id: number) => document.querySelector<HTMLButtonElement>(`[data-memory-tile="${id}"]`)!
const board = () => screen.getByRole('group', { name: 'Memory tiles' })

async function prepare(mode: MemoryMode = 'mixed') {
  const user = userEvent.setup()
  for (const id of ['zh:tea', 'zh:rain', 'zh:cup', 'zh:friend']) await trackWord(id, 'test')
  render(<App />)
  const select = await screen.findByLabelText('Matching mode')
  await user.selectOptions(select, mode)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare tiles' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Prepare tiles' }))
  await screen.findByRole('button', { name: 'Start memory' })
  return (await db.memoryGames.get('current'))!
}

it('is discoverable in Games and requires enough introduced vocabulary', async () => {
  window.location.hash = '#games'
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('link', { name: 'Play Memory' }))
  await screen.findByText('0 distinct short words available from your introduced vocabulary.')
  expect(screen.getByRole('button', { name: 'Prepare tiles' })).toBeDisabled()
  expect(document.querySelector('.memory-board')).toBeNull()
})

it.each(['mixed', 'triplets'] as const)('shows a study phase then keeps %s answers out of the concealed DOM', async mode => {
  const game = await prepare(mode), user = userEvent.setup()
  const ids = [...board().querySelectorAll('[data-memory-tile]')].map(element => element.getAttribute('data-memory-tile'))
  expect(board().querySelectorAll('.memory-word')).toHaveLength(game.tiles.length)
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  await waitFor(() => expect(board().querySelectorAll('.memory-word')).toHaveLength(0))
  expect(board().querySelectorAll('[lang], [title]')).toHaveLength(0)
  expect(within(board()).getAllByRole('button').every(button => /^Reveal tile \d+$/.test(button.getAttribute('aria-label') ?? ''))).toBe(true)
  expect([...board().querySelectorAll('[data-memory-tile]')].map(element => element.getAttribute('data-memory-tile'))).toEqual(ids)
  await user.click(tile(0))
  await waitFor(() => expect(board().querySelectorAll('.memory-word')).toHaveLength(1))
  expect(tile(0)).toBeDisabled()
  cleanup(); render(<App />)
  await screen.findByRole('group', { name: 'Memory tiles' })
  expect(board().querySelectorAll('.memory-word')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Start memory' })).not.toBeInTheDocument()
})

it.each(['mixed', 'triplets'] as const)('holds a mismatched %s turn until Continue, including after reload', async mode => {
  const game = await prepare(mode), user = userEvent.setup(), size = memoryGroupSize(mode)
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  await waitFor(() => expect(tile(0)).toBeEnabled())
  const first = game.tiles[0], other = game.tiles.find(item => item.word.id !== first.word.id)!
  const chosen = [first, other]
  if (size === 3) chosen.push(game.tiles.find(item => !chosen.some(tile => tile.id === item.id))!)
  for (const item of chosen) {
    await waitFor(() => expect(tile(item.id)).toBeEnabled())
    await user.click(tile(item.id))
  }
  await screen.findByRole('button', { name: 'Continue' })
  expect(board().querySelectorAll('.memory-word')).toHaveLength(size)
  expect(within(board()).getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)
  cleanup(); render(<App />)
  await screen.findByRole('button', { name: 'Continue' })
  expect(board().querySelectorAll('.memory-word')).toHaveLength(size)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(board().querySelectorAll('.memory-word')).toHaveLength(0))
  expect((await db.memoryGames.get('current'))?.attempts).toBe(1)
})

it('removes a triplet only after all three representations are revealed, and completes without scoring learning', async () => {
  const game = await prepare('triplets'), user = userEvent.setup(), before = await loadWorkspace()
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  const groups = [...new Set(game.tiles.map(item => item.word.id))]
  for (const [index, id] of groups.entries()) {
    const group = game.tiles.filter(item => item.word.id === id)
    for (const [position, item] of group.entries()) {
      await waitFor(() => expect(tile(item.id)).toBeEnabled())
      await user.click(tile(item.id))
      if (position < 2) {
        await waitFor(async () => expect((await db.memoryGames.get('current'))?.turned).toHaveLength(position + 1))
        expect((await db.memoryGames.get('current'))?.matched).toHaveLength(index * 3)
      }
    }
    await waitFor(async () => expect((await db.memoryGames.get('current'))?.matched).toHaveLength((index + 1) * 3))
  }
  await screen.findByRole('heading', { name: 'You found every triplet.' })
  expect((await db.memoryGames.get('current'))?.attempts).toBe(4)
  expect(await loadWorkspace()).toEqual(before)
})

it('includes introduced v2 vocabulary, never grammar, and can cancel replacing the current board', async () => {
  const catalog = await loadCatalog()
  const all = [...catalog.units.values()]
  const units = [...all.filter(unit => unit.kind === 'vocabulary').slice(0, 12), ...all.filter(unit => unit.kind === 'grammar').slice(0, 3)]
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  const user = userEvent.setup()
  render(<App />)
  await screen.findByLabelText('Matching mode')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare tiles' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Prepare tiles' }))
  await screen.findByRole('button', { name: 'Start memory' })
  const game = (await db.memoryGames.get('current'))!
  expect(game.tiles.every(item => item.word.id.startsWith('vocabulary:'))).toBe(true)
  await user.click(screen.getByText('Rules and new board'))
  await user.click(screen.getByRole('button', { name: 'New board' }))
  await user.selectOptions(screen.getByLabelText('Matching mode'), 'triplets')
  await user.click(screen.getByRole('button', { name: 'Keep current board' }))
  expect((await db.memoryGames.get('current'))?.gameId).toBe(game.gameId)
  expect((await db.memoryGames.get('current'))?.mode).toBe('mixed')
})

it('shows failed saves instead of flipping unsaved cards', async () => {
  const game = await prepare(), user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  await waitFor(() => expect(tile(0)).toBeEnabled())
  vi.spyOn(db.memoryGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await user.click(tile(0))
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  expect(board().querySelectorAll('.memory-word')).toHaveLength(0)
  expect((await db.memoryGames.get('current'))?.gameId).toBe(game.gameId)
  expect((await db.memoryGames.get('current'))?.turned).toEqual([])
  await act(async () => { vi.restoreAllMocks() })
})
