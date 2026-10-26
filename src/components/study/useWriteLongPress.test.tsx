import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteLongPress, wordAt } from './useWriteLongPress'

function pointer(element: HTMLElement, type: string, pointerType: string) {
  const event = createEvent[type === 'pointerdown' ? 'pointerDown' : 'pointerUp'](element)
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  fireEvent(element, event)
}
function Title() {
  const press = useWriteLongPress('study/session-1')
  return <h3 {...press}>{'\u5b66\u751f'}</h3>
}
beforeEach(() => { vi.useFakeTimers(); window.location.hash = '#study/session-1' })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('write long-press', () => {
  it('opens Write after 500 ms of touch, but not on a tap or a mouse press', () => {
    render(<Title />)
    const title = screen.getByText('\u5b66\u751f')
    pointer(title, 'pointerdown', 'touch'); act(() => { vi.advanceTimersByTime(200) }); pointer(title, 'pointerup', 'touch')
    act(() => { vi.advanceTimersByTime(600) })
    expect(window.location.hash).toBe('#study/session-1')
    pointer(title, 'pointerdown', 'mouse'); act(() => { vi.advanceTimersByTime(700) })
    expect(window.location.hash).toBe('#study/session-1')
    pointer(title, 'pointerdown', 'touch'); act(() => { vi.advanceTimersByTime(500) })
    expect(window.location.hash.startsWith('#writing/' + (0x5b66).toString(16) + '/')).toBe(true)
    expect(decodeURIComponent(window.location.hash)).toContain('back=study/session-1')
  })
  it('falls back to the whole text without a caret position', () => { expect(wordAt('\u5b66\u751f', undefined).word).toBe('\u5b66\u751f') })
})
