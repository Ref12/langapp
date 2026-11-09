// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { pwa } from './pwa'

type Emitted = { fileName: string; source: string }

async function build(bundle: Record<string, unknown>) {
  const files: Emitted[] = []
  const plugin = pwa('stable') as unknown as { generateBundle: (this: { emitFile: (f: Emitted) => void }, o: unknown, b: unknown) => Promise<void> }
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
    const plugin = pwa('stable') as unknown as { transformIndexHtml: () => { tag: string; attrs: Record<string, string> }[] }
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
})

describe('PWA plugin, lab channel', () => {
  it('has its own worker file, caches and manifest name, and cleans up only its own caches', async () => {
    const files: Emitted[] = []
    const plugin = pwa('lab') as unknown as { generateBundle: (this: { emitFile: (f: Emitted) => void }, o: unknown, b: unknown) => Promise<void> }
    await plugin.generateBundle.call({ emitFile: f => files.push(f) }, {}, { 'index.html': {} })
    const out = Object.fromEntries(files.map(f => [f.fileName, f.source]))
    expect(out['sw.js']).toBeUndefined()
    const sw = out['sw-lab.js']
    expect(sw).toContain('"lab.linguaweave-runtime"')
    expect(sw).toMatch(/"lab\.linguaweave-shell-[a-z0-9]+"/)
    expect(sw).toContain('"lab.linguaweave-shell-"')
    expect(sw).not.toMatch(/['"]linguaweave-(shell|runtime)/)
    expect(JSON.parse(out['manifest.webmanifest']).name).toBe('LinguaWeave Lab')
    expect(JSON.parse(out['manifest.webmanifest']).scope).toBe('./')
  })
})

describe('PWA plugin, build id and version.json', () => {
  const emit = async (id: string | undefined) => {
    const saved = process.env.LANGAPP_BUILD_ID
    if (id === undefined) delete process.env.LANGAPP_BUILD_ID; else process.env.LANGAPP_BUILD_ID = id
    try { return await build({ 'index.html': {}, 'assets/index-a.js': {} }) } finally { if (saved === undefined) delete process.env.LANGAPP_BUILD_ID; else process.env.LANGAPP_BUILD_ID = saved }
  }
  const workerFile = (out: Record<string, string>) => Object.keys(out).find(name => /^sw(-lab)?\.js$/.test(name)) as string

  it('takes the id from LANGAPP_BUILD_ID, so the same commit builds the same files, and publishes it as version.json', async () => {
    const [a, b, other] = [await emit('abc123'), await emit('abc123'), await emit('def456')]
    expect(JSON.parse(a['version.json'])).toEqual({ build: 'abc123' })
    expect(a).toEqual(b)
    expect(a[workerFile(a)]).not.toEqual(other[workerFile(other)])
  })

  it('keeps unique ids for local builds without the variable', async () => {
    const id = JSON.parse((await emit(undefined))['version.json']).build
    expect(id).toMatch(/^[a-z0-9]+$/)
  })

  it('passes version.json straight to the network and never stores it', async () => {
    const out = await emit('abc123')
    const handlers = new Map<string, (event: unknown) => void>()
    runInNewContext(out[workerFile(out)], { self: { addEventListener: (n: string, h: (event: unknown) => void) => handlers.set(n, h), registration: { scope: 'https://x.test/apps/lang/' } }, URL, fetch: async () => ({ ok: false }), caches: { open: async () => ({ match: async () => undefined, put: () => undefined }), match: async () => undefined }, location: { origin: 'https://x.test' } })
    const answered: string[] = []
    const ask = (path: string) => handlers.get('fetch')!({ request: { method: 'GET', url: 'https://x.test/apps/lang/' + path, mode: 'cors' }, respondWith: () => answered.push(path) })
    ask('version.json?1731192000000')
    ask('version.json')
    expect(answered).toEqual([])
    ask('assets/index-a.js')
    expect(answered).toEqual(['assets/index-a.js'])
  })
})
