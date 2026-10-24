import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../docs/mockups/theme.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// Only the hexad deployment (LANGAPP_PWA=1) ships a service worker; GitHub Pages and dev do not.
if (import.meta.env.VITE_LANGAPP_PWA === '1' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }) })
}
