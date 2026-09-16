const frame = document.querySelector('#prototype-frame')
const screens = { overview: 'Overview', library: 'Library', discover: 'Library / Discover', reader: 'Library / Reading', lessons: 'Lessons', practice: 'Practice / Exercises', review: 'Practice / Exercises / Review', characters: 'Dictionary / Writing', conversation: 'Assistant', dictionary: 'Dictionary', games: 'Practice / Games' }
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
  if (event.data?.type === 'mockup-theme') {
    if (event.data.theme === 'dark' || event.data.theme === 'light') document.documentElement.dataset.theme = event.data.theme
    return
  }
  if (event.data?.type !== 'mockup-route' || !Object.hasOwn(screens, event.data.screen)) return
  if (requestedScreen && requestedScreen !== event.data.screen && requestedScreen !== event.data.redirectedFrom) return
  requestedScreen = null
  if (location.hash !== `#${event.data.screen}`) {
    history.replaceState(null, '', `#${event.data.screen}`)
    document.title = `${screens[event.data.screen]} / LinguaWeave UI concept`
    document.querySelector('#open-app').href = `./app.html#${event.data.screen}`
  }
})
