const comparisonTea = '\u8336'
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
const comparisonVariants = [
  { id: 'glyph-hanzi', paths: characterStrokeOutlines[comparisonTea], transform: characterStrokeOutlineTransform },
  { id: 'glyph-animcjk', paths: animCjkTeaPaths, transform: 'translate(5 5) scale(0.087890625)' },
  { id: 'glyph-current', paths: characterStrokeData[comparisonTea].map(characterPath) },
  { id: 'glyph-custom', paths: customTeaPaths },
]
for (const variant of comparisonVariants) {
  if (variant.paths.length !== 9) throw new Error(`${variant.id} must have nine strokes for tea.`)
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  if (variant.transform) group.setAttribute('transform', variant.transform)
  variant.paths.forEach((d, index) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', 'glyph-stroke')
    path.dataset.stroke = String(index + 1)
    group.append(path)
  })
  document.getElementById(variant.id).append(group)
}

const comparisonSlider = document.getElementById('comparison-strokes')
const comparisonReplay = document.getElementById('comparison-replay')
const comparisonStatus = document.getElementById('comparison-status')
let comparisonTimer = null

function renderComparisonCount() {
  const count = Number(comparisonSlider.value)
  document.getElementById('comparison-count').value = `${count} / 9`
  for (const path of document.querySelectorAll('.glyph-stroke')) {
    path.classList.toggle('future', Number(path.dataset.stroke) > count)
  }
  comparisonStatus.textContent = count === 9
    ? 'All nine strokes shown. This is an artwork comparison, not a handwriting quiz.'
    : `${count} of 9 strokes shown in each design. Source stroke orders are preserved.`
}
function stopComparisonReplay() {
  clearInterval(comparisonTimer)
  comparisonTimer = null
  comparisonReplay.textContent = 'Replay strokes'
}
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
    if (Number(comparisonSlider.value) === 9) stopComparisonReplay()
  }, 650)
})
document.getElementById('comparison-full').addEventListener('click', () => {
  stopComparisonReplay()
  comparisonSlider.value = '9'
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
renderComparisonCount()
