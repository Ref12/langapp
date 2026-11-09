import { afterEach, describe, expect, it } from 'vitest'
import { installUpdateGuard, isChunkLoadError, isUpdateReady, newerBuildLive, reportLoadFailure, resetAppUpdate } from './appUpdate'

describe('stale deploy detection', () => {
  it('recognises missing-chunk errors from each browser, and not ordinary network errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false)
  })
  it('does not claim an update when the build id is unknown (dev, tests) or the server is unreachable', async () => {
    expect(await newerBuildLive((() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch)).toBe(false)
    expect(await reportLoadFailure(new TypeError('Failed to fetch'))).toBe(false)
  })
})

describe('update bar on a service worker takeover', () => {
  afterEach(() => { delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker; resetAppUpdate() })
  /** A page whose controller starts as startedWith; takeover() swaps in another worker file and fires controllerchange. */
  function page(startedWith: string) {
    const target = new EventTarget()
    const worker = { controller: { scriptURL: startedWith }, addEventListener: target.addEventListener.bind(target) }
    Object.defineProperty(navigator, 'serviceWorker', { value: worker, configurable: true })
    installUpdateGuard()
    return (scriptURL: string) => { worker.controller = { scriptURL }; target.dispatchEvent(new Event('controllerchange')) }
  }
  it('raises when the same worker file takes over (an update)', () => {
    const takeover = page('https://x.test/lab/sw-lab.js')
    takeover('https://x.test/lab/sw-lab.js')
    expect(isUpdateReady()).toBe(true)
  })
  it('does not raise when a different file takes over (the first Lab visit, first under the root worker)', () => {
    const takeover = page('https://x.test/sw.js')
    takeover('https://x.test/lab/sw-lab.js')
    expect(isUpdateReady()).toBe(false)
  })
})
