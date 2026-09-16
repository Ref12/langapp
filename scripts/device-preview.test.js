// @vitest-environment node
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const liveHtml = readFileSync(new URL('../public/dev/index.html', import.meta.url), 'utf8')
const liveScript = readFileSync(new URL('../public/dev/preview.js', import.meta.url), 'utf8')
const mockupHtml = readFileSync(new URL('../docs/mockups/index.html', import.meta.url), 'utf8')
const mockupScript = readFileSync(new URL('../docs/mockups/preview.js', import.meta.url), 'utf8')
const controls = readFileSync(new URL('../docs/mockups/device-preview.js', import.meta.url), 'utf8')
let dom
let resize

function openPreview(url, live = true) {
  dom = new JSDOM(live ? liveHtml : mockupHtml, { url, runScripts: 'outside-only' })
  dom.window.ResizeObserver = class {
    constructor(callback) { resize = callback }
    observe() {}
  }
  dom.window.eval(controls)
  dom.window.eval(live ? liveScript : mockupScript)
  const frame = dom.window.document.querySelector('iframe')
  Object.defineProperties(frame, {
    clientWidth: { value: 1280, configurable: true },
    clientHeight: { value: 800, configurable: true },
  })
  return frame
}

afterEach(() => dom?.window.close())

describe('live app device preview', () => {
  it.each(['/', '/langapp/'])('opens the real app and preserves deep links under %s', (base) => {
    const frame = openPreview(`https://example.test${base}dev/#lesson/zh-level-01:first-exchanges:part-1`)
    expect(frame.src).toBe(`https://example.test${base}index.html#lesson/zh-level-01:first-exchanges:part-1`)
    expect(dom.window.document.querySelector('#open-app').href).toBe(frame.src)
    expect(frame.title).toBe('Live Mandarin learning app')
    expect(dom.window.document.querySelector('.preview-title').textContent).toContain('App preview')
    expect(frame.src).not.toContain('app.html')
  })

  it('switches viewports without replacing the app window, route, or unsaved content', () => {
    const frame = openPreview('https://example.test/dev/#settings')
    const document = dom.window.document
    const child = frame.contentWindow
    child.document.write('<!doctype html><html><head><title>Settings</title></head><body><input value="Unsaved name"></body></html>')
    const source = frame.src
    document.querySelector('button[data-device="mobile"]').click()
    expect(document.querySelector('#preview-stage').dataset.device).toBe('mobile')
    expect(document.querySelector('button[data-device="mobile"]').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('button[data-device="desktop"]').getAttribute('aria-pressed')).toBe('false')
    Object.defineProperties(frame, { clientWidth: { value: 390 }, clientHeight: { value: 844 } })
    resize()
    expect(document.querySelector('#viewport-size').textContent).toBe('390 \u00d7 844')
    document.querySelector('button[data-device="desktop"]').click()
    expect(document.querySelector('#preview-stage').dataset.device).toBe('desktop')
    expect(document.querySelector('button[data-device="desktop"]').getAttribute('aria-pressed')).toBe('true')
    expect(frame.contentWindow).toBe(child)
    expect(frame.src).toBe(source)
    expect(child.document.querySelector('input').value).toBe('Unsaved name')
  })

  it('follows app navigation and appearance without reloading the frame', async () => {
    const frame = openPreview('https://example.test/langapp/dev/#lessons')
    const child = frame.contentWindow
    child.document.write('<!doctype html><html><head><title>Lessons</title></head><body></body></html>')
    frame.dispatchEvent(new dom.window.Event('load'))
    child.location.hash = '#dictionary'
    child.document.title = 'Dictionary / LinguaWeave'
    child.document.documentElement.dataset.theme = 'light'
    await vi.waitFor(() => {
      expect(dom.window.location.hash).toBe('#dictionary')
      expect(dom.window.document.querySelector('#open-app').href).toBe('https://example.test/langapp/index.html#dictionary')
      expect(dom.window.document.documentElement.dataset.theme).toBe('light')
      expect(dom.window.document.title).toBe('Dictionary / LinguaWeave / App preview')
    })
    expect(frame.contentWindow).toBe(child)
    dom.window.location.hash = '#settings'
    await vi.waitFor(() => expect(child.location.hash).toBe('#settings'))
    expect(frame.contentWindow).toBe(child)
  })

  it('leaves the original mockup preview and its message protocol intact', () => {
    const frame = openPreview('https://example.test/preview.html#lessons', false)
    const document = dom.window.document
    frame.dispatchEvent(new dom.window.Event('load'))
    expect(frame.src).toBe('https://example.test/app.html')
    expect(document.querySelector('#open-app').href).toBe('https://example.test/app.html#lessons')
    expect(document.title).toBe('Lessons / LinguaWeave UI concept')
    document.querySelector('button[data-device="mobile"]').click()
    expect(document.querySelector('#preview-stage').dataset.device).toBe('mobile')
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: frame.contentWindow, origin: dom.window.location.origin, data: { type: 'mockup-theme', theme: 'light' },
    }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(frame.src).toBe('https://example.test/app.html')
  })
})
