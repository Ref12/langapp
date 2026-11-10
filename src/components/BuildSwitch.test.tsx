import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BuildSwitch, LabMark } from './BuildSwitch'

const phone = () => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }); window.dispatchEvent(new Event('resize')) }
beforeEach(() => phone())
afterEach(() => { vi.unstubAllGlobals() })

const apps = (current: 'zh' | 'ja') => [
  { label: 'Chinese', glyph: '中', lang: 'zh', href: current === 'zh' ? './' : '../', current: current === 'zh' },
  { label: 'Japanese', glyph: '日', lang: 'ja', href: current === 'ja' ? './' : './ja/', current: current === 'ja' },
]
const setup = (channel: 'stable' | 'lab', extra = vi.fn(), language: 'zh' | 'ja' = 'zh') => {
  vi.stubGlobal('__BUILD_CHANNEL__', channel)
  vi.stubGlobal('__BUILD_LANGUAGE__', language)
  render(<div style={{ width: 390 }}><LabMark /><BuildSwitch settingsHref="#settings" apps={apps(language)} extraItems={[{ label: 'Copy profile from Stable…', onSelect: extra }]}>Reader workspace</BuildSwitch></div>)
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
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /Copy profile/ })).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('menuitemradio', { name: 'Stable' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: /Reader workspace/ })).toHaveFocus()
  })

  it('lists the language apps in the Chinese Lab build: Chinese ticked, Japanese a link to ./ja/', async () => {
    const user = userEvent.setup()
    setup('lab')
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    const zh = within(menu).getByRole('menuitemradio', { name: /Chinese/ })
    expect(zh).toHaveAttribute('aria-checked', 'true')
    expect(zh).toHaveTextContent('this app')
    expect(within(menu).getByRole('menuitemradio', { name: /Japanese/ })).toHaveAttribute('href', './ja/')
    expect(within(menu).getByRole('menuitemradio', { name: 'Stable' })).toHaveAttribute('href', '../')
  })

  it('lists them in the Japanese build: Japanese ticked, Chinese at ../; Stable and Lab links are right from lab/ja/', async () => {
    const user = userEvent.setup()
    setup('lab', vi.fn(), 'ja')
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Japanese/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: /Chinese/ })).toHaveAttribute('href', '../')
    expect(within(menu).getByRole('menuitemradio', { name: 'Stable' })).toHaveAttribute('href', '../../')
    const lab = within(menu).getByRole('menuitemradio', { name: /Lab/ })
    expect(lab).toHaveAttribute('aria-checked', 'true')
    expect(lab).toHaveAttribute('href', '../')
  })

  it('shows no language group in a Stable build', async () => {
    const user = userEvent.setup()
    setup('stable')
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).queryByRole('menuitemradio', { name: /Chinese|Japanese/ })).toBeNull()
    expect(within(menu).queryByText('Language')).toBeNull()
  })

  it('reaches the language apps from the keyboard', async () => {
    const user = userEvent.setup()
    setup('lab')
    screen.getByRole('button', { name: /Reader workspace/ }).focus()
    await user.keyboard('{Enter}{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /Chinese/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: /Japanese/ })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: /Copy profile/ })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitemradio', { name: 'Stable' })).toHaveFocus()
  })
})
