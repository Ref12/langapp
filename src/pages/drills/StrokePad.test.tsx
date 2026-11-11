import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrokePad } from './StrokePad'

vi.mock('../../core/characters/assets', async importOriginal => ({ ...await importOriginal<typeof import('../../core/characters/assets')>(),
  characterAssetIndex: [{ character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' }],
  loadCharacterAsset: async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }) }))

let vibrate: ReturnType<typeof vi.fn>
let captured = false
beforeEach(() => {
  vibrate = vi.fn()
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1 }
  })
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  Object.defineProperties(SVGElement.prototype, {
    setPointerCapture: { configurable: true, value: () => { captured = true } },
    hasPointerCapture: { configurable: true, value: () => captured },
    releasePointerCapture: { configurable: true, value: () => { captured = false } },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (navigator as { vibrate?: unknown }).vibrate })

async function stroke(from = [10, 50], to = [90, 50]) {
  const pad = await screen.findByRole('img', { name: 'Handwriting area' })
  await waitFor(() => expect(screen.queryByText(/Loading the stroke guide/)).toBeNull())
  fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: from[0], clientY: from[1] })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: to[0], clientY: to[1] })
}

describe('Write it pad vibration', () => {
  it('buzzes briefly for an accepted stroke and longer for a miss', async () => {
    render(<StrokePad text={'\u4e00'} onDone={() => undefined} />)
    await stroke([0, 0], [1, 1])
    expect(vibrate).toHaveBeenLastCalledWith(60)
    await stroke()
    expect(vibrate).toHaveBeenLastCalledWith(20)
    expect(vibrate).toHaveBeenCalledTimes(2)
  })
  it('stays silent when the vibration preference is off', async () => {
    render(<StrokePad text={'\u4e00'} haptics={false} onDone={() => undefined} />)
    await stroke()
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('Write it pad tracer', () => {
  it('traces the stroke after three misses and reports the result as hinted', async () => {
    const done = vi.fn()
    render(<StrokePad text={'\u4e00'} onDone={done} />)
    await stroke([0, 0], [1, 1]); await stroke([0, 0], [1, 1]); await stroke([0, 0], [1, 1])
    expect(screen.getByText(/Tracer on/)).toBeInTheDocument()
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    expect(pad).toHaveAttribute('data-tracer')
    expect(done).not.toHaveBeenCalled()
    await stroke([10, 50], [30, 50]); await stroke([30, 50], [60, 50]); await stroke([60, 50], [88, 50])
    await waitFor(() => expect(done).toHaveBeenCalledWith({ misses: 3, hinted: true }))
  })
})
