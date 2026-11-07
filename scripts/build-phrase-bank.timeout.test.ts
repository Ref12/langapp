import { describe, expect, it } from 'vitest'
import { createCaller } from './build-phrase-bank.mjs'

const ok = { ok: true, status: 200, headers: new Map(), json: async () => ({ choices: [{ message: { content: 'hello' } }] }), text: async () => '' }
const caller = (fetchImpl: unknown, extra = {}) => createCaller({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: fetchImpl as typeof fetch, sleep: async () => {}, timeoutMs: 20, random: () => 1, ...extra })
/** A fetch that never answers (and, like a stalled socket, ignores the abort signal unless told to honour it). */
const hang = (honour: boolean) => () => new Promise((_, reject) => { void honour; void reject })

describe('model call timeout', () => {
  it('gives up on a fetch that hangs and ignores the abort, retries twice with backoff, then fails the call', async () => {
    let calls = 0
    const waits: number[] = []
    const call = caller(() => { calls++; return hang(false)() }, { sleep: async (ms: number) => { waits.push(ms) } })
    await expect(call('s', 'u')).rejects.toThrow(/Model call failed \(chat m\): timed out after/)
    expect(calls).toBe(3)   // the first try and 2 retries
    expect(waits).toEqual([2000, 4000])   // backoff grows
  })

  it('aborts the request: the signal handed to fetch fires', async () => {
    const signals: AbortSignal[] = []
    const call = caller((_url: string, init: { signal: AbortSignal }) => { signals.push(init.signal); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) })
    await expect(call('s', 'u')).rejects.toThrow(/timed out/)
    expect(signals).toHaveLength(3)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('a stall that clears is retried: the second try answers', async () => {
    let calls = 0
    const call = caller(() => { calls++; return calls === 1 ? hang(false)() : Promise.resolve(ok) })
    expect(await call('s', 'u')).toBe('hello')
    expect(calls).toBe(2)
  })

  it('a slow body counts too: the timeout covers reading the reply', async () => {
    let calls = 0
    const call = caller(() => { calls++; return Promise.resolve({ ...ok, json: () => new Promise(() => {}) }) }, { timeoutRetries: 0 })
    await expect(call('s', 'u')).rejects.toThrow(/timed out/)
    expect(calls).toBe(1)
  })
})
