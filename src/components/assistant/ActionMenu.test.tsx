import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ActionMenu } from './ActionMenu'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('exposes only its trigger when closed, focuses actions, dismisses with Escape and outside clicks', async () => {
  const user = userEvent.setup()
  render(<><ActionMenu label="Phrase actions" trigger="...">{close => <button onClick={() => close()}>Practice</button>}</ActionMenu>
    <button>Elsewhere</button></>)
  const trigger = screen.getByRole('button', { name: 'Phrase actions' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: 'Practice' })).not.toBeInTheDocument()
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Practice' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('keeps the popup inside the viewport near a bottom-right trigger', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('action-menu-trigger')
      ? new DOMRect(window.innerWidth - 48, window.innerHeight - 48, 44, 44)
      : new DOMRect(0, 0, 200, 160)
  })
  render(<ActionMenu label="Phrase actions" trigger="...">{() => <button>Practice</button>}</ActionMenu>)
  fireEvent.click(screen.getByRole('button', { name: 'Phrase actions' }))
  const popup = screen.getByRole('dialog', { name: 'Phrase actions' })
  expect(parseFloat(popup.style.top)).toBe(window.innerHeight - 48 - 160 - 4)
  expect(parseFloat(popup.style.left) + 200).toBeLessThanOrEqual(window.innerWidth - 8)
})
