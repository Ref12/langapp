import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PageActionsMenu, PageActionsProvider } from './PageActionsMenu'
import { usePageActions } from './page-actions-context'

afterEach(cleanup)

it('renders an item description under its label', async () => {
  function Described() { usePageActions([{ id: 'x', label: 'Skip for now', description: 'It stays Not yet.', onSelect: () => undefined }]); return null }
  render(<PageActionsProvider><PageActionsMenu /><Described /></PageActionsProvider>)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Page actions' }))
  expect(screen.getByRole('menuitem', { name: /Skip for now/ })).toHaveTextContent('It stays Not yet.')
})

function Page({ onPlain, onToggle, checked }: { onPlain: () => void; onToggle: () => void; checked: boolean }) {
  usePageActions([{ id: 'a', label: 'Import', onSelect: onPlain }, { id: 'b', label: 'List view', checked, onSelect: onToggle }])
  return <p>page</p>
}

it('is absent without registered actions', () => {
  render(<PageActionsProvider><PageActionsMenu /><p>page</p></PageActionsProvider>)
  expect(screen.queryByRole('button', { name: 'Page actions' })).toBeNull()
})

it('lists plain and checkable items, runs one and closes on select, Escape and outside tap; vanishes on unmount', async () => {
  const user = userEvent.setup()
  const plain = vi.fn(), toggle = vi.fn()
  void plain
  const view = render(<PageActionsProvider><PageActionsMenu /><button>Elsewhere</button><Page onPlain={plain} onToggle={toggle} checked /></PageActionsProvider>)
  const trigger = screen.getByRole('button', { name: 'Page actions' })
  await user.click(trigger)
  expect(screen.getByRole('menuitem', { name: 'Import' })).toBeInTheDocument()
  expect(screen.getByRole('menuitemcheckbox', { name: 'List view' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'List view' }))
  expect(toggle).toHaveBeenCalledOnce()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  await user.keyboard('{Escape}')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  view.rerender(<PageActionsProvider><PageActionsMenu /></PageActionsProvider>)
  expect(screen.queryByRole('button', { name: 'Page actions' })).toBeNull()
})
