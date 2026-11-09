import type { Plugin } from 'vite'
import { storageNames, type BuildChannel } from '../src/core/storage-names'

/**
 * PWA for every production build: emits a web manifest and a service worker. All URLs
 * (id, scope, start_url, precache) are relative, so the same build works at
 * https://ref12.github.io/langapp/ and when proxied under another path such as /apps/lang/.
 * The service worker replaces the retired root worker at the same URL. It only touches same-origin GET requests inside its own scope and never
 * touches IndexedDB, so learning data is never cleared.
 */
export function pwa(channel: BuildChannel = 'lab'): Plugin {
  const names = storageNames(channel)
  // One id per build: baked into the bundle (`__APP_BUILD__`) and published as version.json, so a running tab can tell whether a newer deploy exists.
  // LANGAPP_BUILD_ID (the workflow sets it to the checkout's commit sha) makes a rebuild of the same commit identical; local builds stay unique.
  const build = process.env.LANGAPP_BUILD_ID?.trim() || Date.now().toString(36)
  return {
    name: 'langapp-pwa',
    apply: 'build',
    config: () => ({ define: { __APP_BUILD__: JSON.stringify(build) } }),
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest', crossorigin: 'use-credentials' }, injectTo: 'head' },
    ],
    generateBundle(_options, bundle) {
      const precache = ['./', ...Object.keys(bundle).filter(name => /\.(js|css|html|svg)$/.test(name)).map(name => './' + name), './icon.svg']
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify({
          id: './',
          name: channel === 'lab' ? 'LinguaWeave Lab' : 'LinguaWeave',
          short_name: channel === 'lab' ? 'LW Lab' : 'LinguaWeave',
          description: 'Learn languages through reading and conversation.',
          start_url: './',
          scope: './',
          display: 'standalone',
          theme_color: '#0d1117',
          background_color: '#0d1117',
          icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        }, null, 2),
      })
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) })
      this.emitFile({ type: 'asset', fileName: names.serviceWorkerFile, source: serviceWorker(Array.from(new Set(precache)), names, build) })
    },
  }
}

function serviceWorker(precache: string[], names: ReturnType<typeof storageNames>, version: string): string {
  return `// LinguaWeave service worker (relative scope). Caches only this scope; never touches IndexedDB.
const CACHE = ${JSON.stringify(names.cache.shell(version))}
const CACHE_PREFIX = ${JSON.stringify(names.cache.shellPrefix)}
const RUNTIME = ${JSON.stringify(names.cache.runtime)}
const PRECACHE = ${JSON.stringify(precache)}
const scope = self.registration.scope

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Only this scope: AI gateway calls and other origins pass through untouched.
  if (url.origin !== location.origin || !url.href.startsWith(scope)) return
  if (url.pathname.endsWith('/' + ${JSON.stringify(names.serviceWorkerFile)})) return
  // version.json is how a stale tab learns about a newer deploy: always from the network, never stored.
  if (url.pathname.endsWith('/version.json')) return
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
