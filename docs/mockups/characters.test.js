// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('./characters.js', import.meta.url), 'utf8')
let dom, document, resize

function evaluate(code) {
  return runInContext(code, dom.getInternalVMContext())
}

function draft() {
  return evaluate('characterDrafts.get(characterId)')
}

function beginStroke(valid = false) {
  evaluate(`
    characterPointer = 1
    characterStroke = characterStrokeGuides[characterId][activeCharacterStrokes().length].points.map((point) => [...point])
    ${valid ? '' : 'characterStroke.reverse()'}
  `)
}

function submitStroke(valid = false) {
  beginStroke(valid)
  evaluate('finishCharacterStroke(true)')
}

function outlines() {
  return [...document.querySelectorAll('#character-stroke-outlines path')]
}

function hint() {
  return evaluate('hasCharacterMemoryHint()')
}

function button(id) {
  return document.getElementById(`character-${id}`)
}

beforeEach(() => {
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://mockup.test/#characters' })
  document = dom.window.document
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({})
  dom.window.HTMLCanvasElement.prototype.hasPointerCapture = () => false
  dom.window.HTMLDialogElement.prototype.close = () => {}
  dom.window.ResizeObserver = class {
    constructor(callback) { resize = callback }
    observe() {}
  }
  dom.window.requestAnimationFrame = () => 0
  evaluate(`
    const one = (selector) => document.querySelector(selector)
    const all = (selector) => [...document.querySelectorAll(selector)]
    const characterMonolineRecipes = {}
    const snippetAttachments = new WeakMap()
    function wordSnippetOptions() { return {} }
    function createSnippetActions() {
      const group = document.createElement('div')
      for (const action of ['hear', 'ask']) {
        const button = document.createElement('button')
        button.dataset.snippetAction = action
        group.append(button)
      }
      return group
    }
    ${script}
    for (const [id, native, gloss] of [['tea', '\\u8336', 'tea'], ['rain', '\\u96e8', 'rain']]) {
      characterEntries.set(id, { native, gloss })
      characterStrokeGuides[id] = [
        { path: 'M 20 20 L 60 20', points: [[20, 20], [60, 20]], length: 40 },
        { path: 'M 30 30 L 30 70', points: [[30, 30], [30, 70]], length: 40 },
        { path: 'M 50 50 L 54 54', points: [[50, 50], [54, 54]], length: Math.sqrt(32) },
      ]
      characterDrafts.set(id, { ...createCharacterDraft(), phase: 2 })
    }
    selectPracticeCharacter('tea')
  `)
})

afterEach(() => {
  dom.window.close()
})

