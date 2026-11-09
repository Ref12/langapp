// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { pwa } from './pwa'

type Emitted = { fileName: string; source: string }

async function build(bundle: Record<string, unknown>) {
  const files: Emitted[] = []
  const plugin = pwa() as unknown as { generateBundle: (this: { emitFile: (f: Emitted) => void }, o: unknown, b: unknown) => Promise<void> }
  await plugin.generateBundle.call({ emitFile: f => files.push(f) }, {}, bundle)
  return Object.fromEntries(files.map(f => [f.fileName, f.source]))
}

describe('PWA plugin', async () => {
  const out = await build({ 'index.html': {}, 'assets/index-a.js': {}, 'assets/index-a.css': {} })

  it('emits a relative manifest usable at any path', () => {
    const manifest = JSON.parse(out['manifest.webmanifest'])
    expect([manifest.id, manifest.scope, manifest.start_url]).toEqual(['./', './', './'])
    expect(manifest.icons[0].src).toBe('icon.svg')
  })

  it('injects the manifest link with credentials so it loads behind Cloudflare Access', () => {
    const plugin = pwa() as unknown as { transformIndexHtml: () => { tag: string; attrs: Record<string, string> }[] }
    const link = plugin.transformIndexHtml().find(t => t.tag === 'link' && t.attrs.rel === 'manifest')
    expect(link?.attrs).toEqual({ rel: 'manifest', href: './manifest.webmanifest', crossorigin: 'use-credentials' })
  })

  it('emits a worker with relative precache that never touches IndexedDB or leaves its scope, and has no backup code', () => {
    const sw = out['sw.js']
    expect(sw).toContain('"./assets/index-a.js"')
    expect(sw.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/indexedDB|\bIDB|\.unregister\(/i)
    expect(sw).toContain('self.registration.scope')
    expect(sw.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/importScripts|\bsync\b|periodicsync|backup/i)
    expect(out['backup-sw.js']).toBeUndefined()
    const handlers = new Map<string, unknown>()
    runInNewContext(sw, { self: { addEventListener: (n: string, h: unknown) => handlers.set(n, h), registration: { scope: 'https://x.test/apps/lang/' } }, caches: {}, location: { origin: 'https://x.test' } })
    expect([...handlers.keys()].sort()).toEqual(['activate', 'fetch', 'install'])
  })

  // Runs the emitted worker against an in-memory Cache Storage that, like the real one, lets caches.match search every cache of the origin.
  async function worker(scope: string, seed: Record<string, Record<string, string>> = {}) {
    const stores = new Map<string, Map<string, string>>(Object.entries(seed).map(([name, entries]) => [name, new Map(Object.entries(entries))]))
    const cacheOf = (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return { match: async (r: string | { url: string }) => store.get(typeof r === 'string' ? r : r.url), put: async (r: { url: string }, res: { clone(): unknown }) => { store.set(r.url, (res.clone() as { body: string }).body) }, addAll: async (urls: string[]) => { for (const u of urls) store.set(new URL(u, scope).href, 'new:' + u) } }
    }
    const caches = {
      open: async (name: string) => cacheOf(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (r: string | { url: string }) => { for (const store of stores.values()) { const hit = store.get(typeof r === 'string' ? r : r.url); if (hit !== undefined) return hit } return undefined },
    }
    const handlers = new Map<string, (event: unknown) => void>()
    const network: string[] = []
    const fetchFn = async (r: { url: string }) => { network.push(r.url); return { ok: true, body: 'net:' + r.url, clone() { return this } } }
    const self = { addEventListener: (n: string, h: (event: unknown) => void) => handlers.set(n, h), registration: { scope }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } }
    runInNewContext(out['sw.js'], { self, caches, fetch: fetchFn, location: { origin: new URL(scope).origin }, URL })
    const wait = async (name: string) => { let p: Promise<unknown> = Promise.resolve(); handlers.get(name)!({ waitUntil: (x: Promise<unknown>) => { p = x } }); await p }
    const request = async (url: string, mode = 'cors') => {
      let handled: Promise<unknown> | undefined
      handlers.get('fetch')!({ request: { method: 'GET', url, mode }, respondWith: (p: Promise<unknown>) => { handled = p } })
      return { handled: handled !== undefined, body: await handled }
    }
    return { stores, network, wait, request }
  }

  for (const scope of ['https://x.test/', 'https://x.test/apps/lang/']) {
    describe(`service worker at ${scope}`, () => {
      it('never handles, serves or caches anything under lab/ (relative to its own scope)', async () => {
        const w = await worker(scope, { 'linguaweave-stable-runtime': { [scope + 'lab/assets/a.js']: 'stale' } })
        await w.wait('install'); await w.wait('activate')
        for (const path of ['lab/', 'lab', 'lab/index.html', 'lab/assets/a.js', 'lab/sw.js', 'lab/?x=1']) {
          for (const mode of ['navigate', 'cors']) expect((await w.request(scope + path, mode)).handled, path).toBe(false)
        }
        expect(w.network).toEqual([])
        expect([...w.stores.get('linguaweave-stable-runtime')!.keys()]).toEqual([scope + 'lab/assets/a.js'])
        for (const [name, store] of w.stores) if (name.startsWith('linguaweave-stable-shell-')) expect([...store.keys()].filter(k => k.includes('/lab/'))).toEqual([])
        // Neighbours of the name are Stable's: labs/ and a file called lab.js are not Lab.
        expect((await w.request(scope + 'labs/x.js')).handled).toBe(true)
        expect((await w.request(scope + 'assets/lab.js')).handled).toBe(true)
      })

      it('uses cache names that main has deployed nowhere, and ignores a main build cached at the same scope', async () => {
        const w = await worker(scope, {
          'linguaweave-shell-mqx1': { [scope]: 'OLD INDEX', [scope + 'index.html']: 'OLD INDEX', [scope + 'assets/index-a.js']: 'OLD JS' },
          'linguaweave-runtime': { [scope + 'assets/index-a.js']: 'OLD RUNTIME JS' },
        })
        await w.wait('install'); await w.wait('activate')
        const names = [...w.stores.keys()]
        expect(names.filter(n => !['linguaweave-shell-mqx1', 'linguaweave-runtime'].includes(n)).every(n => /^linguaweave-stable-(shell-.+|runtime)$/.test(n))).toBe(true)
        expect(names).toContain('linguaweave-shell-mqx1') // main's caches are left alone (Lab shares the origin and may own them)
        expect(names).toContain('linguaweave-runtime')
        // Assets come from Stable's own precache or the network, never from main's cache.
        const asset = await w.request(scope + 'assets/index-a.js')
        expect(asset.body).not.toMatch(/OLD/)
        // Offline navigation falls back to Stable's index only.
        const offline = await worker(scope, { 'linguaweave-shell-mqx1': { [scope]: 'OLD INDEX' } })
        await offline.wait('install')
        const fetchless = (await offline.request(scope, 'navigate')).body
        expect(fetchless).not.toBe('OLD INDEX')
      })

      it('removes only its own older shell caches on activate', async () => {
        const w = await worker(scope, { 'linguaweave-stable-shell-old': { x: '1' }, 'linguaweave-shell-main': { x: '1' } })
        await w.wait('install'); await w.wait('activate')
        const names = [...w.stores.keys()]
        expect(names).toHaveLength(2)
        expect(names).toContain('linguaweave-shell-main')
        expect(names.some(n => /^linguaweave-stable-shell-(?!old$)/.test(n))).toBe(true)
        expect(w.stores.has('linguaweave-stable-shell-old')).toBe(false)
      })
    })
  }
})
