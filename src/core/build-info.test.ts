import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('build info', () => {
  it('reads the constants vite.config.ts defines', async () => {
    vi.stubGlobal('__BUILD_CHANNEL__', 'stable')
    vi.stubGlobal('__BUILD_COMMIT__', 'abc12345')
    const info = await import('./build-info')
    expect([info.buildChannel, info.buildCommit]).toEqual(['stable', 'abc12345'])
  })

  it('falls back when the code runs outside a Vite build', async () => {
    const info = await import('./build-info')
    expect([info.buildChannel, info.buildCommit]).toEqual(['stable', 'unknown'])
  })
})
