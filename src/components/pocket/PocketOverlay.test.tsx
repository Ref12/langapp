import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PocketOverlay, POCKET_HOLD_MS, POCKET_SWIPE_PX } from './PocketOverlay'
import { createWakeLockController } from '../../core/pocket/wake-lock'

beforeEach(() => {
  vi.useFakeTimers()
  if (!window.PointerEvent) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
    }
    vi.stubGlobal('PointerEvent', PointerEventPolyfill)
  }
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const down = (el: Element, y = 400, pointerId = 1) => fireEvent.pointerDown(el, { pointerId, clientX: 100, clientY: y })

describe('PocketOverlay', () => {
  it('swallows touches and clicks, and a short or unarmed gesture does not exit', () => {
    const exit = vi.fn(); const behind = vi.fn()
    document.addEventListener('click', behind)
    render(<PocketOverlay onExit={exit} />)
    const o = screen.getByTestId('pocket-overlay')
    fireEvent.click(o); fireEvent.touchStart(o)
    expect(behind).not.toHaveBeenCalled()
    down(o); fireEvent.pointerMove(o, { pointerId: 1, clientY: 400 - POCKET_SWIPE_PX - 10 }); fireEvent.pointerUp(o, { pointerId: 1 })
    expect(exit).not.toHaveBeenCalled()
    document.removeEventListener('click', behind)
  })
  it('exits on long-press then swipe up', () => {
    const exit = vi.fn()
    render(<PocketOverlay onExit={exit} />)
    const o = screen.getByTestId('pocket-overlay')
    down(o)
    act(() => { vi.advanceTimersByTime(POCKET_HOLD_MS + 10) })
    expect(screen.getByText('Now swipe up')).toBeTruthy()
    fireEvent.pointerMove(o, { pointerId: 1, clientY: 400 - 50 })
    expect(exit).not.toHaveBeenCalled()
    fireEvent.pointerMove(o, { pointerId: 1, clientY: 400 - POCKET_SWIPE_PX })
    expect(exit).toHaveBeenCalledTimes(1)
  })
  it('releasing before the hold completes resets the gesture', () => {
    const exit = vi.fn()
    render(<PocketOverlay onExit={exit} />)
    const o = screen.getByTestId('pocket-overlay')
    down(o); fireEvent.pointerUp(o, { pointerId: 1 })
    act(() => { vi.advanceTimersByTime(POCKET_HOLD_MS * 2) })
    down(o); fireEvent.pointerMove(o, { pointerId: 1, clientY: 0 })
    expect(exit).not.toHaveBeenCalled()
  })
  it('shows a hint first, then an optional status that can be hidden', () => {
    render(<PocketOverlay status="Speaking..." onExit={() => {}} />)
    expect(screen.getByText(/press and hold/)).toBeTruthy()
    act(() => { vi.advanceTimersByTime(9000) })
    expect(screen.getByText('Speaking...')).toBeTruthy()
    fireEvent.click(screen.getByText('Hide status'))
    expect(screen.queryByText('Speaking...')).toBeNull()
  })
})

describe('wake lock', () => {
  const fakeLock = () => {
    const locks: { released: boolean; listeners: (() => void)[] }[] = []
    const request = vi.fn(async () => {
      const l = { released: false, listeners: [] as (() => void)[] }
      locks.push(l)
      return { addEventListener: (_: string, f: () => void) => l.listeners.push(f), release: async () => { l.released = true } } as unknown as WakeLockSentinel
    })
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } })
    return { locks, request }
  }
  const setVisibility = (v: string) => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: v }); document.dispatchEvent(new Event('visibilitychange')) }

  it('requests a screen lock and re-requests when visible again after the system released it', async () => {
    vi.useRealTimers()
    const { locks, request } = fakeLock()
    setVisibility('visible')
    const c = createWakeLockController()
    c.start()
    await vi.waitFor(() => expect(c.held()).toBe(true))
    expect(request).toHaveBeenCalledWith('screen')
    setVisibility('hidden'); locks[0].listeners.forEach(f => f())
    expect(c.held()).toBe(false)
    setVisibility('visible')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    c.stop()
    await vi.waitFor(() => expect(locks[1].released).toBe(true))
  })
  it('degrades gracefully without support', () => {
    vi.stubGlobal('navigator', {})
    const c = createWakeLockController()
    expect(c.supported).toBe(false)
    expect(() => { c.start(); c.stop() }).not.toThrow()
  })
})
