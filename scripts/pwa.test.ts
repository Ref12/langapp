// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { pwa } from './pwa'

type Emitted = { fileName: string; source: string }

function build(bundle: Record<string, unknown>) {
  const files: Emitted[] = []
  const plugin = pwa() as unknown as { generateBundle: (this: { emitFile: (f: Emitted) => void }, o: unknown, b: unknown) => void }
  plugin.generateBundle.call({ emitFile: f => files.push(f) }, {}, bundle)
  return Object.fromEntries(files.map(f => [f.fileName, f.source]))
}

describe('PWA plugin', () => {
  const out = build({ 'index.html': {}, 'assets/index-a.js': {}, 'assets/index-a.css': {} })

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

  it('emits a worker with relative precache that never touches IndexedDB or leaves its scope', () => {
    const sw = out['sw.js']
    expect(sw).toContain('"./assets/index-a.js"')
    expect(sw.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/indexedDB|\bIDB|\.unregister\(/i)
    expect(sw).toContain('self.registration.scope')
    const handlers = new Map<string, unknown>()
    runInNewContext(sw, { self: { addEventListener: (n: string, h: unknown) => handlers.set(n, h), registration: { scope: 'https://x.test/apps/lang/' } }, caches: {}, location: { origin: 'https://x.test' } })
    expect([...handlers.keys()].sort()).toEqual(['activate', 'fetch', 'install'])
  })
})
