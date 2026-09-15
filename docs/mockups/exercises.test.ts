import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const markup = readFileSync(resolve('docs', 'mockups', 'app.html'), 'utf8')
const script = readFileSync(resolve('docs', 'mockups', 'exercises.js'), 'utf8')
let page: Document
let navigation: { hash: string }
const play = vi.fn()
const stop = vi.fn()

function get<T extends Element = HTMLElement>(selector: string): T {
  const element = page.querySelector<T>(selector)
  if (!element) throw new Error(`Missing sample element: ${selector}`)
  return element
}
function click(selector: string) {
  const button = get<HTMLButtonElement>(selector)
  expect(button.disabled).toBeFalsy()
  button.click()
}
function clickText(text: string) {
  const button = [...page.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === text && !button.disabled)
  if (!button) throw new Error(`Missing enabled button: ${text}`)
  button.click()
}
function chooseTiles(texts: string[]) {
  texts.forEach(text => {
    const tile = [...page.querySelectorAll<HTMLButtonElement>('.activity-bank button')]
      .find(button => button.textContent === text && !button.disabled)
    if (!tile) throw new Error(`Missing available tile: ${text}`)
    tile.click()
  })
}
function start(id: string) { click(`[data-activity-id="${id}"]`) }
function navigate(hash: string) {
  navigation.hash = hash
  page.dispatchEvent(new Event('mockup-route-changed'))
}

