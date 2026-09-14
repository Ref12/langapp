// Like the other mockup preferences, appearance lasts for this page visit.
function setMockupTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') throw new Error(`Unknown mockup theme: ${theme}`)
  document.documentElement.dataset.theme = theme
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const label = button.querySelector('[data-theme-label]')
    if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light'
    const action = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
    button.setAttribute('aria-label', label ? `Appearance: ${label.textContent}. ${action}` : action)
    button.querySelector('use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon')
  })
  document.dispatchEvent(new Event('mockup-theme-changed'))
  if (window.parent !== window) window.parent.postMessage({ type: 'mockup-theme', theme }, '*')
}
document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => setMockupTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
})
setMockupTheme('dark')
