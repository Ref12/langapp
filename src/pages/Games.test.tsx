import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'
import App from '../App'
import { db } from '../core/database'

beforeEach(async () => { window.location.hash = '#games'; await db.delete(); await db.open() })
afterEach(cleanup)

it('has a standalone menu and hub, and removes the embedded game card from Practice', async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Games' })
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
  expect(within(navigation).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Play Mahjong' })).toHaveAttribute('href', '#games/mahjong')
  await user.click(screen.getByRole('link', { name: 'Play Sudoku' }))
  await screen.findByRole('heading', { name: 'Character Sudoku' })
  expect(within(navigation).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page')
  await user.click(within(navigation).getByRole('link', { name: 'Practice' }))
  await screen.findByRole('heading', { name: 'A little practice. A little closer.' })
  expect(screen.queryByRole('link', { name: 'Play Mahjong' })).not.toBeInTheDocument()
})

it('keeps old Mahjong bookmarks usable while highlighting Games', async () => {
  window.location.hash = '#practice/mahjong'
  render(<App />)
  await screen.findByRole('heading', { name: 'Word Mahjong' })
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
  expect(within(navigation).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page')
  expect(within(navigation).getByRole('link', { name: 'Practice' })).not.toHaveAttribute('aria-current')
  await act(async () => { window.location.hash = '#games/mahjong' })
  await screen.findByRole('heading', { name: 'Word Mahjong' })
})