describe('memory stroke hints', () => {
  it('reveals only the current guide and direction after the second committed miss', () => {
    expect(button('guide-layer').hasAttribute('hidden')).toBe(true)
    submitStroke()
    expect(draft().memoryMisses).toEqual([1])
    expect(hint()).toBe(false)
    expect(outlines()).toHaveLength(0)
    expect(button('guide-layer').hasAttribute('hidden')).toBe(true)
    submitStroke()
    expect(hint()).toBe(true)
    expect(outlines()).toHaveLength(1)
    expect(outlines()[0].getAttribute('d')).toBe('M 20 20 L 60 20')
    expect(button('guide-layer').hasAttribute('hidden')).toBe(false)
    expect(document.querySelectorAll('.character-direction-path, .character-start-dot')).toHaveLength(2)
    expect(button('step').textContent).toBe('Hint after two misses')
    expect(button('status').textContent).toContain('Guide added after two misses')
    expect(button('native').textContent).toBe('tea')
    expect(button('progress').hidden).toBe(true)
    expect(button('next-phase').disabled).toBe(true)
    expect(draft().strokes[2]).toHaveLength(0)
  })

  it('keeps a revealed guide through further misses and hides the following stroke after success', () => {
    submitStroke()
    submitStroke()
    submitStroke()
    expect(hint()).toBe(true)
    expect(outlines()).toHaveLength(1)
    submitStroke(true)
    expect(hint()).toBe(false)
    expect(outlines()).toHaveLength(1)
    expect(outlines()[0].classList.contains('completed')).toBe(true)
    expect(button('stroke-direction').children).toHaveLength(0)
    expect(draft().memoryMisses[0]).toBe(3)
    submitStroke()
    expect(hint()).toBe(false)
    submitStroke()
    expect(hint()).toBe(true)
    expect(outlines()).toHaveLength(2)
    expect(outlines()[1].getAttribute('d')).toBe('M 30 30 L 30 70')
  })

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'resize', 'route'])('does not count %s as a miss', (type) => {
    beginStroke()
    if (type === 'blur') dom.window.dispatchEvent(new dom.window.Event('blur'))
    else if (type === 'resize') resize()
    else if (type === 'route') document.dispatchEvent(new dom.window.CustomEvent('mockup-route-changed', { detail: 'dictionary' }))
    else {
      const event = new dom.window.Event(type)
      Object.defineProperty(event, 'pointerId', { value: 1 })
      button('canvas').dispatchEvent(event)
    }
    expect(evaluate('characterPointer')).toBeNull()
    expect(draft().memoryMisses).toEqual([])
    submitStroke()
    expect(hint()).toBe(false)
    expect(draft().memoryMisses).toEqual([1])
  })

  it('does not count duplicate completion or cancellation without an active pointer', () => {
    submitStroke()
    evaluate('finishCharacterStroke(true); finishCharacterStroke()')
    expect(draft().memoryMisses).toEqual([1])
    expect(hint()).toBe(false)
  })

  it('preserves per-character misses and hints through navigation, appearance changes, and resizing', () => {
    submitStroke()
    evaluate("selectPracticeCharacter('rain')")
    expect(draft().memoryMisses).toEqual([])
    expect(hint()).toBe(false)
    evaluate("selectPracticeCharacter('tea')")
    expect(draft().memoryMisses).toEqual([1])
    submitStroke()
    evaluate("selectPracticeCharacter('rain'); selectPracticeCharacter('tea')")
    document.dispatchEvent(new dom.window.Event('mockup-theme-changed'))
    resize()
    expect(hint()).toBe(true)
    expect(outlines()).toHaveLength(1)
    expect(button('status').textContent).toContain('Trace the revealed stroke')
  })

  it('restores a revisited stroke hint on Undo without assisting an untouched stroke', () => {
    submitStroke()
    submitStroke()
    submitStroke(true)
    expect(hint()).toBe(false)
    button('undo').click()
    expect(hint()).toBe(true)
    expect(outlines()).toHaveLength(1)
    expect(outlines()[0].classList.contains('completed')).toBe(false)
    submitStroke(true)
    expect(hint()).toBe(false)
  })

  it.each([false, true])('clears misses and hints, including with accepted strokes = %s', (accepted) => {
    if (accepted) submitStroke(true)
    submitStroke()
    submitStroke()
    expect(button('clear').disabled).toBe(false)
    button('clear').click()
    expect(draft().strokes[2]).toHaveLength(0)
    expect(draft().memoryMisses).toEqual([])
    expect(outlines()).toHaveLength(0)
    expect(hint()).toBe(false)
    expect(button('clear').disabled).toBe(true)
    submitStroke()
    expect(hint()).toBe(false)
  })

  it('starts each repetition without inherited misses', () => {
    submitStroke()
    submitStroke()
    for (let index = 0; index < 3; index++) submitStroke(true)
    button('next-phase').click()
    expect(draft().attempt).toBe(1)
    expect(draft().phase).toBe(2)
    expect(draft().memoryMisses).toEqual([])
    expect(outlines()).toHaveLength(0)
    submitStroke()
    expect(hint()).toBe(false)
  })

  it('uses size-aware cues for short hints and retains assistance on finish until restarting', () => {
    draft().attempt = 2
    submitStroke(true)
    submitStroke(true)
    submitStroke()
    submitStroke()
    expect(hint()).toBe(true)
    expect(Number(document.querySelector('.character-start-dot').getAttribute('r'))).toBeLessThan(5.2)
    expect(document.querySelector('.character-start-number')).toBeNull()
    submitStroke(true)
    expect(hint()).toBe(false)
    expect(button('stroke-direction').children).toHaveLength(0)
    button('next-phase').click()
    expect(draft().finished).toBe(true)
    button('undo').click()
    expect(hint()).toBe(true)
    submitStroke(true)
    button('next-phase').click()
    button('next-phase').click()
    expect(draft().phase).toBe(0)
    expect(draft().attempt).toBe(0)
    expect(draft().memoryMisses).toEqual([])
    expect(draft().finished).toBe(false)
  })

  it.each([0, 1])('does not change the existing guides or count misses in phase %s', (phase) => {
    draft().phase = phase
    evaluate('updateCharacterControls()')
    const before = outlines().map((path) => path.getAttribute('d'))
    expect(before).toHaveLength(phase === 0 ? 3 : 1)
    submitStroke()
    submitStroke()
    expect(draft().memoryMisses).toEqual([])
    expect(hint()).toBe(false)
    expect(outlines().map((path) => path.getAttribute('d'))).toEqual(before)
  })

  it('enters memory practice without exposing a first-stroke guide', () => {
    draft().phase = 1
    draft().attempt = 2
    for (let index = 0; index < 3; index++) submitStroke(true)
    button('next-phase').click()
    expect(draft().phase).toBe(2)
    expect(draft().attempt).toBe(0)
    expect(hint()).toBe(false)
    expect(outlines()).toHaveLength(0)
    expect(button('native').textContent).toBe('tea')
  })
})
