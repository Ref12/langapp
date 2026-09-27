import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { trackWord } from '../core/learning'
import { loadCatalog } from '../core/study/catalog'
import { MEMORY_MISMATCH_DELAY_MS, type MemoryMode } from '../core/games/memory'

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
  expect(board().querySelector('[data-match-color]')).toBeNull()
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

it.each(['mixed', 'triplets'] as const)('flips a mismatched %s turn back automatically after a pause, including after reload', async mode => {
  const game = await prepare(mode), user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  await waitFor(() => expect(tile(0)).toBeEnabled())
  const first = game.tiles[0], other = game.tiles.find(item => item.word.id !== first.word.id)!
  const chosen = [first, other]
  for (const item of chosen) {
    await waitFor(() => expect(tile(item.id)).toBeEnabled())
    await user.click(tile(item.id))
  }
  await screen.findByText('Not a match. These cards will turn over shortly.')
  expect(board().querySelectorAll('.memory-word')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  expect(within(board()).getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)
  cleanup(); render(<App />)
  await screen.findByText('Not a match. These cards will turn over shortly.')
  expect(board().querySelectorAll('.memory-word')).toHaveLength(2)
  await waitFor(() => expect(board().querySelectorAll('.memory-word')).toHaveLength(0), { timeout: MEMORY_MISMATCH_DELAY_MS + 2000 })
  expect((await db.memoryGames.get('current'))?.attempts).toBe(1)
}, 10_000)

it('colors each completed triplet without removing any cards, including on the completed board', async () => {
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
    expect(group.every(item => tile(item.id).classList.contains('matched'))).toBe(true)
    expect(new Set(group.map(item => tile(item.id).getAttribute('data-match-color'))).size).toBe(1)
    expect(group.every(item => tile(item.id).disabled)).toBe(true)
  }
  await screen.findByRole('heading', { name: 'You found every triplet.' })
  expect((await db.memoryGames.get('current'))?.attempts).toBe(4)
  expect(board().querySelectorAll('.memory-card')).toHaveLength(12)
  expect(board().querySelectorAll('.memory-card.matched')).toHaveLength(12)
  expect(new Set([...board().querySelectorAll('[data-match-color]')].map(tile => tile.getAttribute('data-match-color'))).size).toBe(4)
  const colors = game.tiles.map(item => tile(item.id).getAttribute('data-match-color'))
  cleanup(); render(<App />)
  await screen.findByRole('heading', { name: 'You found every triplet.' })
  expect(game.tiles.map(item => tile(item.id).getAttribute('data-match-color'))).toEqual(colors)
  expect(await loadWorkspace()).toEqual(before)
})

it('keeps previously matched cards colored while another pair flips back', async () => {
  const game = await prepare(), user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  const matched = game.tiles.filter(item => item.word.id === game.tiles[0].word.id)
  for (const item of matched) {
    await waitFor(() => expect(tile(item.id)).toBeEnabled())
    await user.click(tile(item.id))
  }
  await waitFor(() => expect(tile(matched[0].id)).toHaveClass('matched'))
  const color = tile(matched[0].id).getAttribute('data-match-color')
  const first = game.tiles.find(item => item.word.id !== matched[0].word.id)!
  const second = game.tiles.find(item => item.word.id !== first.word.id && item.word.id !== matched[0].word.id)!
  await user.click(tile(first.id))
  await waitFor(() => expect(tile(second.id)).toBeEnabled())
  await user.click(tile(second.id))
  await screen.findByText('Not a match. These cards will turn over shortly.')
  expect(tile(matched[0].id)).not.toHaveClass('mismatch')
  await waitFor(() => expect(tile(first.id)).toHaveClass('face-down'), { timeout: MEMORY_MISMATCH_DELAY_MS + 2000 })
  expect(matched.every(item => tile(item.id).getAttribute('data-match-color') === color)).toBe(true)
  expect(board().querySelectorAll('.memory-word')).toHaveLength(2)
}, 10_000)

it('does not retry a failed automatic save in a loop, but offers a recovery action', async () => {
  const game = await prepare('triplets'), user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  await waitFor(() => expect(tile(0)).toBeEnabled())
  const first = game.tiles[0], second = game.tiles.find(item => item.word.id !== first.word.id)!
  await user.click(tile(first.id))
  await waitFor(() => expect(tile(second.id)).toBeEnabled())
  await user.click(tile(second.id))
  await screen.findByText('Not a match. These cards will turn over shortly.')
  const put = vi.spyOn(db.memoryGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await screen.findByRole('button', { name: 'Retry turning cards over' }, { timeout: MEMORY_MISMATCH_DELAY_MS + 2000 })
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  await new Promise(resolve => setTimeout(resolve, MEMORY_MISMATCH_DELAY_MS + 100))
  expect(put).toHaveBeenCalledTimes(1)
  expect(board().querySelectorAll('.memory-word')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Retry turning cards over' }))
  await waitFor(() => expect(board().querySelectorAll('.memory-word')).toHaveLength(0))
}, 10_000)

it('cancels a pending flip timer when leaving the board', async () => {
  const game = await prepare('triplets'), user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start memory' }))
  await waitFor(() => expect(tile(0)).toBeEnabled())
  const second = game.tiles.find(item => item.word.id !== game.tiles[0].word.id)!
  await user.click(tile(0))
  await waitFor(() => expect(tile(second.id)).toBeEnabled())
  await user.click(tile(second.id))
  await screen.findByText('Not a match. These cards will turn over shortly.')
  cleanup()
  await new Promise(resolve => setTimeout(resolve, MEMORY_MISMATCH_DELAY_MS + 100))
  expect((await db.memoryGames.get('current'))?.phase).toBe('review')
}, 10_000)

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
