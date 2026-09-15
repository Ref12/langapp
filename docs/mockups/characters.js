// Render smooth, even-width strokes and match the same curves the learner sees.
function makeCharacterGuides(native) {
  return characterWritingPaths(native).map((d) => {
    const path = characterSvg('path', { d })
    const length = path.getTotalLength()
    const steps = Math.max(1, Math.ceil(length / 2))
    const points = Array.from({ length: steps + 1 }, (_, index) => {
      const point = path.getPointAtLength(length * index / steps)
      return [point.x, point.y]
    })
    return { points, path: d, length }
  })
}
const characterPhaseNames = ['Full guide', 'One stroke at a time', 'From memory']
const characterRepetitions = 3
const characterMemoryHintAfterMisses = 2
const characterEntries = new Map()
const characterStrokeGuides = {}
const characterCanvas = one('#character-canvas')
const characterContext = characterCanvas.getContext('2d')
if (!characterContext) throw new Error('The Characters preview requires a browser with a 2D canvas.')

function createCharacterDraft() {
  return { phase: 0, attempt: 0, strokes: [[], [], []], memoryMisses: [], finished: false }
}
const characterDrafts = new Map()
let characterId = null
let characterPointer = null
let characterStroke = null
let characterFeedback = ''
let characterReturnControl = null
let characterWasActive = false

