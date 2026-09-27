import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

it('opens mobile mode and switches the same iframe without navigating or reloading the game', async () => {
  const html = readFileSync(new NodeURL('./preview.html', import.meta.url), 'utf8')
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
  const frame = document.querySelector<HTMLIFrameElement>('#prototype-frame')!
  const stage = document.querySelector<HTMLElement>('#preview-stage')!
  const mobile = document.querySelector<HTMLButtonElement>('button[data-device="mobile"]')!
  const desktop = document.querySelector<HTMLButtonElement>('button[data-device="desktop"]')!
  Object.defineProperties(frame, {
    clientWidth: { get: () => stage.dataset.device === 'mobile' ? 390 : 1000 },
    clientHeight: { get: () => 600 },
  })
  class Observer implements ResizeObserver {
    static current: Observer
    constructor(private callback: ResizeObserverCallback) { Observer.current = this }
    observe() { this.refresh() }
    unobserve() {}
    disconnect() {}
    refresh() { this.callback([], this) }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('location', new URL('http://localhost/prototypes/defender/preview.html?device=mobile'))
  const source = frame.getAttribute('src')
  const content = frame.contentWindow
  await import('./preview')
  expect(stage).toHaveAttribute('data-device', 'mobile')
  expect(mobile).toHaveAttribute('aria-pressed', 'true')
  expect(desktop).toHaveAttribute('aria-pressed', 'false')
  Observer.current.refresh()
  expect(document.querySelector('#viewport-size')).toHaveTextContent('390 × 600')
  desktop.click()
  Observer.current.refresh()
  expect(stage).toHaveAttribute('data-device', 'desktop')
  expect(desktop).toHaveAttribute('aria-pressed', 'true')
  expect(mobile).toHaveAttribute('aria-pressed', 'false')
  expect(document.querySelector('#viewport-size')).toHaveTextContent('1000 × 600')
  mobile.click()
  expect(frame.getAttribute('src')).toBe(source)
  expect(frame.contentWindow).toBe(content)
})
