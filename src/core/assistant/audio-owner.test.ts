import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireAudio, interruptAudio, type AudioLease } from './audio-owner'

afterEach(() => interruptAudio())

describe('exclusive top-level audio ownership', () => {
  it('interrupts the previous owner synchronously and only once', () => {
    const interrupted = vi.fn()
    const first = acquireAudio(interrupted)
    const second = acquireAudio(vi.fn())
    expect(interrupted).toHaveBeenCalledOnce()
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    first.release()
    expect(second.isCurrent()).toBe(true)
    interruptAudio()
    expect(second.isCurrent()).toBe(false)
    expect(interrupted).toHaveBeenCalledOnce()
  })

  it('releases idempotently without interrupting the released owner', () => {
    const interrupted = vi.fn()
    const lease = acquireAudio(interrupted)
    lease.release()
    lease.release()
    interruptAudio()
    expect(interrupted).not.toHaveBeenCalled()
  })

  it('does not let a stale release during interruption remove the new owner', () => {
    const first = acquireAudio(() => first.release())
    const second = acquireAudio(vi.fn())
    expect(second.isCurrent()).toBe(true)
  })

  it('lets the newest reentrant claim win and interrupts an unreturned lease', () => {
    let newest: AudioLease | undefined
    const secondInterrupted = vi.fn()
    acquireAudio(() => { newest = acquireAudio(vi.fn()) })
    const second = acquireAudio(secondInterrupted)
    expect(secondInterrupted).toHaveBeenCalledOnce()
    expect(second.isCurrent()).toBe(false)
    second.release()
    expect(newest?.isCurrent()).toBe(true)
  })

  it('supports cancellation before the new lease has returned', () => {
    acquireAudio(() => interruptAudio())
    const interrupted = vi.fn()
    const next = acquireAudio(interrupted)
    expect(interrupted).toHaveBeenCalledOnce()
    expect(next.isCurrent()).toBe(false)
  })

  it('throws an explicit safe error when interruption fails, without keeping the failed claim', () => {
    acquireAudio(() => { throw new Error('microphone stuck') })
    expect(() => acquireAudio(vi.fn())).toThrow(/could not be interrupted.*microphone stuck/)
    expect(() => interruptAudio()).not.toThrow()
  })

  it('does not remove a newer reentrant owner when an older interruption throws', () => {
    let newest: AudioLease | undefined
    acquireAudio(() => {
      newest = acquireAudio(vi.fn())
      throw new Error('old cleanup failed')
    })
    expect(() => acquireAudio(vi.fn())).toThrow('old cleanup failed')
    expect(newest?.isCurrent()).toBe(true)
  })

  it('refuses to pretend interruption succeeded when its callback claimed new audio', () => {
    let newest: AudioLease | undefined
    acquireAudio(() => { newest = acquireAudio(vi.fn()) })
    expect(() => interruptAudio()).toThrow('Audio changed')
    expect(newest?.isCurrent()).toBe(true)
  })
})
