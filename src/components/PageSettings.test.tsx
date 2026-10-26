import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { resetProfileStorage } from '../test/profile-storage'

const worker = vi.hoisted(() => ({ generateSudokuInWorker: vi.fn() }))
vi.mock('../core/games/sudoku-client', () => worker)

beforeEach(async () => {
  window.location.hash = ''
  await resetProfileStorage()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}
const gear = () => screen.findByRole('button', { name: 'Workspace settings' })

describe('page settings sheet', () => {
  it('shows Quick settings and All settings on a page without settings, and All settings goes to #settings', async () => {
    window.location.hash = '#lessons'
    const user = userEvent.setup()
    render(<App />)
    await user.click(await gear())
    const sheet = await screen.findByRole('dialog', { name: 'Page settings' })
    expect(within(sheet).getByText('Quick settings')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Dark theme')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Default speech rate')).toBeInTheDocument()
    expect(within(sheet).getByText(/Vibration feedback/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('link', { name: 'All settings' }))
    expect(window.location.hash).toBe('#settings')
  })

  it('closes on Escape and on route change', async () => {
    window.location.hash = '#lessons'
    const user = userEvent.setup()
    render(<App />)
    await user.click(await gear())
    await screen.findByRole('dialog', { name: 'Page settings' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull()
    await user.click(await gear())
    await screen.findByRole('dialog', { name: 'Page settings' })
    await go('#practice')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull())
  })

  it('closes on backdrop tap', async () => {
    window.location.hash = '#lessons'
    const user = userEvent.setup()
    render(<App />)
    await user.click(await gear())
    await user.click(await screen.findByTestId('page-settings-backdrop'))
    expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull()
  })

  it('lists Sudoku settings and saves toggles', async () => {
    window.location.hash = '#games/sudoku'
    const user = userEvent.setup()
    render(<App />)
    await user.click(await gear())
    const sheet = await screen.findByRole('dialog', { name: 'Page settings' })
    expect(within(sheet).getByRole('heading', { name: 'Sudoku settings' })).toBeInTheDocument()
    await user.click(within(sheet).getByLabelText('Show pinyin on selection'))
    await waitFor(async () => expect((await db.preferences.get('workspace'))!.sudokuShowPinyin).toBe(true))
    await user.click(within(sheet).getByLabelText('Speak characters automatically'))
    await waitFor(async () => expect((await db.preferences.get('workspace'))!.sudokuAutoSpeak).toBe(false))
  })

  it('is a plain link on the Settings page', async () => {
    window.location.hash = '#settings'
    render(<App />)
    const link = await screen.findByRole('link', { name: 'Workspace settings' })
    expect(link).toHaveAttribute('aria-current', 'page')
  })
})
