import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installUpdateGuard } from './core/appUpdate'
import { storageNames } from './core/storage-names'
import '../docs/mockups/theme.css'

installUpdateGuard()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// Production builds ship the scoped service worker; the dev server does not.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}${storageNames().serviceWorkerFile}`, { scope: import.meta.env.BASE_URL }) })
}
