const frame = document.querySelector('#prototype-frame')
const appUrl = new URL('../index.html', location.href)
const appDirectory = new URL('./', appUrl).pathname
let themeObserver

function requestedAppUrl() {
  const url = new URL(appUrl)
  url.hash = location.hash || '#overview'
  return url
}

function appWindow() {
  const child = frame.contentWindow
  try {
    if (child.location.origin === appUrl.origin && [appUrl.pathname, appDirectory].includes(child.location.pathname)) return child
  } catch (error) {
    if (error.name !== 'SecurityError') throw error
    console.warn('Route tracking is unavailable outside the local app preview.')
  }
}

function syncFromApp() {
  const child = appWindow()
  if (!child) return
  const hash = child.location.hash || '#overview'
  if (location.hash !== hash) history.replaceState(null, '', hash)
  const url = new URL(appUrl)
  url.hash = hash
  document.querySelector('#open-app').href = url.href
  const theme = child.document.documentElement.dataset.theme
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
  document.title = `${child.document.title || 'LinguaWeave'} / App preview`
}

frame.addEventListener('load', () => {
  themeObserver?.disconnect()
  const child = appWindow()
  if (!child) return
  child.addEventListener('hashchange', syncFromApp)
  themeObserver = new MutationObserver(syncFromApp)
  themeObserver.observe(child.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  themeObserver.observe(child.document.head, { childList: true, subtree: true, characterData: true })
  syncFromApp()
})

window.addEventListener('hashchange', () => {
  const child = appWindow()
  const url = requestedAppUrl()
  document.querySelector('#open-app').href = url.href
  if (child) {
    if (child.location.hash !== url.hash) child.location.replace(url.href)
  } else {
    frame.src = url.href
  }
})

document.querySelector('#open-app').href = requestedAppUrl().href
frame.src = requestedAppUrl().href
