import { describe, expect, it } from 'vitest'
import { isChunkLoadError, newerBuildLive, reportLoadFailure } from './appUpdate'

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
