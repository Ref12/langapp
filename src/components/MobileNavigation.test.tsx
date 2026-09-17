import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileNavigation } from './MobileNavigation'
import App from '../App'
import { db } from '../core/database'
import { curriculumLessons } from '../data/curriculum'

let desktop: MediaQueryList

beforeEach(() => {
  desktop = Object.assign(new EventTarget(), { matches: false, media: '(min-width: 761px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn() })
  vi.stubGlobal('matchMedia', vi.fn(() => desktop))
  // jsdom does not implement the native modal dialog lifecycle.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } },
    close: { configurable: true, value(this: HTMLDialogElement) {
      if (!this.open) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    } },
  })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function navigation(route = 'practice') {
  return <MobileNavigation route={route}><nav><a href="#practice">Practice</a><a href="#settings">Settings</a></nav></MobileNavigation>
}

it('opens and closes with stacked-line menu buttons and restores body scrolling', async () => {
  const user = userEvent.setup()
  render(navigation())
  const trigger = screen.getByRole('button', { name: 'Open navigation' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(trigger.querySelector('.lucide-menu')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Workspace navigation' })).toBeInTheDocument()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(document.body.style.overflow).toBe('hidden')
  const close = screen.getByRole('button', { name: 'Close navigation' })
  expect(close.querySelector('.lucide-menu')).toBeInTheDocument()
  await user.click(close)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(document.body.style.overflow).toBe('')
})

it('closes the mobile menu without leaving the current lesson page and preserves desktop branding', async () => {
  await db.delete()
  await db.open()
  const user = userEvent.setup()
  const lesson = curriculumLessons[0]
  const route = `#lesson/${lesson.id}/2`
  window.location.hash = route
  render(<App />)
  await screen.findByRole('heading', { name: lesson.title })
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  const drawer = screen.getByRole('dialog', { name: 'Workspace navigation' })
  expect(within(drawer).queryByRole('link', { name: 'LinguaWeave home' })).not.toBeInTheDocument()
  await user.click(within(drawer).getByRole('button', { name: 'Close navigation' }))
  expect(window.location.hash).toBe(route)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: lesson.title })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'LinguaWeave home' })).toHaveAttribute('href', '#overview')
})

it('closes for navigation including the current route and external route changes', async () => {
  const user = userEvent.setup()
  const view = render(navigation())
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Practice' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  view.rerender(navigation('settings'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.body.style.overflow).toBe('')
})

it('closes on outside taps and desktop resize, but not inside the drawer', async () => {
  const user = userEvent.setup()
  render(navigation())
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  const dialog = screen.getByRole('dialog')
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 700 }))
  fireEvent.click(dialog, { clientX: 100, clientY: 500 })
  expect(dialog).toHaveAttribute('open')
  fireEvent.click(dialog, { clientX: 350, clientY: 500 })
  expect(dialog).not.toHaveAttribute('open')
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  act(() => { Object.assign(desktop, { matches: true }); desktop.dispatchEvent(new Event('change')) })
  expect(dialog).not.toHaveAttribute('open')
  expect(document.body.style.overflow).toBe('')
})

it('restores the previous scroll style when unmounted while open', async () => {
  document.body.style.overflow = 'auto'
  const user = userEvent.setup()
  const view = render(navigation())
  await user.click(screen.getByRole('button', { name: 'Open navigation' }))
  view.unmount()
  expect(document.body.style.overflow).toBe('auto')
  document.body.style.overflow = ''
})
