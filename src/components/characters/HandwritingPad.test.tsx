import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandwritingPad } from './HandwritingPad'
import { resetHandwritingEngine } from '../../core/characters/handwritingEngine'

vi.mock('../../core/characters/handwriting', () => ({
  createHandwritingRecognizer: () => ({ recognize: async () => ['\u4e00', '\u4e8c', '\u4e09'].map((character, score) => ({ character, score })), dispose: () => undefined }),
}))
const nav = navigator as unknown as Record<string, unknown>
const allowed = new Set(['\u9e23', '\u4e00', '\u4e8c', '\u4e09'])
beforeEach(() => {
  resetHandwritingEngine(); localStorage.clear()
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number; isPrimary: boolean; pointerType: string
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true; this.pointerType = options.pointerType ?? 'touch' }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete nav.queryHandwritingRecognizer; delete nav.createHandwritingRecognizer })

function draw() {
  const pad = screen.getByRole('img', { name: 'Handwriting area' })
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
  pad.setPointerCapture = () => undefined; pad.hasPointerCapture = () => false; pad.releasePointerCapture = () => undefined
  fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10, pointerType: 'touch' })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 60, clientY: 60 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 80, clientY: 80 })
}

describe('HandwritingPad recognizer indicator', () => {
  it('says the built-in matcher is used and why', async () => {
    render(<HandwritingPad allowed={allowed} onPick={vi.fn()} onClose={vi.fn()} />)
    draw()
    expect(await screen.findByText('Recognizer: built-in matcher \u00b7 Chrome handwriting not available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chrome' })).toBeDisabled()
    expect(await screen.findByRole('button', { name: /\u4e00, from built-in matcher/ })).toBeInTheDocument()
  })
  it('shows Chrome candidates first and marks the topped-up ones', async () => {
    nav.queryHandwritingRecognizer = async () => ({})
    nav.createHandwritingRecognizer = async () => ({ startDrawing: () => ({ addStroke: () => undefined, getPrediction: async () => [{ text: '\u9e23' }] }) })
    render(<HandwritingPad allowed={allowed} onPick={vi.fn()} onClose={vi.fn()} />)
    draw()
    expect(await screen.findByText('Recognizer: Chrome (on-device)')).toBeInTheDocument()
    const first = await screen.findByRole('button', { name: '\u9e23, from Chrome' })
    expect(first).not.toHaveClass('topped-up')
    const topUp = await screen.findByRole('button', { name: '\u4e00, from built-in matcher' })
    expect(topUp).toHaveClass('topped-up')
    fireEvent.click(screen.getByRole('button', { name: 'Built-in' }))
    await waitFor(() => expect(screen.getByText('Recognizer: built-in matcher')).toBeInTheDocument())
  })
})
