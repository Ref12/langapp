import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_INTERVAL_MS, atBoundary, type BoundaryDeps } from './auto'

function deps(over: Partial<BoundaryDeps> = {}) {
  let window = 0
  let clock = 1_000_000_000
  const run = vi.fn(async () => ({}))
  const value: BoundaryDeps = {
    profileId: 'p', now: () => clock, exerciseOpen: () => false, enabled: async () => true, connected: async () => true, dirty: async () => true,
    windowStart: async () => window, setWindowStart: async at => { window = at }, run, busy: () => false, ...over,
  }
  return { value, run, advance: (ms: number) => { clock += ms }, stamp: () => window, setWindow: (at: number) => { window = at } }
}

describe('automatic backup at boundaries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs once at a boundary, then skips boundaries inside 15 minutes and runs the next one after', async () => {
    const t = deps()
    expect(await atBoundary(t.value)).toBe('ran')
    t.advance(5 * 60_000)
    expect(await atBoundary(t.value)).toBe('window')
    t.advance(AUTO_INTERVAL_MS)
    expect(await atBoundary(t.value)).toBe('ran')
    expect(t.run).toHaveBeenCalledTimes(2)
  })

  it('does nothing without new learning data', async () => {
    const t = deps({ dirty: async () => false })
    expect(await atBoundary(t.value)).toBe('clean')
    expect(t.run).not.toHaveBeenCalled()
  })

  it('does nothing while an exercise is on screen, and does not use up the window', async () => {
    let open = true
    const t = deps({ exerciseOpen: () => open })
    expect(await atBoundary(t.value)).toBe('exercise')
    expect(t.run).not.toHaveBeenCalled()
    open = false
    expect(await atBoundary(t.value)).toBe('ran')
  })

  it('gives the window back when an exercise opens mid-run, so the next boundary resumes', async () => {
    let open = false
    const t = deps({ exerciseOpen: () => open })
    t.run.mockImplementationOnce(async () => { open = true; return {} })
    expect(await atBoundary(t.value)).toBe('paused')
    open = false
    expect(await atBoundary(t.value)).toBe('ran')
  })

  it('does nothing when the setting is off or no backup is connected', async () => {
    const off = deps({ enabled: async () => false })
    expect(await atBoundary(off.value)).toBe('off')
    const none = deps({ connected: async () => false })
    expect(await atBoundary(none.value)).toBe('not-connected')
    expect(off.run).not.toHaveBeenCalled()
    expect(none.run).not.toHaveBeenCalled()
  })

  it('a failed run is retried at the next boundary, not in a loop', async () => {
    const t = deps()
    t.run.mockRejectedValueOnce(new Error('offline'))
    expect(await atBoundary(t.value)).toBe('failed')
    expect(t.run).toHaveBeenCalledTimes(1)
    expect(await atBoundary(t.value)).toBe('ran')
  })

  it('never rejects: a throwing check resolves to failed and leaves the window alone', async () => {
    for (const over of [{ dirty: async () => { throw new Error('DatabaseClosedError') } }, { windowStart: async () => { throw new Error('closed') } }, { enabled: async () => { throw new Error('closed') } }, { connected: async () => { throw new Error('closed') } }] as Partial<BoundaryDeps>[]) {
      const t = deps(over)
      await expect(atBoundary(t.value)).resolves.toBe('failed')
      expect(t.run).not.toHaveBeenCalled()
      expect(t.stamp()).toBe(0)
    }
  })

  it('never rejects when the default checks cannot read a closed database', async () => {
    const { db } = await import('../database')
    await db.close()
    await expect(atBoundary()).resolves.toMatch(/failed|not-connected|clean|window/)
    await db.open()
  })

  it('two boundaries at once start one run', async () => {
    const t = deps()
    const [a, b] = await Promise.all([atBoundary(t.value), atBoundary(t.value)])
    expect([a, b].sort()).toEqual(['busy', 'ran'])
    expect(t.run).toHaveBeenCalledTimes(1)
  })
})