beforeEach(() => {
  vi.clearAllMocks()
  page = document.implementation.createHTMLDocument('Exercise fixture')
  page.body.innerHTML = markup
  let hash = '#practice'
  navigation = {
    get hash() { return hash },
    set hash(value: string) { hash = value.startsWith('#') ? value : `#${value}` },
  }
  HTMLElement.prototype.scrollIntoView = vi.fn()
  const element = (tag: string, className: string, text?: string) => {
    const node = page.createElement(tag)
    node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const icon = (_name: string, label: string) => {
    const node = page.createElement('button')
    node.type = 'button'
    node.setAttribute('aria-label', label)
    node.dataset.tooltip = label
    const svg = page.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.append(page.createElementNS(svg.namespaceURI, 'use'))
    node.append(svg)
    return node
  }
  // Evaluate our classic-script mockup against an isolated document, not app state.
  new Function('document', 'location', 'snippetElement', 'snippetButton', 'playSnippet',
    'stopSnippetSpeech', 'scrollWorkspaceToTop', script)(
    page, navigation, element, icon, play, stop, vi.fn(),
  )
})

describe('inspiration exercise mockups', () => {
  it('provides all seven interactions and keeps the existing Review entry', () => {
    expect(page.querySelectorAll('[data-activity-id]')).toHaveLength(7)
    expect(get('#general-exercises a[href="#review"]')).toBeTruthy()
    click('[data-activity-start="lesson"]')
    expect(get('#activity-position').textContent).toBe('1 / 7')
    expect(get('#activity-mode').textContent).toContain('Lesson')
    expect(page.querySelectorAll('.activity-word ruby')).toHaveLength(1)
  })

  it('accepts interchangeable repeated tiles and leaves distractors available', () => {
    start('translate-tiles')
    expect(get<HTMLButtonElement>('#activity-submit').disabled).toBe(true)
    chooseTiles(['I', 'drink', 'tea', 'I', 'also', 'drink', 'water'])
    expect(page.querySelectorAll('.activity-answer button')).toHaveLength(7)
    expect(page.querySelectorAll('.activity-bank button:not(:disabled)')).toHaveLength(1)
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('correct')
    click('#activity-submit')
    expect(get('#activity-summary').textContent).toContain('Unaided correct')
  })

  it('returns exactly one repeated tile and can clear an editable answer', () => {
    start('translate-tiles')
    chooseTiles(['I', 'I'])
    click('[data-answer-index="0"]')
    const available = [...page.querySelectorAll<HTMLButtonElement>('.activity-bank button')]
      .filter(button => button.textContent === 'I' && !button.disabled)
    expect(available).toHaveLength(1)
    clickText('Clear answer')
    expect(page.querySelectorAll('.activity-answer button')).toHaveLength(0)
    expect(get<HTMLButtonElement>('#activity-submit').disabled).toBe(true)
  })

  it('offers a near-miss retry without overwriting the initial failed Check', () => {
    start('translate-tiles')
    chooseTiles(['I', 'drink', 'coffee', 'I', 'also', 'drink', 'water'])
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('retry')
    expect(page.querySelectorAll('.activity-answer .needs-review')).toHaveLength(1)
    click('#activity-retry')
    clickText('Clear answer')
    chooseTiles(['I', 'drink', 'tea', 'I', 'also', 'drink', 'water'])
    click('#activity-submit')
    expect(get('#activity-feedback').textContent).toContain('original Check remains failed')
    click('#activity-submit')
    expect(get('#activity-summary').textContent).toContain('Check failed')
    expect(get('#activity-summary').textContent).toContain('corrected with help')
  })

  it('records word help in a quiz and does not offer a scored retry', () => {
    click('[data-activity-start="quiz"]')
    expect(page.querySelectorAll('.activity-word ruby')).toHaveLength(0)
    click('.activity-word[aria-label="Word help: 也"]')
    expect(get('#activity-word-help').textContent).toContain('also; too')
    chooseTiles(['I', 'drink', 'tea', 'I', 'also', 'drink', 'water'])
    click('#activity-submit')
    expect(get('#activity-feedback').textContent).toContain('original Check remains failed')
    expect(get('#activity-retry').hidden).toBe(true)
  })

  it('keeps an audio-only source out of the DOM and requests concealed slow playback', () => {
    start('listening-tiles')
    expect(get('#activity-source').textContent).not.toContain('我也喝茶')
    clickText('Play slowly')
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ rate: 0.65, concealText: true }), expect.any(HTMLButtonElement))
    chooseTiles(['我', '也', '喝', '茶'])
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('correct')
    expect(get('#activity-source').textContent).toContain('我')
  })

  it('preserves a revealed transcript and answer across navigation', () => {
    start('listening-tiles')
    chooseTiles(['我'])
    clickText('Reveal transcript')
    navigate('#exercise')
    navigate('#games')
    expect(stop).toHaveBeenCalled()
    navigate('#exercise')
    expect(page.querySelectorAll('.activity-answer button')).toHaveLength(1)
    expect(get('#activity-source').textContent).toContain('茶')
    chooseTiles(['也', '喝', '茶'])
    click('#activity-submit')
    expect(get('#activity-feedback').textContent).toContain('Check remains failed')
  })

  it('does not treat inability to listen as an incorrect answer', () => {
    start('listening-tiles')
    clickText("Can't listen now")
    expect(get('#activity-summary').textContent).toContain('Not assessed')
    expect(get('#activity-summary').textContent).not.toContain('Check failed')
  })

  it('keeps an established failure when listening later becomes unavailable', () => {
    start('listening-tiles')
    clickText('Reveal transcript')
    clickText("Can't listen now")
    expect(get('#activity-summary').textContent).toContain('Check failed')
    expect(get('#activity-summary').textContent).toContain('Listening unavailable')
  })

  it('records not knowing separately from an unavailable activity', () => {
    start('translation-choice')
    clickText("I don't know")
    click('#activity-submit')
    expect(get('#activity-summary').textContent).toContain('Check failed')
    expect(get('#activity-summary').textContent).not.toContain('Not assessed')
  })

  it('uses a supplied picture hint without marking extra help', () => {
    start('picture-gap')
    expect(get<HTMLImageElement>('.activity-scene').getAttribute('src')).toBe('./exercise-cafe.svg')
    expect(get('#activity-source').textContent).toContain('Supplied hint')
    click('[data-activity-choice="2"]')
    expect(get('#activity-gap').textContent).toBe('茶')
    click('#activity-submit')
    click('#activity-submit')
    expect(get('#activity-summary').textContent).toContain('Unaided correct')
  })

  it('checks all matching pairs together', () => {
    start('matching')
    expect(get<HTMLButtonElement>('#activity-submit').disabled).toBe(true)
    for (let index = 0; index < 4; index++) {
      click(`[data-match-left="${index}"]`)
      click(`[data-match-right="${index}"]`)
    }
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('correct')
  })

  it('supports translation choices with meaningful correction feedback', () => {
    start('translation-choice')
    click('[data-activity-choice="0"]')
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('incorrect')
    expect(get('#activity-feedback').textContent).toContain('茶 means tea')
  })

  it('can revise a matching pair and highlights incorrect pairs', () => {
    start('matching')
    click('[data-match-left="0"]')
    click('[data-match-right="0"]')
    click('[data-match-left="0"]')
    click('[data-match-right="1"]')
    click('[data-match-left="1"]')
    click('[data-match-right="0"]')
    for (let index = 2; index < 4; index++) {
      click(`[data-match-left="${index}"]`)
      click(`[data-match-right="${index}"]`)
    }
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('incorrect')
    expect(page.querySelectorAll('.activity-matching .is-incorrect')).toHaveLength(4)
  })

  it('labels repetition feedback as simulated and never grants speaking credit', () => {
    start('repeat')
    expect(get('#activity-response').textContent).toContain('No audio is recorded or assessed')
    click('[data-speech-preview="clear"]')
    click('#activity-submit')
    expect(get('#activity-feedback').textContent).toContain('Simulated speech feedback')
    click('#activity-submit')
    expect(get('#activity-summary').textContent).toContain('Speech simulation / not assessed')
    expect(get('#activity-summary').textContent).not.toContain('Unaided correct')
  })

  it('combines a spoken-choice selection with a speech preview', () => {
    start('spoken-choice')
    expect(get('#activity-response').textContent).toContain('First choose the reply')
    expect(get('#activity-support').textContent).toContain("Can't speak now")
    expect(get('#activity-support').textContent).toContain("Can't listen now")
    click('[data-activity-choice="1"]')
    click('[data-speech-preview="clear"]')
    click('#activity-submit')
    expect(get('#activity-feedback').dataset.kind).toBe('incorrect')
    expect(get('#activity-feedback').textContent).toContain('even if its words are recognized')
    expect(get('#activity-feedback').textContent).toContain('Introducing yourself does not answer')
  })

  it('summarizes an entire lesson without counting simulated speech as a pass', () => {
    click('[data-activity-start="lesson"]')
    chooseTiles(['I', 'drink', 'tea', 'I', 'also', 'drink', 'water'])
    click('#activity-submit')
    click('#activity-submit')
    click('[data-activity-choice="1"]')
    click('#activity-submit')
    click('#activity-submit')
    chooseTiles(['我', '也', '喝', '茶'])
    click('#activity-submit')
    click('#activity-submit')
    click('[data-activity-choice="2"]')
    click('#activity-submit')
    click('#activity-submit')
    for (let index = 0; index < 4; index++) {
      click(`[data-match-left="${index}"]`)
      click(`[data-match-right="${index}"]`)
    }
    click('#activity-submit')
    click('#activity-submit')
    click('[data-speech-preview="incomplete"]')
    click('#activity-submit')
    expect(page.querySelectorAll('.activity-speech-tokens .missed')).toHaveLength(1)
    click('#activity-submit')
    click('[data-activity-choice="0"]')
    click('[data-speech-preview="clear"]')
    click('#activity-submit')
    click('#activity-submit')
    expect(page.querySelectorAll('.activity-result-list li')).toHaveLength(7)
    const results = get('#activity-summary').textContent || ''
    expect(results.match(/Unaided correct/g)).toHaveLength(5)
    expect(results.match(/Speech simulation \/ not assessed/g)).toHaveLength(2)
    expect(get<HTMLProgressElement>('#activity-progress').value).toBe(7)
    navigate('#practice')
    click('#activity-resume')
    expect(get('#activity-summary').hidden).toBe(false)
  })
})
