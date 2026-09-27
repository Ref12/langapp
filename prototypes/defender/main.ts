import { sampleWords, type Word } from './deck'
import { advanceRun, allowsPinyinAnnotations, answerText, createRun, directionForms, isDirection, pauseRun, promptText, resumeRun, SHIELDS, submitTranslation, type Incoming, type Run, type Settings, type WordForm } from './game'

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`Prototype element missing: ${selector}`)
  return node
}

const settings = element<HTMLFormElement>('#settings')
const mode = element<HTMLSelectElement>('#mode'), direction = element<HTMLSelectElement>('#direction'), pace = element<HTMLSelectElement>('#pace')
const showPinyin = element<HTMLInputElement>('#show-pinyin'), pinyinHelp = element('#pinyin-help')
const field = element('#field'), incoming = element('#incoming'), effects = element('#effects')
const overlay = element('#overlay'), title = element('#overlay-title'), copy = element('#overlay-copy'), kicker = element('#overlay-kicker')
const primary = element<HTMLButtonElement>('#primary'), secondary = element<HTMLButtonElement>('#secondary'), pause = element<HTMLButtonElement>('#pause')
const score = element('#score'), wave = element('#wave'), shields = element('#shields'), streak = element('#streak'), pressure = element('#pressure')
const answerBank = element('#answer-bank'), typeForm = element<HTMLFormElement>('#type-form'), answerInput = element<HTMLInputElement>('#answer-input')
const feedback = element('#feedback'), briefing = element<HTMLDetailsElement>('#briefing'), recap = element('#recap'), missedWords = element('#missed-words')
const controlLabel = element('#control-label'), controlHint = element('#control-hint')
const buttons = new Map<string, HTMLButtonElement>(), tiles = new Map<number, HTMLElement>()
let run: Run | undefined
let animation: number | undefined
let previousTime = 0
let composing = false
let resumeFocus: HTMLElement | null = null
let lastHud = ''

function config(): Settings {
  const inputMode = mode.value, incomingDirection = direction.value, startingPace = pace.value
  if ((inputMode !== 'tap' && inputMode !== 'type') || !isDirection(incomingDirection)
    || (startingPace !== 'gentle' && startingPace !== 'standard' && startingPace !== 'brisk')) throw new Error('Choose valid game settings.')
  return { mode: inputMode, direction: incomingDirection, pace: startingPace, showPinyin: showPinyin.checked && allowsPinyinAnnotations(incomingDirection) }
}

function announce(text: string, kind = '') {
  feedback.textContent = text
  feedback.dataset.kind = kind
}

function deckCard(word: Word): HTMLDivElement {
  const card = document.createElement('div'), character = document.createElement('strong'), reading = document.createElement('span'), meaning = document.createElement('span')
  character.lang = 'zh-Hans'; character.textContent = word.character
  reading.textContent = word.pinyin; meaning.textContent = `${word.meaning}${word.englishAnswers.length > 1 ? ` (${word.englishAnswers.slice(1).join(', ')})` : ''}`
  card.append(character, reading, meaning)
  return card
}
element('#word-deck').append(...sampleWords.map(deckCard))
if (window.self !== window.top) element('.device-preview-link').hidden = true

function paintWord(node: HTMLElement, word: Word, form: WordForm, annotate: boolean) {
  node.lang = form === 'character' ? 'zh-Hans' : form === 'pinyin' ? 'zh-Latn' : 'en'
  const hinted = annotate && form === 'character'
  node.classList.toggle('with-pinyin', hinted)
  const face = document.createElement(hinted ? 'ruby' : 'span')
  face.className = 'word-face'
  face.textContent = word[form].normalize('NFC')
  if (hinted) {
    const reading = document.createElement('rt')
    reading.lang = 'zh-Latn'; reading.textContent = word.pinyin.normalize('NFC')
    face.append(reading)
  }
  node.replaceChildren(face)
}

function paintControls(words: Word[] = sampleWords.slice(0, 6)) {
  const options = run?.settings ?? config(), typing = options.mode === 'type'
  const answerForm = directionForms[options.direction].answer
  const labels = { meaning: 'English meaning', character: 'Chinese word', pinyin: 'pinyin' }
  showPinyin.disabled = !allowsPinyinAnnotations(options.direction)
  pinyinHelp.textContent = showPinyin.disabled ? 'Hints are hidden when matching pronunciation.' : 'Optional help in Chinese ↔ English modes.'
  answerBank.hidden = typing; typeForm.hidden = !typing
  controlLabel.textContent = typing ? 'TYPE TO DEFEND' : 'YOUR TRANSLATIONS'
  controlHint.textContent = typing ? answerForm === 'pinyin' ? 'Tone marks or numbers · Enter' : `${labels[answerForm]} · Enter to fire` : `Tap the ${labels[answerForm]}`
  answerInput.placeholder = answerForm === 'meaning' ? 'Type an English meaning…' : answerForm === 'pinyin' ? 'Pinyin: shuǐ or shui3…' : '输入中文…'
  answerInput.lang = answerForm === 'meaning' ? 'en' : answerForm === 'pinyin' ? 'zh-Latn' : 'zh-Hans'
  answerBank.replaceChildren(); buttons.clear()
  for (const word of words) {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'answer-choice'
    paintWord(button, word, answerForm, options.showPinyin === true)
    button.addEventListener('click', () => answer(answerText(word, options.direction)))
    buttons.set(word.id, button); answerBank.append(button)
  }
  lockControls()
}

