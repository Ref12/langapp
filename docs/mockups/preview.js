const frame = document.querySelector('#prototype-frame')
const stage = document.querySelector('#preview-stage')
const screens = { overview: 'Overview', library: 'Library', reader: 'Library / Reading', lessons: 'Lessons', practice: 'Practice / Exercises', review: 'Practice / Exercises / Review', characters: 'Practice / Exercises / Characters', conversation: 'Assistant', dictionary: 'Dictionary', games: 'Practice / Games' }
let frameReady = false
let requestedScreen = null
function currentScreen() {
  return Object.hasOwn(screens, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'
}
function updatePreviewRoute() {
  const screen = currentScreen()
  document.title = `${screens[screen]} / LinguaWeave UI concept`
  document.querySelector('#open-app').href = `./app.html#${screen}`
  // File previews have opaque origins; messages contain only an allowlisted screen ID.
  if (frameReady) {
    requestedScreen = screen
    frame.contentWindow.postMessage({ type: 'mockup-navigate', screen }, '*')
  }
}
frame.addEventListener('load', () => {
  frameReady = true
  updatePreviewRoute()
})
window.addEventListener('hashchange', updatePreviewRoute)
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return
  if (!frameReady) return
  if (location.protocol !== 'file:' && event.origin !== location.origin) return
  if (event.data?.type !== 'mockup-route' || !Object.hasOwn(screens, event.data.screen)) return
  if (requestedScreen && requestedScreen !== event.data.screen) return
  requestedScreen = null
  if (location.hash !== `#${event.data.screen}`) {
    history.replaceState(null, '', `#${event.data.screen}`)
    document.title = `${screens[event.data.screen]} / LinguaWeave UI concept`
    document.querySelector('#open-app').href = `./app.html#${event.data.screen}`
  }
})
document.querySelectorAll('[data-device]').forEach((button) => {
  if (button.tagName !== 'BUTTON') return
  button.addEventListener('click', () => {
    stage.dataset.device = button.dataset.device
    document.querySelectorAll('button[data-device]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button))
    })
  })
})
new ResizeObserver(() => {
  document.querySelector('#viewport-size').textContent = `${frame.clientWidth} \u00d7 ${frame.clientHeight}`
}).observe(frame)