function activeCharacterStrokes() {
  const draft = characterDrafts.get(characterId)
  return draft.strokes[draft.phase]
}
function hasCharacterMemoryHint() {
  const draft = characterDrafts.get(characterId)
  const index = activeCharacterStrokes().length
  return draft.phase === 2 && index < characterStrokeGuides[characterId].length
    && (draft.memoryMisses[index] || 0) >= characterMemoryHintAfterMisses
}
function characterSvg(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  return element
}
function renderCharacterPrompt() {
  const memory = characterDrafts.get(characterId).phase === 2
  const word = characterEntries.get(characterId)
  const refined = Object.hasOwn(characterMonolineRecipes, word.native)
  one('#characters').dataset.guideStyle = refined ? 'refined' : 'source-median'
  one('#character-artwork-note').textContent = refined
    ? 'Reviewed monoline artwork with compact hooks and short-stroke corrections. Guides, completed strokes, and tracing checks share the same paths.'
    : 'Source-median artwork. Refined artwork for this character has not been reviewed; its existing guides are retained.'
  const native = one('#character-native')
  native.textContent = memory ? word.memoryPrompt || word.gloss.split(' / ')[0] : word.native
  native.lang = memory ? 'en' : 'zh-Hans'
  one('#character-meaning').textContent = memory ? word.memoryContext || 'Write the character from memory' : [word.romanization, word.gloss].filter(Boolean).join(' / ')
  snippetAttachments.get(native)?.remove()
  const actions = createSnippetActions(word.native, wordSnippetOptions(word, word.writingSource || 'Dictionary / Writing'))
  if (memory) {
    actions.setAttribute('aria-label', 'Character pronunciation and help')
    for (const [action, label] of [['hear', 'Hear the character pronunciation'], ['ask', 'Ask Assistant for help with this character']]) {
      const button = actions.querySelector(`[data-snippet-action="${action}"]`)
      button.setAttribute('aria-label', label)
      button.dataset.tooltip = label
    }
  }
  one('.character-prompt').append(actions)
  snippetAttachments.set(native, actions)
  characterCanvas.setAttribute('aria-label', `Handwriting area for ${word.gloss}`)
}
function renderCharacterGuide() {
  const draft = characterDrafts.get(characterId)
  const guides = characterStrokeGuides[characterId]
  const count = activeCharacterStrokes().length
  const memory = draft.phase === 2
  const memoryHint = hasCharacterMemoryHint()
  one('#characters').dataset.characterPhase = String(draft.phase)
  one('#characters').dataset.memoryHint = String(memoryHint)
  const outlines = one('#character-stroke-outlines')
  const direction = one('#character-stroke-direction')
  outlines.replaceChildren()
  direction.replaceChildren()
  guides.forEach((guide, index) => {
    if (memory && index >= count && !(memoryHint && index === count)) return
    if (draft.phase === 1 && index > count) return
    outlines.append(characterSvg('path', {
      d: guide.path,
      class: `character-stroke${index < count ? ' completed' : ''}`,
    }))
  })
  if (!memory || memoryHint) {
    if (count < guides.length) {
      const guide = guides[count]
      const [x, y] = guide.points[0]
      // A full-size numbered marker would cover a corrected dot entirely.
      // Short strokes keep a smaller start cue and the count in the status line.
      const radius = Math.min(5.2, Math.max(1, guide.length * 0.2))
      const arrowSize = Math.min(6, Math.max(1.5, guide.length * 0.3))
      one('#character-direction-arrow').setAttribute('markerWidth', String(arrowSize))
      one('#character-direction-arrow').setAttribute('markerHeight', String(arrowSize))
      direction.append(
        characterSvg('path', { d: guide.path, class: 'character-direction-path', 'marker-end': 'url(#character-direction-arrow)' }),
        characterSvg('circle', { cx: x, cy: y, r: String(radius), class: 'character-start-dot' }),
      )
      if (guide.length >= 20) {
        const number = characterSvg('text', { x, y, class: 'character-start-number' })
        number.textContent = String(count + 1)
        direction.append(number)
      }
    }
  }
  one('#character-guide-layer').toggleAttribute('hidden', memory && count === 0 && !memoryHint)
  one('#character-progress').hidden = memory
  one('#character-progress').max = guides.length
  one('#character-progress').value = count
  one('#character-attempt').textContent = `Repetition ${draft.attempt + 1} of ${characterRepetitions}`
  one('#character-phase-label').textContent = `${draft.phase + 1}/3 ${characterPhaseNames[draft.phase]}`
  one('#character-step').textContent = memoryHint ? 'Hint after two misses' : memory ? 'No visual guide'
    : count === guides.length ? 'All strokes traced' : `Stroke ${count + 1} of ${guides.length}`
  one('#character-help').textContent = [
    'Trace the full outline. Start at the blue dot and follow the arrow.',
    'Only the current stroke is shown. Complete it to reveal the next guide.',
    memoryHint
      ? 'Trace the revealed stroke from the blue dot. The following stroke returns to memory practice.'
      : 'Write from memory. Two misses on the same stroke reveal its guide; later strokes stay hidden.',
  ][draft.phase]
}
function characterViewport(bounds) {
  const size = Math.min(bounds.width, bounds.height)
  return { size, left: (bounds.width - size) / 2, top: (bounds.height - size) / 2 }
}
function paintCharacter() {
  const bounds = characterCanvas.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const ratio = window.devicePixelRatio || 1
  const viewport = characterViewport(bounds)
  const scale = ratio * viewport.size / 100
  characterCanvas.width = Math.round(bounds.width * ratio)
  characterCanvas.height = Math.round(bounds.height * ratio)
  // Match the SVG's centered square without stretching strokes on tall or wide screens.
  characterContext.setTransform(scale, 0, 0, scale, viewport.left * ratio, viewport.top * ratio)
  characterContext.strokeStyle = getComputedStyle(characterCanvas).color
  characterContext.fillStyle = characterContext.strokeStyle
  characterContext.lineWidth = 1.8
  characterContext.lineCap = 'round'
  characterContext.lineJoin = 'round'
  for (const stroke of characterStroke ? [characterStroke] : []) {
    characterContext.beginPath()
    if (stroke.length === 1) {
      characterContext.arc(stroke[0][0], stroke[0][1], characterContext.lineWidth / 2, 0, Math.PI * 2)
      characterContext.fill()
    } else {
      characterContext.moveTo(...stroke[0])
      for (const [x, y] of stroke.slice(1)) characterContext.lineTo(x, y)
      characterContext.stroke()
    }
  }
}
function updateCharacterControls() {
  const draft = characterDrafts.get(characterId)
  const count = activeCharacterStrokes().length
  const total = characterStrokeGuides[characterId].length
  one('#character-undo').disabled = count === 0
  one('#character-clear').disabled = count === 0 && !draft.memoryMisses.some((misses) => misses > 0)
  one('#character-next-phase').disabled = count !== total
  one('#character-next-phase').textContent = draft.finished ? 'Practice again'
    : draft.attempt < characterRepetitions - 1 ? 'Repeat' : draft.phase === 2 ? 'Finish writing' : 'Next phase'
  const message = characterFeedback || (draft.finished ? 'Three repetitions in each phase finished. No mastery score is assigned.'
    : count === total ? `Character complete. Choose ${one('#character-next-phase').textContent} to continue.`
    : `${count} of ${total} strokes. ${hasCharacterMemoryHint() ? 'Trace the revealed stroke.' : draft.phase === 2 ? 'Write from memory.' : 'Follow the blue dot and arrow.'}`)
  if (one('#character-status').textContent !== message) one('#character-status').textContent = message
  renderCharacterGuide()
}
function characterDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}
function characterStrokeLength(points) {
  return points.slice(1).reduce((length, point, index) => length + characterDistance(points[index], point), 0)
}
function sampleCharacterStroke(points) {
  const samples = [points[0]]
  points.slice(1).forEach((point, index) => {
    const start = points[index]
    const steps = Math.max(1, Math.ceil(characterDistance(start, point) / 2))
    for (let step = 1; step <= steps; step++) samples.push([
      start[0] + (point[0] - start[0]) * step / steps,
      start[1] + (point[1] - start[1]) * step / steps,
    ])
  })
  return samples
}
function matchesCharacterStroke(stroke, guide) {
  const expectedLength = characterStrokeLength(guide)
  // Include the start marker on short dots, while preserving the overall direction.
  const tolerance = Math.min(10, Math.max(5.5, expectedLength * 0.45))
  if (characterDistance(stroke[0], guide[0]) > tolerance || characterDistance(stroke.at(-1), guide.at(-1)) > tolerance) return false
  const length = characterStrokeLength(stroke)
  if (length < expectedLength * 0.4 || length > expectedLength * 2.2 + 4) return false
  const start = guide[0], end = guide.at(-1)
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const advance = (stroke.at(-1)[0] - stroke[0][0]) * dx + (stroke.at(-1)[1] - stroke[0][1]) * dy
  if (advance < (dx * dx + dy * dy) * 0.25) return false
  let furthest = 0
  for (const point of sampleCharacterStroke(stroke)) {
    let closest = { distance: Infinity, progress: 0 }
    let offset = 0
    for (let index = 1; index < guide.length; index++) {
      const start = guide[index - 1], end = guide[index]
      const segment = characterDistance(start, end)
      const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1])) / (segment * segment)))
      const distance = characterDistance(point, [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])])
      if (distance < closest.distance) closest = { distance, progress: offset + t * segment }
      offset += segment
    }
    if (closest.distance > 11 || closest.progress < furthest - 9) return false
    furthest = Math.max(furthest, closest.progress)
  }
  return true
}
function finishCharacterStroke(commit = false) {
  if (characterPointer === null) return
  const pointer = characterPointer
  const stroke = characterStroke
  const draft = characterDrafts.get(characterId)
  characterPointer = null
  characterStroke = null
  if (characterCanvas.hasPointerCapture(pointer)) characterCanvas.releasePointerCapture(pointer)
  if (!commit) characterFeedback = 'Stroke interrupted. Start this stroke again.'
  else {
    const guide = characterStrokeGuides[characterId][activeCharacterStrokes().length]
    if (matchesCharacterStroke(stroke, guide.points)) {
      activeCharacterStrokes().push(stroke)
      characterFeedback = ''
    } else if (draft.phase === 2) {
      const index = activeCharacterStrokes().length
      draft.memoryMisses[index] = (draft.memoryMisses[index] || 0) + 1
      characterFeedback = draft.memoryMisses[index] === characterMemoryHintAfterMisses
        ? 'Guide added after two misses. Start at the blue dot and follow the arrow.'
        : hasCharacterMemoryHint()
          ? 'Try this stroke again using its guide. Later strokes remain hidden.'
          : 'Try that stroke again from memory. Two misses on this stroke will reveal its guide.'
    } else characterFeedback = 'Try this stroke again: start near the blue dot and follow the arrow. It does not need to be exact.'
  }
  updateCharacterControls()
  paintCharacter()
}
function characterPoint(event) {
  const bounds = characterCanvas.getBoundingClientRect()
  const viewport = characterViewport(bounds)
  return [
    (event.clientX - bounds.left - viewport.left) / viewport.size * 100,
    (event.clientY - bounds.top - viewport.top) / viewport.size * 100,
  ]
}
characterCanvas.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || characterPointer !== null) return
  const draft = characterDrafts.get(characterId)
  if (draft.finished || activeCharacterStrokes().length === characterStrokeGuides[characterId].length) {
    characterFeedback = draft.finished ? 'Choose Practice again to start a new round.'
      : `All strokes written. Choose ${one('#character-next-phase').textContent} to continue.`
    updateCharacterControls()
    return
  }
  event.preventDefault()
  characterCanvas.focus({ preventScroll: true })
  characterCanvas.setPointerCapture(event.pointerId)
  characterPointer = event.pointerId
  characterStroke = [characterPoint(event)]
  paintCharacter()
})
characterCanvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== characterPointer) return
  const point = characterPoint(event)
  if (characterDistance(characterStroke.at(-1), point) >= 0.35) characterStroke.push(point)
  paintCharacter()
})
characterCanvas.addEventListener('pointerup', (event) => {
  if (event.pointerId !== characterPointer) return
  characterStroke.push(characterPoint(event))
  finishCharacterStroke(true)
})
for (const type of ['pointercancel', 'lostpointercapture']) {
  characterCanvas.addEventListener(type, (event) => {
    if (event.pointerId === characterPointer) finishCharacterStroke()
  })
}
window.addEventListener('blur', () => finishCharacterStroke())
document.addEventListener('mockup-theme-changed', paintCharacter)
document.addEventListener('mockup-route-changed', (event) => {
  if (event.detail !== 'characters') {
    finishCharacterStroke()
    one('#character-info-dialog').close()
  }
  if (characterWasActive && event.detail === 'dictionary') requestAnimationFrame(() => {
    if (document.body.dataset.screen !== 'dictionary') return
    const fallback = one('#dictionary-lookup-panel').hidden ? one('#dictionary-search') : one('#dictionary-lookup')
    const replacement = all('#dictionary [data-write-word]').find((button) =>
      button.dataset.writeWord === characterReturnControl?.dataset.writeWord && button.getClientRects().length)
    const target = characterReturnControl?.isConnected && characterReturnControl.getClientRects().length
      ? characterReturnControl : replacement || fallback
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest' })
  })
  characterWasActive = event.detail === 'characters'
})
function selectPracticeCharacter(id) {
  if (!Object.hasOwn(characterStrokeGuides, id)) {
    notify('A stroke guide for that character is not available in this preview.')
    return
  }
  finishCharacterStroke()
  characterId = id
  one('#characters').dataset.character = id
  characterFeedback = ''
  renderCharacterPrompt()
  updateCharacterControls()
  paintCharacter()
}
function openCharacterPractice(word, index = 0, returnControl = null) {
  const characters = Array.from(word.native).filter((character) => /\p{Script=Han}/u.test(character))
  const native = characters[index]
  if (!Object.hasOwn(characterStrokeData, native)) {
    notify('A stroke guide for that character is not available in this preview.')
    return
  }
  let entry = [...characterEntries].find(([, item]) => item.native === native)
  if (!entry) {
    const id = `writing-${native.codePointAt(0).toString(16)}`
    const definition = Object.values(words).find((item) => item.native === native) || {
      native, romanization: '', gloss: `Character ${index + 1} of "${word.gloss}"`,
      memoryPrompt: `Character ${index + 1}`,
      memoryContext: `Of "${word.gloss}"${word.romanization ? ` (${word.romanization})` : ''}`,
      writingSource: `Dictionary: ${word.native} / ${word.gloss}; character ${index + 1} of ${characters.length}`,
    }
    characterEntries.set(id, definition)
    characterStrokeGuides[id] = makeCharacterGuides(native)
    characterDrafts.set(id, createCharacterDraft())
    entry = [id, definition]
  }
  characterReturnControl = returnControl
  selectPracticeCharacter(entry[0])
  location.hash = '#characters'
  requestAnimationFrame(() => {
    if (location.hash !== '#characters') return
    one('#characters-title').tabIndex = -1
    one('#characters-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  })
}
one('#character-info').addEventListener('click', () => {
  finishCharacterStroke()
  one('#character-info-dialog').showModal()
})
one('#character-undo').addEventListener('click', () => {
  finishCharacterStroke()
  activeCharacterStrokes().pop()
  characterDrafts.get(characterId).finished = false
  characterFeedback = ''
  updateCharacterControls()
  paintCharacter()
})
one('#character-clear').addEventListener('click', () => {
  finishCharacterStroke()
  activeCharacterStrokes().length = 0
  const draft = characterDrafts.get(characterId)
  draft.finished = false
  draft.memoryMisses = []
  characterFeedback = ''
  updateCharacterControls()
  paintCharacter()
})
one('#character-next-phase').addEventListener('click', () => {
  finishCharacterStroke()
  const draft = characterDrafts.get(characterId)
  if (draft.finished) {
    draft.phase = 0
    draft.attempt = 0
    draft.strokes = [[], [], []]
    draft.memoryMisses = []
    draft.finished = false
  } else if (draft.attempt < characterRepetitions - 1) {
    draft.attempt++
    activeCharacterStrokes().length = 0
    draft.memoryMisses = []
  } else if (draft.phase < 2) {
    draft.phase++
    draft.attempt = 0
    draft.memoryMisses = []
  } else draft.finished = true
  characterFeedback = ''
  renderCharacterPrompt()
  updateCharacterControls()
  paintCharacter()
})
new ResizeObserver(() => {
  finishCharacterStroke()
  paintCharacter()
}).observe(characterCanvas)
