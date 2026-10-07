import { describe, expect, it } from 'vitest'
import { createAutoListenLoop, isStopCommand, pauseCue, type AutoListenOptions, type ListenResult, type PauseReason } from './auto-listen'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const flush = async () => { for (let i = 0; i < 20; i++) await tick() }

function harness(script: (ListenResult | 'wait')[], options?: Partial<AutoListenOptions>) {
  let clock = 0
  const log: string[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const pending: ((r: ListenResult) => void)[] = []
  const queue = [...script]
  const respondGate: { release?: () => void } = {}
  const loop = createAutoListenLoop({
    listen: () => {
      log.push('listen')
      const next = queue.shift()
      if (next === 'wait' || next === undefined) return new Promise<ListenResult>(resolve => pending.push(resolve))
      if (next.kind === 'silence') clock += 10_000
      return Promise.resolve(next)
    },
    respond: async text => { log.push('respond:' + text); await new Promise<void>(r => { respondGate.release = r }) },
    say: async (reason: PauseReason) => { log.push('say:' + reason) },
    now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
    onChange: phase => log.push('phase:' + phase),
  }, { silenceLimitMs: 30_000, backoffMs: [500, 1000, 2000], ...options })
  return { loop, log, timers, pending, respondGate, advance: (ms: number) => { clock += ms } }
}

describe('auto-listen loop', () => {
  it('listens again only after the reply has been spoken', async () => {
    const h = harness([{ kind: 'text', text: 'ni hao' }, 'wait'])
    h.loop.start(); await flush()
    expect(h.log.filter(l => l === 'listen')).toHaveLength(1)
    expect(h.log).toContain('respond:ni hao')
    await flush()
    expect(h.log.filter(l => l === 'listen')).toHaveLength(1) // reply still "speaking"
    h.respondGate.release!(); await flush()
    expect(h.log.filter(l => l === 'listen')).toHaveLength(2)
    expect(h.loop.phase).toBe('listening')
  })

  it.each(['stop', 'Pause.', '暂停', '停止！', 'Please stop'])('pauses with a spoken cue on the command %s', async text => {
    const h = harness([{ kind: 'text', text }])
    h.loop.start(); await flush()
    expect(h.loop.phase).toBe('paused')
    expect(h.log).toContain('say:command')
    expect(h.log.some(l => l.startsWith('respond'))).toBe(false)
  })

  it('does not treat sentences that merely contain stop as commands', () => {
    expect(isStopCommand("I can't stop eating noodles")).toBe(false)
    expect(isStopCommand('how do I say stop in Mandarin')).toBe(false)
    expect(pauseCue('silence', 'zh-Hans')).not.toBe(pauseCue('silence', 'en-US'))
  })

  it('pauses with a cue after the silence limit, but retries before it', async () => {
    const h = harness([{ kind: 'silence' }, { kind: 'silence' }, { kind: 'silence' }, 'wait'])
    h.loop.start(); await flush()
    expect(h.loop.phase).toBe('paused')
    expect(h.log.filter(l => l === 'listen')).toHaveLength(3) // 10s, 20s, 30s
    expect(h.log).toContain('say:silence')
  })

  it('restarts after errors with growing backoff, then pauses', async () => {
    const err: ListenResult = { kind: 'error', error: 'network' }
    const h = harness([err, err, err, err])
    h.loop.start(); await flush()
    expect(h.timers.map(t => t.ms)).toEqual([500])
    h.timers[0].fn(); await flush()
    h.timers[1].fn(); await flush()
    expect(h.timers.map(t => t.ms)).toEqual([500, 1000, 2000])
    h.timers[2].fn(); await flush()
    expect(h.loop.phase).toBe('paused')
    expect(h.log).toContain('say:errors')
  })

  it('a good turn resets the failure count', async () => {
    const err: ListenResult = { kind: 'error', error: 'network' }
    const h = harness([err, { kind: 'text', text: 'hello' }, err, 'wait'])
    h.loop.start(); await flush(); h.timers[0].fn(); await flush()
    h.respondGate.release!(); await flush()
    expect(h.timers.map(t => t.ms)).toEqual([500, 500])
  })

  it('does not retry fatal errors such as a denied microphone', async () => {
    const h = harness([{ kind: 'error', error: 'permission was denied', fatal: true }])
    h.loop.start(); await flush()
    expect(h.loop.phase).toBe('paused')
    expect(h.timers).toHaveLength(0)
    expect(h.log.some(l => l.startsWith('say'))).toBe(false)
  })

  it('waits while the page is hidden and resumes when visible', async () => {
    const h = harness(['wait', 'wait'])
    h.loop.start(); await flush()
    h.loop.setHidden(true); h.pending[0]({ kind: 'cancelled' }); await flush()
    expect(h.loop.phase).toBe('paused')
    expect(h.log.some(l => l.startsWith('say'))).toBe(false)
    h.loop.setHidden(false); await flush()
    expect(h.loop.phase).toBe('listening')
    expect(h.log.filter(l => l === 'listen')).toHaveLength(2)
  })

  it('stop() ends the loop without further listening', async () => {
    const h = harness(['wait'])
    h.loop.start(); await flush()
    h.loop.stop(); h.pending[0]({ kind: 'text', text: 'late' }); await flush()
    expect(h.loop.phase).toBe('idle')
    expect(h.log.some(l => l.startsWith('respond'))).toBe(false)
  })
})
