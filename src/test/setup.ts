import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Without vitest globals, Testing Library does not unmount after each test; mounted live queries then fire after jsdom teardown ("window is not defined").
afterEach(() => { cleanup() })
// CI runs the whole suite in parallel and is slow; the 1 s default for findBy/waitFor made page tests fail at random.
configure({ asyncUtilTimeout: 5000 })

if (typeof window !== 'undefined') window.scrollTo = vi.fn()

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  // jsdom does not implement native modal dialogs.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } },
    close: { configurable: true, value(this: HTMLDialogElement) {
      if (!this.open) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    } },
  })
}
