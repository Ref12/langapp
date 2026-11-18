import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BuildSwitch } from './BuildSwitch'
import { stableHref } from '../core/language/apps'

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
  render(<div style={{ width: 390 }}><BuildSwitch oldVersionHref={stableHref(language)} settingsHref="#settings" apps={apps(language)} extraItems={[{ label: 'Copy profile from Stable…', onSelect: extra }]}>Reader workspace</BuildSwitch></div>)
  return extra
}

describe('build switch', () => {
  it('in the main app opens a menu with one quiet "Old version (Stable)" item instead of a Stable / Lab list', async () => {
    const user = userEvent.setup()
    const extra = setup('lab')
    const button = screen.getByRole('button', { name: /Reader workspace/ })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(button)
    const menu = screen.getByRole('menu')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).queryByRole('menuitemradio', { name: /Lab/ })).toBeNull()
    expect(within(menu).queryByRole('menuitemradio', { name: 'Stable' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Old version (Stable)' })).toHaveAttribute('href', './stable/')
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy profile from Stable…' }))
    expect(extra).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('has no Lab mark and no "Lab build: experimental" text', () => {
    setup('lab')
    expect(screen.queryByRole('img', { name: /Lab build/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/experimental/)
  })

  it('in Stable (at stable/) the menu ticks Stable and links the main app one level up, with no language group', async () => {
    const user = userEvent.setup()
    setup('stable')
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Stable/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Main app' })).toHaveAttribute('href', '../')
    expect(within(menu).queryByRole('menuitem', { name: /Old version|Copy profile/ })).toBeNull()
    expect(within(menu).queryByRole('menuitemradio', { name: /Chinese|Japanese/ })).toBeNull()
    expect(within(menu).queryByText('Language')).toBeNull()
  })

  it('has its own gear to Settings, and works from the keyboard', async () => {
    const user = userEvent.setup()
    setup('lab')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#settings')
    screen.getByRole('button', { name: /Reader workspace/ }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menuitemradio', { name: /Chinese/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Old version (Stable)' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /Copy profile/ })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: /Copy profile/ })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitemradio', { name: /Chinese/ })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: /Reader workspace/ })).toHaveFocus()
  })

  it('lists the language apps in the Chinese build: Chinese ticked, Japanese a link to ./ja/', async () => {
    const user = userEvent.setup()
    setup('lab')
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    const zh = within(menu).getByRole('menuitemradio', { name: /Chinese/ })
    expect(zh).toHaveAttribute('aria-checked', 'true')
    expect(zh).toHaveTextContent('this app')
    expect(within(menu).getByRole('menuitemradio', { name: /Japanese/ })).toHaveAttribute('href', './ja/')
  })

  it('in the Japanese build (at ja/) the links are right: Chinese at ../, Stable at ../stable/', async () => {
    const user = userEvent.setup()
    setup('lab', vi.fn(), 'ja')
    await user.click(screen.getByRole('button', { name: /Reader workspace/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Japanese/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: /Chinese/ })).toHaveAttribute('href', '../')
    expect(within(menu).getByRole('menuitem', { name: 'Old version (Stable)' })).toHaveAttribute('href', '../stable/')
  })
})
