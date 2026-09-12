// Handwriting is a local drawing preview, not recognition or stroke-order feedback.
const characterCanvas = one('#character-canvas')
const characterContext = characterCanvas.getContext('2d')
if (!characterContext) throw new Error('The Characters preview requires a browser with a 2D canvas.')

const characterDrafts = new Map(['tea', 'rain', 'cup'].map((id) => [id, { strokes: [], typed: '' }]))
let characterId = 'tea'
let characterPointer = null
let characterStroke = null
let characterGuideVisible = true

function paintCharacter() {
  const bounds = characterCanvas.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const ratio = window.devicePixelRatio || 1
  characterCanvas.width = Math.round(bounds.width * ratio)
  characterCanvas.height = Math.round(bounds.height * ratio)
  characterContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  characterContext.strokeStyle = getComputedStyle(characterCanvas).color
  characterContext.fillStyle = characterContext.strokeStyle
  characterContext.lineWidth = bounds.width * 0.012
  characterContext.lineCap = 'round'
  characterContext.lineJoin = 'round'
  for (const stroke of characterDrafts.get(characterId).strokes) {
    characterContext.beginPath()
    if (stroke.length === 1) {
      characterContext.arc(stroke[0].x * bounds.width, stroke[0].y * bounds.height, characterContext.lineWidth / 2, 0, Math.PI * 2)
      characterContext.fill()
    } else {
      characterContext.moveTo(stroke[0].x * bounds.width, stroke[0].y * bounds.height)
      for (const point of stroke.slice(1)) characterContext.lineTo(point.x * bounds.width, point.y * bounds.height)
      characterContext.stroke()
    }
  }
}

function updateCharacterControls() {
  const count = characterDrafts.get(characterId).strokes.length
  one('#character-undo').disabled = count === 0
  one('#character-clear').disabled = count === 0
  const message = count ? `${count} ${count === 1 ? 'stroke' : 'strokes'} on this canvas. Preview only.` : 'No strokes yet.'
  if (one('#character-status').textContent !== message) one('#character-status').textContent = message
}

function finishCharacterStroke() {
  const pointer = characterPointer
  characterPointer = null
  characterStroke = null
  if (pointer !== null && characterCanvas.hasPointerCapture(pointer)) characterCanvas.releasePointerCapture(pointer)
}

function characterPoint(event) {
  const bounds = characterCanvas.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  }
}

characterCanvas.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || characterPointer !== null) return
  event.preventDefault()
  characterCanvas.focus({ preventScroll: true })
  characterCanvas.setPointerCapture(event.pointerId)
  characterPointer = event.pointerId
  characterStroke = [characterPoint(event)]
  characterDrafts.get(characterId).strokes.push(characterStroke)
  paintCharacter()
  updateCharacterControls()
})
characterCanvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== characterPointer) return
  characterStroke.push(characterPoint(event))
  paintCharacter()
})
characterCanvas.addEventListener('pointerup', (event) => {
  if (event.pointerId !== characterPointer) return
  characterStroke.push(characterPoint(event))
  finishCharacterStroke()
  paintCharacter()
})
for (const type of ['pointercancel', 'lostpointercapture']) {
  characterCanvas.addEventListener(type, (event) => {
    if (event.pointerId === characterPointer) finishCharacterStroke()
  })
}
window.addEventListener('blur', finishCharacterStroke)
document.addEventListener('mockup-route-changed', () => {
  if (one('#practice-characters').hidden) finishCharacterStroke()
})

all('[data-character]').forEach((button) => button.addEventListener('click', () => {
  finishCharacterStroke()
  characterId = button.dataset.character
  const word = words[characterId]
  one('#character-native').textContent = word.native
  one('#character-meaning').textContent = `${word.romanization} / ${word.gloss}`
  one('#character-guide-glyph').textContent = word.native
  characterCanvas.setAttribute('aria-label', `Handwriting area for ${word.gloss}`)
  one('#character-typed').value = characterDrafts.get(characterId).typed
  all('[data-character]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  updateCharacterControls()
  paintCharacter()
}))
one('#character-guide').addEventListener('click', () => {
  characterGuideVisible = !characterGuideVisible
  one('#character-guide').setAttribute('aria-pressed', String(characterGuideVisible))
  one('#character-guide-layer').toggleAttribute('hidden', !characterGuideVisible)
})
one('#character-undo').addEventListener('click', () => {
  finishCharacterStroke()
  characterDrafts.get(characterId).strokes.pop()
  updateCharacterControls()
  paintCharacter()
})
one('#character-clear').addEventListener('click', () => {
  finishCharacterStroke()
  characterDrafts.get(characterId).strokes.length = 0
  updateCharacterControls()
  paintCharacter()
})
one('#character-typed').addEventListener('input', (event) => {
  characterDrafts.get(characterId).typed = event.target.value
})
new ResizeObserver(paintCharacter).observe(characterCanvas)
paintCharacter()
