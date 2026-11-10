// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { metaFor } from '../src/core/language/meta'
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

describe('PWA plugin, language builds', () => {
  const emitFor = async (language: 'zh' | 'ja' | 'ko') => {
    const files: Emitted[] = []
    const plugin = pwa('lab', language) as unknown as { generateBundle: (this: { emitFile: (f: Emitted) => void }, o: unknown, b: unknown) => Promise<void> }
    await plugin.generateBundle.call({ emitFile: f => files.push(f) }, {}, { 'index.html': {}, 'assets/index-a.js': {} })
    return Object.fromEntries(files.map(f => [f.fileName, f.source]))
  }
  type Handler = (event: unknown) => void
  const worker = (source: string, scope: string) => {
    const handlers = new Map<string, Handler>()
    const fetched: string[] = []
    const cacheNames: string[] = []
    const deleted: string[] = []
    const hits: Record<string, string> = {}
    runInNewContext(source, {
      self: { addEventListener: (n: string, h: Handler) => handlers.set(n, h), registration: { scope }, clients: { claim: async () => undefined }, skipWaiting: () => undefined },
      URL, location: { origin: 'https://x.test' },
      fetch: async (request: { url: string }) => { fetched.push(request.url); return { ok: false } },
      caches: { open: async (name: string) => { cacheNames.push(name); return { match: async () => undefined, put: () => undefined, addAll: async () => undefined } }, match: async (request: { url: string }) => hits[request.url], keys: async () => ['lab.linguaweave-shell-old', 'lab.ja.linguaweave-shell-old', 'lab.ko.linguaweave-shell-old', 'linguaweave-shell-old', 'unrelated'], delete: async (name: string) => { deleted.push(name) } },
    })
    const answered: string[] = []
    const ask = (path: string, mode = 'cors') => handlers.get('fetch')!({ request: { method: 'GET', url: scope + path, mode }, respondWith: () => answered.push(path) })
    return { ask, answered, handlers, cacheNames, deleted }
  }

  it('passes every request under lab/ja/ and lab/ko/ straight to the network from the Lab Chinese worker, and still serves its own pages', async () => {
    const out = await emitFor('zh')
    const sw = worker(out['sw-lab.js'], 'https://x.test/lab/')
    for (const path of ['ja', 'ja/', 'ja/index.html', 'ja/assets/index-a.js', 'ja/sw-lab-ja.js', 'ja/manifest.webmanifest', 'ko/', 'ko/assets/x.css?v=1', 'ja?x=1']) {
      sw.ask(path, 'navigate'); sw.ask(path)
    }
    expect(sw.answered).toEqual([])
    sw.ask('', 'navigate'); sw.ask('assets/index-a.js'); sw.ask('jazz.js'); sw.ask('kodak/a.js')
    expect(sw.answered).toEqual(['', 'assets/index-a.js', 'jazz.js', 'kodak/a.js'])
  })

  it('has no language-folder rule in a language build (its scope is its own folder) and keeps only its own caches', async () => {
    const out = await emitFor('ja')
    const source = out['sw-lab-ja.js']
    expect(source).not.toContain('LANGUAGE_FOLDERS')
    expect(Object.keys(out).filter(name => name.startsWith('sw'))).toEqual(['sw-lab-ja.js'])
    expect(source).toContain('"lab.ja.linguaweave-runtime"')
    expect(source).toMatch(/"lab\.ja\.linguaweave-shell-[a-z0-9]+"/)
    expect(source).toContain('"lab.ja.linguaweave-shell-"')
    expect(source.replace(/"lab\.ja\.[^"]*"/g, '')).not.toMatch(/linguaweave-(shell|runtime)/)
    const sw = worker(source, 'https://x.test/lab/ja/')
    const waiting: Promise<unknown>[] = []
    sw.handlers.get('activate')!({ waitUntil: (p: Promise<unknown>) => waiting.push(p) })
    await Promise.all(waiting)
    expect(sw.deleted).toEqual(['lab.ja.linguaweave-shell-old'])
    const zh = worker((await emitFor('zh'))['sw-lab.js'], 'https://x.test/lab/')
    const zhWaiting: Promise<unknown>[] = []
    zh.handlers.get('activate')!({ waitUntil: (p: Promise<unknown>) => zhWaiting.push(p) })
    await Promise.all(zhWaiting)
    expect(zh.deleted).toEqual(['lab.linguaweave-shell-old'])
  })

  it('names the manifest after the language, and leaves the Chinese manifest as it was', async () => {
    const ja = JSON.parse((await emitFor('ja'))['manifest.webmanifest'])
    expect([ja.name, ja.short_name, ja.lang, ja.scope, ja.id]).toEqual(['LinguaWeave Lab Japanese', 'LW Lab Japanese', 'ja', './', './'])
    expect(JSON.parse((await emitFor('ko'))['manifest.webmanifest']).name).toBe('LinguaWeave Lab Korean')
    const zh = JSON.parse((await emitFor('zh'))['manifest.webmanifest'])
    expect(zh.name).toBe('LinguaWeave Lab')
    expect(zh.short_name).toBe('LW Lab')
    expect('lang' in zh).toBe(false)
  })

  it('titles the page of a language build, and leaves the Chinese page alone', () => {
    const html = '<!doctype html><html lang="en"><head><title>LinguaWeave</title></head></html>'
    const ja = (pwa('lab', 'ja') as unknown as { transformIndexHtml: (html: string) => { html: string } }).transformIndexHtml(html)
    expect(ja.html).toContain('<title>LinguaWeave Lab Japanese</title>')
    expect(ja.html).toContain('<html lang="en"')
    expect(Array.isArray((pwa('lab', 'zh') as unknown as { transformIndexHtml: () => unknown }).transformIndexHtml())).toBe(true)
  })

  it('gives a language build its own description, from the pack; Chinese is the text index.html has', () => {
    const index = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    const meta = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1]
    expect(metaFor('zh').pageDescription).toBe(meta(index))
    const html = (language: 'ja' | 'ko') => (pwa('lab', language) as unknown as { transformIndexHtml: (html: string) => { html: string } }).transformIndexHtml(index).html
    expect(meta(html('ja'))).toBe(metaFor('ja').pageDescription)
    expect(meta(html('ja'))).not.toMatch(/Mandarin/)
    expect(meta(html('ko'))).toBe(metaFor('ko').pageDescription)
  })
})
