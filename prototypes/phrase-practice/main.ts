import { playBrowserSpeechToEnd, stopBrowserSpeech } from '../../src/core/assistant/speech'
import { createPlayer, modes, samples, type Phrase, type State } from './player'

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing prototype control: ${id}`)
  return node as T
}
const paths: Record<string, string> = {
  SlidersHorizontal: 'M3 6h6m4 0h8M3 12h10m4 0h4M3 18h4m4 0h10M9 3v6M17 9v6M7 15v6',
  X: 'M6 6l12 12M6 18L18 6',
  WholeWord: 'M3 5v14h3M21 5v14h-3M8 9v6m4-6v6m4-6v6',
  Quote: 'M4 6h6v7H4zM14 6h6v7h-6zM10 13c0 4-2 6-5 6M20 13c0 4-2 6-5 6',
  ArrowRight: 'M4 12h16m-6-6 6 6-6 6',
  ArrowLeft: 'M20 12H4m6-6-6 6 6 6',
  Minus: 'M5 12h14',
  Plus: 'M5 12h14M12 5v14',
  SkipBack: 'M5 5v14M19 5 8 12l11 7z',
  SkipForward: 'M19 5v14M5 5l11 7-11 7z',
  Play: 'M7 4l13 8-13 8z',
  Pause: 'M7 5v14M17 5v14',
  Repeat2: 'M4 8h13a3 3 0 0 1 3 3M4 8l4-4M4 8l4 4M20 16H7a3 3 0 0 1-3-3m16 3-4-4m4 4-4 4',
  TrendingUp: 'M3 17l6-6 4 4 8-10M14 5h7v7',
}
function icon(name: string) {
  if (!paths[name]) throw new Error(`Unknown prototype icon: ${name}`)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[name])
  svg.append(path)
  return svg
}
document.querySelectorAll<HTMLElement>('[data-icon]').forEach(node => {
  const svg = icon(node.dataset.icon!)
  if (node.id) svg.id = node.id
  node.replaceWith(svg)
})

const dialog = element<HTMLDialogElement>('practice')
const options = element('options')
const optionsToggle = element<HTMLButtonElement>('options-toggle')
const pinyin = element<HTMLInputElement>('pinyin')
const translation = element<HTMLInputElement>('translation')
const sample = element<HTMLSelectElement>('sample')
const phraseStrip = element('phrase-strip')
const stepDots = element('steps')
const error = element('error')
const phase = element('phase')
const playLabel = element('play-label')
const controller = new AbortController()
const eventOptions = { signal: controller.signal }
const player = createPlayer(samples[0], {
  speak: (text, rate) => playBrowserSpeechToEnd('phrase-practice-prototype', text, 'zh-Hans', rate),
  stop: stopBrowserSpeech,
}, render)
let renderedPhrase: Phrase | undefined
let renderedStep = ''
let lastPlaying: boolean | undefined
let focusBeforeOpen: Element | null = null
const captions: Record<State['phase'], string> = {
  idle: 'Ready when you are', speaking: 'Listen', responding: 'Your turn',
  paused: 'Paused', completed: 'Round complete', error: 'Playback needs attention',
}
const guarded = (operation: () => void) => {
  try { operation() }
  catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : 'This action could not be completed.'
    error.hidden = false
  }
}
function text(id: string, value: string) {
  const node = element(id)
  if (node.textContent !== value) node.textContent = value
}
function render(state: State) {
  const phrase = player.getPhrase()
  const steps = player.getSteps()
  const step = steps[state.index]
  dialog.dataset.mode = state.mode
  dialog.dataset.phase = state.phase
  document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode))
  })
  if (phrase !== renderedPhrase) {
    renderedPhrase = phrase
    renderedStep = ''
    phraseStrip.replaceChildren(...phrase.words.map((word, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = word.text
      button.lang = 'zh-Hans'
      button.setAttribute('aria-label', `${word.text} ${word.pinyin}`)
      button.addEventListener('click', () => guarded(() => {
        const mode = player.getState().mode
        const stepIndex = mode === 'phrase' ? 0 : mode === 'backward' ? phrase.words.length - index - 1 : index
        player.select(stepIndex)
      }))
      return button
    }))
  }
  phraseStrip.hidden = state.mode === 'phrase'
  Array.from(phraseStrip.children).forEach((button, index) => {
    button.setAttribute('aria-pressed', String(index >= step.start && index < step.end))
  })
  if (stepDots.children.length !== steps.length) {
    stepDots.replaceChildren(...steps.map((_, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.addEventListener('click', () => guarded(() => player.select(index)))
      return button
    }))
  }
  Array.from(stepDots.children).forEach((button, index) => {
    button.setAttribute('aria-label', `Select step ${index + 1}: ${steps[index].text}`)
    if (index === state.index) button.setAttribute('aria-current', 'step')
    else button.removeAttribute('aria-current')
  })
  const stepKey = `${state.mode}:${state.index}`
  if (renderedStep !== stepKey) {
    renderedStep = stepKey
    element('hanzi').replaceChildren(...phrase.words.slice(step.start, step.end).map((word, offset) => {
      const span = document.createElement('span')
      span.textContent = word.text
      if (state.mode === 'words' || state.mode === 'forward' && offset === step.end - step.start - 1
        || state.mode === 'backward' && offset === 0) span.className = 'addition'
      return span
    }))
    text('reading', step.pinyin)
    text('meaning', state.mode === 'words' ? phrase.words[step.start].meaning : phrase.meaning)
  }
  element('reading').hidden = !pinyin.checked
  element('meaning').hidden = !translation.checked || state.mode !== 'words' && step.text !== phrase.words.map(word => word.text).join('')
  if (phase.textContent !== captions[state.phase]) phase.textContent = captions[state.phase]
  text('round', `Round ${state.round}`)
  text('position', state.mode === 'phrase' ? 'Whole phrase' : `${state.mode === 'words' ? 'Word' : 'Step'} ${state.index + 1} of ${steps.length}`)
  text('response-time', state.phase === 'responding' ? `${state.remaining.toFixed(1)}s` : '')
  const progress = state.phase === 'responding' ? state.remaining / state.responseDuration * 100 : 0
  element('response-fill').style.width = `${progress}%`
  element('response-track').setAttribute('aria-valuenow', String(Math.round(progress)))
  text('speed', `${state.rate}×`)
  text('pause', `${state.pause}s`)
  for (const [id, disabled] of [['slower', state.rate <= 0.25], ['faster', state.rate >= 1.25],
    ['shorter', state.pause <= 0.5], ['longer', state.pause >= 10],
    ['previous', state.index === 0], ['next', state.index === steps.length - 1]] as const) {
    element<HTMLButtonElement>(id).disabled = disabled
  }
  for (const key of ['loop', 'ramp'] as const) {
    element(key).setAttribute('aria-pressed', String(state[key]))
    text(`${key}-state`, state[key] ? 'On' : 'Off')
  }
  element<HTMLButtonElement>('ramp').disabled = !state.loop
  element('ramp').title = !state.loop ? 'Turn on Loop to use Auto-ramp' : 'Increase speed and shorten pauses after each complete round'
  const playing = state.phase === 'speaking' || state.phase === 'responding'
  if (lastPlaying !== playing) {
    lastPlaying = playing
    const svg = icon(playing ? 'Pause' : 'Play')
    svg.id = 'play-icon'
    document.getElementById('play-icon')!.replaceWith(svg)
  }
  const label = playing ? 'Pause' : state.phase === 'error' ? 'Retry stop' : state.phase === 'completed' ? 'Play again' : state.phase === 'paused' ? 'Resume' : 'Start practice'
  if (playLabel.textContent !== label) playLabel.textContent = label
  error.textContent = state.error ?? ''
  error.hidden = !state.error
}
function showOptions(show: boolean) {
  options.hidden = !show
  optionsToggle.setAttribute('aria-expanded', String(show))
  if (show) { element('options').scrollIntoView?.({ block: 'start' }); sample.focus() }
  else optionsToggle.focus()
}
function close() {
  if (!player.pause()) return
  dialog.close()
  if (focusBeforeOpen instanceof HTMLElement) focusBeforeOpen.focus()
}
function open() {
  focusBeforeOpen = document.activeElement
  dialog.showModal()
  element('play').focus()
}
element('open-practice').addEventListener('click', open, eventOptions)
element('close-practice').addEventListener('click', close, eventOptions)
dialog.addEventListener('cancel', event => { event.preventDefault(); close() }, eventOptions)
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return
  const bounds = dialog.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
}, eventOptions)
optionsToggle.addEventListener('click', () => showOptions(options.hidden), eventOptions)
element('options-done').addEventListener('click', () => showOptions(false), eventOptions)
document.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(button => {
  button.addEventListener('click', () => guarded(() => {
    const mode = modes.find(value => value === button.dataset.mode)
    if (!mode) throw new Error('Unknown practice mode.')
    player.setMode(mode)
  }), eventOptions)
})
element('play').addEventListener('click', () => {
  const state = player.getState()
  if (state.phase === 'speaking' || state.phase === 'responding' || state.phase === 'error') player.pause()
  else player.play()
}, eventOptions)
element('previous').addEventListener('click', () => guarded(() => player.select(player.getState().index - 1)), eventOptions)
element('next').addEventListener('click', () => guarded(() => player.select(player.getState().index + 1)), eventOptions)
for (const [id, key, delta] of [['slower', 'rate', -0.05], ['faster', 'rate', 0.05], ['shorter', 'pause', -0.25], ['longer', 'pause', 0.25]] as const) {
  element(id).addEventListener('click', () => guarded(() => {
    player.configure({ [key]: Number((player.getState()[key] + delta).toFixed(2)) })
  }), eventOptions)
}
for (const key of ['loop', 'ramp'] as const) {
  element(key).addEventListener('click', () => player.configure({ [key]: !player.getState()[key] }), eventOptions)
}
for (const [id, key] of [['max-rate', 'maxRate'], ['min-pause', 'minPause']] as const) {
  element<HTMLSelectElement>(id).addEventListener('change', event => guarded(() => {
    player.configure({ [key]: Number((event.currentTarget as HTMLSelectElement).value) })
  }), eventOptions)
}
sample.addEventListener('change', () => guarded(() => {
  const next = samples[Number(sample.value)]
  if (!next) throw new Error('Choose one of the sample phrases.')
  if (!player.setPhrase(next)) sample.value = String(samples.indexOf(player.getPhrase()))
}), eventOptions)
for (const control of [pinyin, translation]) control.addEventListener('change', () => render(player.getState()), eventOptions)
document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause() }, eventOptions)
window.addEventListener('pagehide', event => {
  if (event.persisted) { player.pause(); return }
  if (!player.dispose()) console.error('Prototype speech could not be stopped when leaving the page.')
  controller.abort()
}, eventOptions)
render(player.getState())
open()
