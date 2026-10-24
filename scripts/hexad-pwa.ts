import type { Plugin } from 'vite'

/**
 * Hexad-only PWA: emits a web manifest and a service worker for the build served at
 * /apps/langapp/. Enabled with LANGAPP_PWA=1; the GitHub Pages build does not use it.
 * The worker only touches same-origin GET requests inside its own scope and never
 * touches IndexedDB, so learning data is never cleared.
 */
export function hexadPwa(): Plugin {
  return {
    name: 'hexad-pwa',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
    ],
    generateBundle(_options, bundle) {
      const precache = ['./', ...Object.keys(bundle).filter(name => /\.(js|css|html|svg)$/.test(name)).map(name => './' + name), './icon.svg']
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify({
          id: './',
          name: 'LinguaWeave',
          short_name: 'LinguaWeave',
          description: 'Learn languages through reading and conversation.',
          start_url: './',
          scope: './',
          display: 'standalone',
          theme_color: '#0d1117',
          background_color: '#0d1117',
          icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        }, null, 2),
      })
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(Array.from(new Set(precache))) })
    },
  }
}

function serviceWorker(precache: string[]): string {
  const version = Date.now().toString(36)
  return `// LinguaWeave service worker (hexad deployment). Caches only this scope; never touches IndexedDB.
const CACHE = 'linguaweave-shell-${version}'
const RUNTIME = 'linguaweave-runtime'
const PRECACHE = ${JSON.stringify(precache)}
const scope = self.registration.scope

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('linguaweave-shell-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Only this scope: AI gateway calls (/v1/...), hexad itself and other origins pass through untouched.
  if (url.origin !== location.origin || !url.href.startsWith(scope)) return
  if (url.pathname.endsWith('/sw.js')) return
  // The archived v1 app has its own narrower registration and caches; never answer its pages or assets.
  if (url.pathname.startsWith(new URL('v1/', scope).pathname)) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(scope, { ignoreSearch: true }).then(hit => hit || caches.match(scope + 'index.html'))))
    return
  }
  event.respondWith(caches.open(RUNTIME).then(async runtime => {
    const hit = (await caches.match(request)) || (await runtime.match(request))
    const network = fetch(request).then(response => {
      if (response.ok) runtime.put(request, response.clone())
      return response
    })
    if (hit) { network.catch(() => undefined); return hit }
    return network
  }))
})
`
}
