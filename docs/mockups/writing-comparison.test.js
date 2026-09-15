// @vitest-environment node
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync(new URL('./writing-comparison.html', import.meta.url), 'utf8')
const scripts = ['character-data.js', 'character-geometry.js', 'character-monoline.js', 'animcjk-tea.js', 'writing-comparison.js']
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n')
let dom, document

function change(id, value, event = 'change') {
  const control = document.getElementById(id)
  if (control.type === 'checkbox') control.checked = value
  else control.value = value
  control.dispatchEvent(new dom.window.Event(event, { bubbles: true }))
}

function visibleStrokes(id) {
  return document.querySelectorAll(`#${id} .glyph-stroke:not(.future)`).length
}

beforeEach(() => {
  vi.useFakeTimers()
  dom = new JSDOM(html, { runScripts: 'outside-only' })
  document = dom.window.document
  dom.window.setInterval = setInterval
  dom.window.clearInterval = clearInterval
  dom.window.eval(scripts)
})

afterEach(() => {
  dom.window.close()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('writing artwork comparison', () => {
  it('starts with A, E and D for tea, preserving the earlier B and C references', () => {
    for (const id of ['glyph-hanzi', 'glyph-transformed', 'glyph-custom', 'glyph-animcjk', 'glyph-current']) {
      expect(visibleStrokes(id)).toBe(9)
    }
    expect(document.querySelector('#glyph-transformed .source-overlay').children).toHaveLength(9)
    expect(document.querySelector('.other-references').open).toBe(false)
    expect(document.title).toBe('Tea / Monoline writing study')
  })

  it.each([['\u96e8', 8], ['\u676f', 8], ['\u4eba', 2], ['\u4e00', 1]])('switches all available renderers to %s', (native, count) => {
    change('comparison-character', native)
    for (const id of ['glyph-hanzi', 'glyph-transformed', 'glyph-current']) {
      expect(visibleStrokes(id)).toBe(count)
    }
    for (const id of ['custom-card', 'animcjk-card']) expect(document.getElementById(id).hidden).toBe(true)
    expect(document.querySelectorAll('#glyph-custom path, #glyph-animcjk path')).toHaveLength(0)
    expect(document.getElementById('comparison-count').value).toBe(`${count} / ${count}`)
    change('comparison-character', '\u8336')
    expect(visibleStrokes('glyph-custom')).toBe(9)
    expect(document.getElementById('custom-card').hidden).toBe(false)
    expect(document.getElementById('animcjk-card').hidden).toBe(false)
  })

  it('keeps the source overlay synchronized with stroke reveal and ghosting', () => {
    change('comparison-source', true)
    change('comparison-strokes', '3', 'input')
    expect(document.body.dataset.showSource).toBe('true')
    expect(visibleStrokes('glyph-transformed')).toBe(3)
    expect(document.querySelectorAll('.source-centerline:not(.future)')).toHaveLength(3)
    change('comparison-ghost', true)
    expect(document.body.dataset.showRemaining).toBe('true')
    change('comparison-strokes', '0', 'input')
    expect(visibleStrokes('glyph-transformed')).toBe(0)
    expect(document.querySelectorAll('.source-centerline:not(.future)')).toHaveLength(0)
  })

  it('resets an active replay when changing character and stops at the new stroke count', () => {
    document.getElementById('comparison-replay').click()
    vi.advanceTimersByTime(1300)
    expect(visibleStrokes('glyph-transformed')).toBe(2)
    change('comparison-character', '\u4e00')
    vi.advanceTimersByTime(10000)
    expect(visibleStrokes('glyph-transformed')).toBe(1)
    expect(document.getElementById('comparison-replay').textContent).toBe('Replay strokes')
    document.getElementById('comparison-replay').click()
    expect(visibleStrokes('glyph-transformed')).toBe(0)
    vi.advanceTimersByTime(650)
    expect(visibleStrokes('glyph-transformed')).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses replay and lets Show full reveal the selected character, not always nine strokes', () => {
    change('comparison-character', '\u4eba')
    document.getElementById('comparison-replay').click()
    vi.advanceTimersByTime(650)
    document.getElementById('comparison-replay').click()
    vi.advanceTimersByTime(1300)
    expect(visibleStrokes('glyph-transformed')).toBe(1)
    document.getElementById('comparison-full').click()
    expect(visibleStrokes('glyph-transformed')).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('adjusts corrected cap allowance with width while preserving other artwork and reveal state', () => {
    const paths = [...document.querySelectorAll('.glyph:not(#glyph-transformed) .glyph-stroke')].map((path) => path.getAttribute('d'))
    const dot = document.querySelector('#glyph-transformed [data-terminal-rule="short-fall"]').getAttribute('d')
    change('comparison-strokes', '4', 'input')
    change('comparison-width', '4.25', 'input')
    expect(document.documentElement.style.getPropertyValue('--study-pen-width')).toBe('4.25')
    expect(document.getElementById('comparison-width-value').value).toBe('4.25')
    document.getElementById('comparison-theme').click()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.getElementById('comparison-theme').getAttribute('aria-pressed')).toBe('true')
    expect(visibleStrokes('glyph-transformed')).toBe(4)
    expect([...document.querySelectorAll('.glyph:not(#glyph-transformed) .glyph-stroke')].map((path) => path.getAttribute('d'))).toEqual(paths)
    expect(document.querySelector('#glyph-transformed [data-terminal-rule="short-fall"]').getAttribute('d')).not.toBe(dot)
  })

  it('toggles terminal corrections without losing source medians, reveal progress, or replay', () => {
    const selector = '#glyph-transformed .glyph-stroke'
    const corrected = [...document.querySelectorAll(selector)].map((path) => path.getAttribute('d'))
    const medians = [...document.querySelectorAll('.source-centerline')].map((line) => line.getAttribute('points'))
    expect(document.querySelectorAll('[data-terminal-rule="compact-hook"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-terminal-rule="short-fall"]')).toHaveLength(1)
    change('comparison-source', true)
    document.getElementById('comparison-replay').click()
    vi.advanceTimersByTime(650)
    change('comparison-corrections', false)
    expect(document.querySelectorAll('[data-terminal-rule="compact-hook"], [data-terminal-rule="short-fall"]')).toHaveLength(0)
    expect(visibleStrokes('glyph-transformed')).toBe(1)
    const previous = [...document.querySelectorAll(selector)].map((path) => path.getAttribute('d'))
    expect(previous.filter((path, index) => path !== corrected[index])).toHaveLength(2)
    vi.advanceTimersByTime(650)
    expect(visibleStrokes('glyph-transformed')).toBe(2)
    change('comparison-corrections', true)
    expect([...document.querySelectorAll(selector)].map((path) => path.getAttribute('d'))).toEqual(corrected)
    expect([...document.querySelectorAll('.source-centerline')].map((line) => line.getAttribute('points'))).toEqual(medians)
    expect(document.body.dataset.showSource).toBe('true')
    change('comparison-character', '\u96e8')
    expect(document.querySelectorAll('[data-terminal-rule="short-fall"]')).toHaveLength(4)
    expect(document.querySelectorAll('[data-terminal-rule="compact-hook"]')).toHaveLength(0)
  })

  it('labels the bulk scan as raw-median candidates rather than approved glyph conversions', () => {
    const summary = document.getElementById('comparison-bulk-summary').textContent
    expect(summary).toContain('798 raw strokes in 110 characters')
    expect(summary).toContain('candidates')
    expect(summary).toContain('before reviewed entry cleanup')
  })
})
