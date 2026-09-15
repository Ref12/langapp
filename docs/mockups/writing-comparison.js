const comparisonTea = '\u8336'
const comparisonCharacters = {
  '\u8336': { name: 'Tea', pronunciation: 'ch\u00e1', meaning: 'tea' },
  '\u96e8': { name: 'Rain', pronunciation: 'y\u01d4', meaning: 'rain' },
  '\u676f': { name: 'Cup', pronunciation: 'b\u0113i', meaning: 'cup' },
  '\u4eba': { name: 'Person', pronunciation: 'r\u00e9n', meaning: 'person' },
  '\u4e00': { name: 'One', pronunciation: 'y\u012b', meaning: 'one' },
}
// Original style-study paths. These are not extracted from a font or Duolingo.
const customTeaPaths = [
  'M24 22 H76',
  'M36 12 V31',
  'M64 12 V31',
  'M50 36 C43 45 30 54 14 60',
  'M50 36 C57 45 70 54 86 60',
  'M33 65 H67',
  'M50 55 V85 Q50 90 45 87 L42 85',
  'M36 76 Q32 82 26 86',
  'M64 76 Q72 81 76 86',
]
const comparisonCharacter = document.getElementById('comparison-character')
const comparisonSlider = document.getElementById('comparison-strokes')
const comparisonReplay = document.getElementById('comparison-replay')
const comparisonStatus = document.getElementById('comparison-status')
const comparisonWidth = document.getElementById('comparison-width')
const comparisonCorrections = document.getElementById('comparison-corrections')
let comparisonTimer = null

function comparisonSvg(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  return element
}

function renderComparisonTransformed() {
  const strokes = makeCharacterMonolineStrokes(comparisonCharacter.value, {
    width: Number(comparisonWidth.value), correctTerminals: comparisonCorrections.checked,
  })
  const group = comparisonSvg('g', { class: 'transformed-ink' })
  strokes.forEach(({ path, rule }, index) => {
    group.append(comparisonSvg('path', {
      d: path, class: 'glyph-stroke', 'data-stroke': index + 1, 'data-terminal-rule': rule || 'none',
    }))
  })
  const glyph = document.getElementById('glyph-transformed')
  const previous = glyph.querySelector('.transformed-ink')
  if (previous) previous.replaceWith(group)
  else glyph.prepend(group)
  const hooks = strokes.filter(({ rule }) => rule === 'compact-hook').length
  const falls = strokes.filter(({ rule }) => rule === 'short-fall').length
  document.getElementById('comparison-correction-summary').textContent = comparisonCorrections.checked
    ? `${hooks} compact-hook / ${falls} short-fall corrections. Unmatched strokes retain their previous geometry.`
    : 'Terminal corrections off. Previous E geometry, including the full median hook return and curved dots.'
  renderComparisonCount()
}

function renderComparisonBulkSummary() {
  let total = 0, hooks = 0, falls = 0
  for (const medians of Object.values(characterStrokeData)) {
    for (const median of medians) {
      total++
      const { rule } = correctMonolineTerminals(median)
      if (rule === 'compact-hook') hooks++
      if (rule === 'short-fall') falls++
    }
  }
  document.getElementById('comparison-bulk-summary').textContent = `Bulk scan at reference pen width 5.5: ${hooks} compact-hook and ${falls} short-fall candidates among ${total} raw strokes in ${Object.keys(characterStrokeData).length} characters. This scans source medians before reviewed entry cleanup; it does not apply changes to the exercise.`
}

