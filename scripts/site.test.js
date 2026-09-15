// @vitest-environment node
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { buildSite } from './build-site.mjs'

const retirementWorker = readFileSync(resolve('public', 'sw.js'), 'utf8')

describe('mockup site assembly', () => {
  it('publishes the app and all local assets without replacing v1 or shipping test fixtures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'langapp-site-'))
    const output = pathToFileURL(directory + '/')
    try {
      await mkdir(new URL('v1/', output))
      await writeFile(new URL('v1/index.html', output), 'Archived app')
      await buildSite(output)
      await buildSite(output)

      const entry = await readFile(new URL('index.html', output), 'utf8')
      expect(entry).toBe(readFileSync(resolve('docs', 'mockups', 'app.html'), 'utf8'))
      expect(entry).not.toContain('<iframe')
      expect(await readFile(new URL('v1/index.html', output), 'utf8')).toBe('Archived app')
      expect(await readFile(new URL('preview.html', output), 'utf8'))
        .toBe(readFileSync(resolve('docs', 'mockups', 'index.html'), 'utf8'))
      expect(await readFile(new URL('sw.js', output), 'utf8')).toBe(retirementWorker)

      for (const page of ['index.html', 'preview.html', 'app.html', 'writing-comparison.html']) {
        const markup = await readFile(new URL(page, output), 'utf8')
        for (const [, asset] of markup.matchAll(/(?:href|src)="\.\/([^"#]+)(?:#[^"]*)?"/g)) {
          expect((await readFile(new URL(asset, output))).byteLength).toBeGreaterThan(0)
          for (const base of ['https://example.test/', 'https://example.test/langapp/']) {
            expect(new URL(`./${asset}`, base + page).pathname).toBe(new URL(asset, base).pathname)
          }
        }
      }
      expect(await readFile(new URL('exercise-cafe.svg', output), 'utf8')).toContain('<svg')
      expect(await readFile(new URL('character-data-LICENSE.txt', output), 'utf8')).toContain('ARPHIC')
      const published = await readdir(directory)
      expect(published.some(name => name.includes('.test.'))).toBe(false)
      expect(published).not.toContain('README.md')
      expect(published).not.toContain('previews')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('retires only the old root worker without reloading clients or clearing caches', async () => {
    const handlers = new Map()
    const skipWaiting = vi.fn()
    const unregister = vi.fn().mockResolvedValue(undefined)
    runInNewContext(retirementWorker, {
      self: {
        addEventListener: (name, handler) => handlers.set(name, handler),
        skipWaiting,
        registration: { unregister },
      },
    })
    const pending = []
    const event = { waitUntil: promise => { pending.push(promise) } }
    handlers.get('install')(event)
    handlers.get('activate')(event)
    await Promise.all(pending)
    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
    expect(handlers.has('fetch')).toBe(false)
  })
})