function lockControls() {
  const playing = run?.phase === 'playing'
  for (const button of buttons.values()) button.disabled = !playing
  answerInput.disabled = !playing
  typeForm.querySelector('button')!.disabled = !playing
}

function paintHud() {
  const stamp = `${run?.score}:${run?.wave}:${run?.shields}:${run?.streak}`
  if (stamp === lastHud) return
  lastHud = stamp
  score.textContent = String(run?.score ?? 0).padStart(4, '0')
  wave.textContent = String(run?.wave ?? 1).padStart(2, '0')
  streak.textContent = `${run?.streak ?? 0} streak`
  pressure.textContent = run ? `${run.hits} intercepted · wave rises every 20s` : 'Multiple words. One line to hold.'
  shields.replaceChildren(...Array.from({ length: SHIELDS }, (_, index) => {
    const block = document.createElement('span')
    block.className = `shield${index >= (run?.shields ?? SHIELDS) ? ' lost' : ''}`
    return block
  }))
  shields.setAttribute('aria-label', `${run?.shields ?? SHIELDS} of ${SHIELDS} shields`)
}

function paintTiles() {
  const live = new Set(run?.incoming.map(tile => tile.id) ?? [])
  for (const [id, node] of tiles) if (!live.has(id)) { node.remove(); tiles.delete(id) }
  for (const tile of run?.incoming ?? []) {
    let node = tiles.get(tile.id)
    if (!node) {
      const word = run!.words.find(word => word.id === tile.wordId)!
      node = document.createElement('div')
      node.className = 'incoming-word'
      paintWord(node, word, directionForms[run!.settings.direction].prompt, run!.settings.showPinyin === true)
      node.setAttribute('aria-label', `Incoming ${promptText(word, run!.settings.direction)}${node.classList.contains('with-pinyin') ? `, ${word.pinyin}` : ''}`)
      node.style.setProperty('--lane', String(tile.lane))
      tiles.set(tile.id, node); incoming.append(node)
    }
    node.style.setProperty('--position', String(tile.position))
    node.classList.toggle('danger', tile.position < .23)
  }
}

function flash(tile: Incoming, text: string, breach = false) {
  const node = document.createElement('div')
  node.className = `word-effect${breach ? ' breach' : ''}`; node.textContent = text
  node.style.setProperty('--position', String(Math.max(0, tile.position))); node.style.setProperty('--lane', String(tile.lane))
  effects.append(node)
  window.setTimeout(() => node.remove(), 460)
}

function stopAnimation() {
  if (animation !== undefined) cancelAnimationFrame(animation)
  animation = undefined
}

function finish(endedEarly = false) {
  if (!run) return
  run = { ...run, phase: 'over' }
  stopAnimation(); lockControls(); paintHud()
  overlay.hidden = false; settings.hidden = true; pause.disabled = true
  kicker.textContent = endedEarly ? 'WATCH ENDED' : 'SHIELD DOWN'
  title.textContent = `${run.score.toLocaleString()} points`
  copy.textContent = `${run.hits} words intercepted · wave ${run.wave} · best streak ${run.bestStreak}.`
  primary.textContent = 'Play again'; secondary.textContent = 'Change setup'; secondary.hidden = false
  briefing.hidden = false; recap.hidden = false
  const missed = [...new Set(run.missed)]
  missedWords.replaceChildren(...missed.map(id => deckCard(run!.words.find(word => word.id === id)!)))
  if (!missed.length) missedWords.textContent = 'No breaches this run.'
  announce(endedEarly ? 'Run ended. Your score is just for this prototype.' : 'Shield down. Review the missed words and try again.')
  primary.focus({ preventScroll: true })
}

function frame(time: number) {
  animation = undefined
  if (run?.phase !== 'playing') return
  const delta = (time - previousTime) / 1000
  previousTime = time
  if (delta > 1) { pauseGame('Paused after an interruption. Your shield is safe.'); return }
  const result = advanceRun(run, Math.max(0, delta))
  run = result.run
  for (const event of result.events) {
    if (event.type === 'wave') announce(`Wave ${event.wave}. New words arrive faster.`)
    if (event.type === 'breach') {
      flash(event.tile, '−1 shield', true)
      announce('A word crossed the line. One shield lost.', 'breach')
    }
  }
  paintTiles(); paintHud()
  if (run.phase === 'over') finish()
  else animation = requestAnimationFrame(frame)
}

