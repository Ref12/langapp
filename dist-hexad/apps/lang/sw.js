// LinguaWeave service worker (hexad deployment). Caches only this scope; never touches IndexedDB.
const CACHE = 'linguaweave-shell-mvmytmda'
const RUNTIME = 'linguaweave-runtime'
const PRECACHE = ["./","./assets/index-BqgfVLWY.css","./assets/index-CZKJv53D.js","./assets/hsk-1.generated-Cz32jQ3u.js","./assets/hsk-2.generated-DQ0pZj7D.js","./assets/hsk-3.generated-BhgT5zCf.js","./assets/hsk-4.generated-y9L0h_d9.js","./assets/hsk-5.generated-DCsDGXMQ.js","./assets/hsk-6.generated-aIPDKODt.js","./assets/practice-chain-CEMq_Rlk.js","./assets/microsoft.cognitiveservices.speech.sdk-D3Nykjyk.js","./assets/pcm-worklet-DIpk5Fiz.js","./assets/sudoku.worker-Bys9EQRc.js","./icon.svg"]
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
