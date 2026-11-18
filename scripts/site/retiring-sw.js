// LinguaWeave retiring service worker. It is published at the URL of a worker an older deploy registered (sw.js at the site root, lab/sw-lab.js,
// lab/ja/sw-lab-ja.js, lab/ko/sw-lab-ko.js). Visitors who have the old worker get this one at their next visit: it takes over at once,
// removes its own registration and sends the open pages of its scope to the new place of the app, keeping the query and the hash.
// It deletes no cache and no database: the new builds keep the old Lab cache names, and learning data is never touched here.
const TARGET = '__TARGET__' // relative to this worker's scope

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only the pages this worker controlled: a page of another app (stable/) is never moved.
    const pages = await self.clients.matchAll({ type: 'window' })
    await self.registration.unregister()
    const place = new URL(TARGET, self.registration.scope)
    await Promise.all(pages.map(page => {
      const from = new URL(page.url)
      const to = new URL(place.href)
      to.search = from.search
      to.hash = from.hash
      return page.navigate(to.href).catch(() => undefined)
    }))
  })())
})