function start() {
  stopAnimation()
  run = createRun(config(), sampleWords, crypto.getRandomValues(new Uint32Array(1))[0])
  previousTime = performance.now(); composing = false; answerInput.value = ''
  settings.hidden = true; briefing.hidden = true; briefing.open = false; recap.hidden = true
  overlay.hidden = true; pause.disabled = false; pause.textContent = 'Ⅱ'; pause.setAttribute('aria-label', 'Pause game'); pause.title = 'Pause game'
  effects.replaceChildren(); incoming.replaceChildren(); tiles.clear()
  paintControls(run.words); paintTiles(); paintHud()
  announce(run.settings.mode === 'tap' ? 'Translate any incoming word. Tap its match below.' : 'Translate any incoming word. Type the answer and press Enter.')
  if (run.settings.mode === 'type') answerInput.focus()
  else buttons.values().next().value?.focus({ preventScroll: true })
  animation = requestAnimationFrame(frame)
}

function pauseGame(reason = 'Take a breath. The words will wait.') {
  if (run?.phase !== 'playing') return
  resumeFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  run = pauseRun(run); stopAnimation(); lockControls()
  overlay.hidden = false; kicker.textContent = 'TIME OUT'; title.textContent = 'Line holding.'; copy.textContent = reason
  primary.textContent = 'Resume'; secondary.textContent = 'End run'; secondary.hidden = false
  pause.textContent = '▶'; pause.setAttribute('aria-label', 'Resume game'); pause.title = 'Resume game'
  primary.focus({ preventScroll: true }); announce('Paused.')
}

function resume() {
  if (run?.phase !== 'paused' || document.hidden) return
  run = resumeRun(run); overlay.hidden = true; lockControls()
  pause.textContent = 'Ⅱ'; pause.setAttribute('aria-label', 'Pause game'); pause.title = 'Pause game'
  previousTime = performance.now()
  if (run.settings.mode === 'type') answerInput.focus()
  else if (resumeFocus?.isConnected) resumeFocus.focus({ preventScroll: true })
  announce('Back on watch.')
  animation = requestAnimationFrame(frame)
}

function answer(text: string) {
  if (!run) return
  const result = submitTranslation(run, text)
  run = result.run
  if (result.outcome === 'ignored') return
  if (result.outcome === 'hit' && result.tile) {
    const word = run.words.find(word => word.id === result.tile!.wordId)!
    flash(result.tile, 'Matched')
    announce(`${promptText(word, run.settings.direction)} — ${answerText(word, run.settings.direction)}. Intercepted!`, 'hit')
    answerInput.value = ''
  } else {
    announce('No incoming word matches that answer. Try again.', 'wrong')
    if (run.settings.mode === 'type') answerInput.select()
  }
  paintTiles(); paintHud()
}

function setup() {
  run = undefined; stopAnimation(); tiles.clear(); incoming.replaceChildren(); effects.replaceChildren()
  settings.hidden = false; briefing.hidden = false; recap.hidden = true; pause.disabled = true
  overlay.hidden = false; kicker.textContent = 'YOUR NEXT WATCH'; title.textContent = 'Ready to hold the line?'
  copy.textContent = 'Translate incoming words before they cross the shield. Five breaches end the run.'
  primary.textContent = 'Start defending →'; secondary.hidden = true
  paintControls(); paintHud(); announce('Choose controls, direction, and pace.'); mode.focus()
}

primary.addEventListener('click', () => run?.phase === 'paused' ? resume() : start())
secondary.addEventListener('click', () => run?.phase === 'paused' ? finish(true) : setup())
pause.addEventListener('click', () => run?.phase === 'paused' ? resume() : pauseGame())
settings.addEventListener('submit', event => event.preventDefault())
settings.addEventListener('change', () => paintControls())
answerInput.addEventListener('compositionstart', () => { composing = true })
answerInput.addEventListener('compositionend', () => { composing = false })
typeForm.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault()
})
typeForm.addEventListener('submit', event => { event.preventDefault(); if (!composing) answer(answerInput.value) })
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || composing) return
  if (run?.phase === 'playing') pauseGame()
  else if (run?.phase === 'paused') resume()
})
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame('Paused while you were away. Resume when ready.') })
window.addEventListener('pagehide', stopAnimation)
window.addEventListener('error', event => {
  pauseGame('The prototype encountered an error.')
  const error = element('#fatal-error'); error.textContent = `Prototype error: ${event.message}`; error.hidden = false
})
field.addEventListener('pointerdown', () => { if (run?.phase === 'playing' && run.settings.mode === 'type') answerInput.focus() })
paintControls(); paintHud()