function renderComparisonCharacter() {
  stopComparisonReplay()
  const native = comparisonCharacter.value
  const character = comparisonCharacters[native]
  const medians = characterStrokeData[native]
  const tea = native === comparisonTea
  const variants = [
    { id: 'glyph-hanzi', paths: characterStrokeOutlines[native], transform: characterStrokeOutlineTransform },
    { id: 'glyph-current', paths: medians.map(characterPath) },
    { id: 'glyph-animcjk', paths: tea ? animCjkTeaPaths : [], transform: 'translate(5 5) scale(0.087890625)' },
    { id: 'glyph-custom', paths: tea ? customTeaPaths : [] },
  ]
  for (const variant of variants) {
    if (variant.paths.length && variant.paths.length !== medians.length) {
      throw new Error(`${variant.id} has the wrong stroke count for ${native}.`)
    }
    const group = comparisonSvg('g')
    if (variant.transform) group.setAttribute('transform', variant.transform)
    variant.paths.forEach((d, index) => {
      group.append(comparisonSvg('path', { d, class: 'glyph-stroke', 'data-stroke': index + 1 }))
    })
    document.getElementById(variant.id).replaceChildren(group)
  }
  const overlay = comparisonSvg('g', { class: 'source-overlay', 'aria-hidden': 'true' })
  medians.forEach((points, index) => {
    overlay.append(comparisonSvg('polyline', {
      points: points.map((point) => point.join(',')).join(' '),
      class: 'source-centerline', 'data-stroke': index + 1,
    }))
  })
  document.getElementById('glyph-transformed').replaceChildren(overlay)
  document.getElementById('custom-card').hidden = !tea
  document.getElementById('animcjk-card').hidden = !tea
  document.getElementById('comparison-primary').classList.toggle('without-custom', !tea)
  document.getElementById('comparison-reference-label').textContent = tea
    ? 'Other references / B: AnimCJK and C: previous renderer'
    : 'Other reference / C: previous renderer (B and D are tea-only studies)'
  document.getElementById('comparison-native').textContent = native
  document.getElementById('comparison-subtitle').textContent = `${character.pronunciation} / ${character.meaning} / ${medians.length} ${medians.length === 1 ? 'stroke' : 'strokes'}`
  document.title = `${character.name} / Monoline writing study`
  comparisonSlider.max = String(medians.length)
  comparisonSlider.value = String(medians.length)
  renderComparisonTransformed()
}

function renderComparisonCount() {
  const count = Number(comparisonSlider.value)
  const total = Number(comparisonSlider.max)
  document.getElementById('comparison-count').value = `${count} / ${total}`
  for (const path of document.querySelectorAll('[data-stroke]')) {
    path.classList.toggle('future', Number(path.dataset.stroke) > count)
  }
  comparisonStatus.textContent = count === total
    ? `All ${total} ${total === 1 ? 'stroke shown' : 'strokes shown'}. Writing uses E at width 5.5 with terminal refinement on.`
    : `${count} of ${total} strokes shown in each available design. Source stroke orders are preserved.`
}
function stopComparisonReplay() {
  clearInterval(comparisonTimer)
  comparisonTimer = null
  comparisonReplay.textContent = 'Replay strokes'
}
comparisonCharacter.addEventListener('change', renderComparisonCharacter)
comparisonWidth.addEventListener('input', (event) => {
  document.documentElement.style.setProperty('--study-pen-width', event.target.value)
  document.getElementById('comparison-width-value').value = event.target.value
  renderComparisonTransformed()
})
comparisonCorrections.addEventListener('change', renderComparisonTransformed)
document.getElementById('comparison-source').addEventListener('change', (event) => {
  document.body.dataset.showSource = String(event.target.checked)
})
comparisonSlider.addEventListener('input', () => {
  stopComparisonReplay()
  renderComparisonCount()
})
comparisonReplay.addEventListener('click', () => {
  if (comparisonTimer !== null) {
    stopComparisonReplay()
    return
  }
  comparisonSlider.value = '0'
  renderComparisonCount()
  comparisonReplay.textContent = 'Pause replay'
  comparisonTimer = setInterval(() => {
    comparisonSlider.value = String(Number(comparisonSlider.value) + 1)
    renderComparisonCount()
    if (comparisonSlider.value === comparisonSlider.max) stopComparisonReplay()
  }, 650)
})
document.getElementById('comparison-full').addEventListener('click', () => {
  stopComparisonReplay()
  comparisonSlider.value = comparisonSlider.max
  renderComparisonCount()
})
document.getElementById('comparison-ghost').addEventListener('change', (event) => {
  document.body.dataset.showRemaining = String(event.target.checked)
})
document.getElementById('comparison-theme').addEventListener('click', (event) => {
  const dark = document.documentElement.dataset.theme !== 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  event.currentTarget.textContent = dark ? 'Light background' : 'Dark background'
  event.currentTarget.setAttribute('aria-pressed', String(dark))
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopComparisonReplay()
})
renderComparisonBulkSummary()
renderComparisonCharacter()
