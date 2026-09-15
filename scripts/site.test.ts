import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const entry = readFileSync(resolve('index.html'), 'utf8')
const retirementWorker = readFileSync(resolve('public', 'sw.js'), 'utf8')

describe('v1 site entry', () => {
  it.each([
    ['https://example.test/', 'https://example.test/v1/'],
    ['https://example.test/#/dictionary', 'https://example.test/v1/#/dictionary'],
    ['https://example.test/langapp/', 'https://example.test/langapp/v1/'],
    ['https://example.test/langapp/index.html?from=bookmark#/settings',
      'https://example.test/langapp/v1/?from=bookmark#/settings'],
  ])('preserves the deployment prefix and route for %s', (href, destination) => {
    const url = new URL(href)
    const replace = vi.fn()
    const script = entry.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeDefined()
    runInNewContext(script!, {
      URL,
      window: { location: { href, search: url.search, hash: url.hash, replace } },
    })
    expect(replace).toHaveBeenCalledWith(destination)
  })

  it('retires only the old root worker without reloading clients or clearing caches', async () => {
    const handlers = new Map<string, (event: { waitUntil: (promise: Promise<void>) => void }) => void>()
    const skipWaiting = vi.fn()
    const unregister = vi.fn().mockResolvedValue(undefined)
    runInNewContext(retirementWorker, {
      self: {
        addEventListener: (name: string, handler: (event: { waitUntil: (promise: Promise<void>) => void }) => void) =>
          handlers.set(name, handler),
        skipWaiting,
        registration: { unregister },
      },
    })
    const pending: Promise<void>[] = []
    const event = { waitUntil: (promise: Promise<void>) => { pending.push(promise) } }
    handlers.get('install')!(event)
    handlers.get('activate')!(event)
    await Promise.all(pending)
    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
    expect(handlers.has('fetch')).toBe(false)
  })
})
