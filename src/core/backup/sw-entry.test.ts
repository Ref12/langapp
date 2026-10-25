import { beforeEach, describe, expect, it, vi } from 'vitest'

// The service worker entry registers 'sync' and 'periodicsync' handlers on the worker scope.
type Handler = (event: { tag: string; waitUntil(promise: Promise<unknown>): void }) => void
const handlers = new Map<string, Handler>()
let windows: { visibilityState: string; focused: boolean }[] = []
const runInWorker = vi.fn(async () => ({ ok: true as const, record: {} as never }))

beforeEach(async () => {
  handlers.clear(); runInWorker.mockClear(); windows = []
  vi.resetModules()
  Object.assign(globalThis, { addEventListener: (type: string, handler: Handler) => handlers.set(type, handler), clients: { matchAll: async () => windows } })
  vi.doMock('./host', () => ({ runInWorker, backgroundRequest: async (trigger: string) => ({ profile: { id: 'default', name: 'default' }, trigger }) }))
  const state = await import('./state')
  await state.resetBackupStateForTests()
  await state.saveActive({ profile: { id: 'default', name: 'default' }, dirtyAt: Date.now() })
  await import('./sw-entry')
})

const fire = async (type: string, tag = 'backup') => {
  let work: Promise<unknown> = Promise.resolve()
  handlers.get(type)!({ tag, waitUntil: promise => { work = promise } })
  return work
}

describe('service worker backup', () => {
  it('registers sync and periodic sync handlers for the backup tag only', async () => {
    expect([...handlers.keys()].filter(type => type.endsWith('sync')).sort()).toEqual(['periodicsync', 'sync'])
    await fire('sync', 'other')
    expect(runInWorker).not.toHaveBeenCalled()
  })

  it('backs up on a sync event when the app is closed or hidden', async () => {
    windows = [{ visibilityState: 'hidden', focused: false }]
    await fire('sync')
    expect(runInWorker).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'sync' }))
  })

  it('never backs up while the app is visible; a sync is retried by failing, a periodic one just waits', async () => {
    windows = [{ visibilityState: 'visible', focused: true }]
    await expect(fire('sync')).rejects.toThrow(/in use/)
    await fire('periodicsync')
    expect(runInWorker).not.toHaveBeenCalled()
  })

  it('periodic runs only when there are unsent changes', async () => {
    const state = await import('./state')
    await state.saveActive({ profile: { id: 'default', name: 'default' } })
    await fire('periodicsync')
    expect(runInWorker).not.toHaveBeenCalled()
    await state.markDirtyForBackground({ id: 'default', name: 'default' })
    await fire('periodicsync')
    expect(runInWorker).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'periodic' }))
  })
})
