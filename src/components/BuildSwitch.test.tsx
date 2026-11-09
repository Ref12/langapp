import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BuildSwitch, LabMark } from './BuildSwitch'

const phone = () => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); window.dispatchEvent(new Event('resize')) }
beforeEach(() => phone())
afterEach(() => { vi.unstubAllGlobals() })

const setup = (channel: 'stable' | 'lab', extra = vi.fn()) => {
  vi.stubGlobal('__BUILD_CHANNEL__', channel)
  render(<div style={{ width: 390 }}><LabMark /><BuildSwitch settingsHref="#settings" extraItems={[{ label: 'Copy profile from Stable…', onSelect: extra }]}>Reader workspace</BuildSwitch></div>)
  return extra
}

describe('build switch', () => {
  it('opens a menu with Stable and Lab, the current one ticked, and links to the other build (Lab)', async () => {
    const user = userEvent.setup()
    const extra = setup('lab')
    const button = screen.getByRole('button', { name: /Reader workspace/ })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(button)
    const menu = screen.getByRole('menu')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const lab = within(menu).getByRole('menuitemradio', { name: /Lab/ })
    expect(lab).toHaveAttribute('aria-checked', 'true')
    expect(lab).not.toHaveAttribute('href')
    const stable = within(menu).getByRole('menuitemradio', { name: 'Stable' })
    expect(stable).toHaveAttribute('aria-checked', 'false')
    expect(stable).toHaveAttribute('href', '../')
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy profile from Stable…' }))
    expect(extra).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('links to ./lab/ from Stable, shows no mark and no Lab-only item', async () => {
    const user = userEvent.setup()
    setup('stable')
    expect(screen.queryByRole('img', { name: /Lab build/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Stable/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Lab' })).toHaveAttribute('href', './lab/')
    expect(within(menu).queryByRole('menuitem', { name: /Copy profile/ })).toBeNull()
  })

  it('marks Lab so it cannot be taken for Stable', () => {
    setup('lab')
    expect(screen.getByRole('img', { name: /Lab build/ })).toHaveTextContent('Lab')
  })

  it('has its own gear to Settings, and works from the keyboard', async () => {
    const user = userEvent.setup()
    setup('lab')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#settings')
    screen.getByRole('button', { name: /Reader workspace/ }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menuitemradio', { name: /Lab/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /Copy profile/ })).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('menuitemradio', { name: 'Stable' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: /Reader workspace/ })).toHaveFocus()
  })

  it('has no gear of its own unless asked (the top bar already shows one)', () => {
    vi.stubGlobal('__BUILD_CHANNEL__', 'lab')
    render(<BuildSwitch variant="pill">default</BuildSwitch>)
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })
})
