import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWorkspace, loadWorkspace, db } from '../core/database'
import { Writing, WritingPlayer } from './Writing'
import type { CharacterAsset } from '../core/characters/assets'
import type { PageProps } from '../components/shared'

const assets = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../core/characters/assets', () => ({
  characterAssetIndex: [{ character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' }],
  characterAttributionUrl: './characters/chinese/attribution.html',
  loadCharacterAsset: assets.load,
}))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({}) }))

const asset: CharacterAsset = { character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }
let props: PageProps
let captured = false
beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
  assets.load.mockReset()
  assets.load.mockResolvedValue(asset)
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    isPrimary: boolean
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true }
  })
  captured = false
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  Object.defineProperties(SVGElement.prototype, {
    setPointerCapture: { configurable: true, value: () => { captured = true } },
    hasPointerCapture: { configurable: true, value: () => captured },
    releasePointerCapture: { configurable: true, value: () => { captured = false } },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stroke(from = [10, 50], to = [90, 50]) {
  const pad = screen.getByRole('img', { name: 'Handwriting area' })
  fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: from[0], clientY: from[1] })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: to[0], clientY: to[1] })
}

async function finishGuidedPhases() {
  for (let index = 0; index < 6; index++) {
    stroke()
    fireEvent.click(screen.getByRole('button', { name: index % 3 === 2 ? 'Next phase' : 'Repeat' }))
  }
}

describe('writing exercise', () => {
  it('completes nine repetitions and saves practice without changing reading or manual knowledge', async () => {
    render(<WritingPlayer {...props} asset={asset} back="#dictionary/characters/knowledge" />)
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled()
    await finishGuidedPhases()
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    expect(screen.queryByText('\u4e00', { selector: '.writing-reference-character' })).not.toBeInTheDocument()
    for (let index = 0; index < 3; index++) {
      stroke()
      fireEvent.click(screen.getByRole('button', { name: index === 2 ? 'Finish writing' : 'Repeat' }))
    }
    await screen.findByRole('button', { name: 'Practice again' })
    expect(await db.characterStates.get('\u4e00')).toMatchObject({ character: '\u4e00', practiceCompletions: 1 })
    expect((await db.characterStates.get('\u4e00'))?.manualAddedAt).toBeUndefined()
    expect(await db.studyCards.count()).toBe(0)
    expect(await db.knowledge.count()).toBe(0)
    expect(screen.getByRole('link', { name: 'Back to characters' })).toHaveAttribute('href', '#dictionary/characters/knowledge')
    fireEvent.click(screen.getByRole('button', { name: 'Practice again' }))
    expect(screen.getByText('Full guide', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled()
    expect(await db.characterStates.count()).toBe(1)
  })
  it('reveals memory hints only after two committed misses, keeps undo assistance, and clears it on reset', async () => {
    render(<WritingPlayer {...props} asset={asset} back="#dictionary/characters" />)
    await finishGuidedPhases()
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerCancel(pad, { pointerId: 1 })
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 1, clientY: 1 })
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Guide added after two misses')
    stroke()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    stroke()
    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
  })
  it('cancels on blur, lost capture, Escape and resize; ignores secondary pointers', () => {
    render(<WritingPlayer {...props} asset={asset} back="#dictionary/characters" />)
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    for (const interrupt of [
      () => fireEvent.blur(window), () => fireEvent.lostPointerCapture(pad, { pointerId: 1 }),
      () => fireEvent.keyDown(pad, { key: 'Escape' }), () => fireEvent.resize(window),
    ]) {
      fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 10, clientY: 50 })
      fireEvent.pointerUp(pad, { pointerId: 2, clientX: 90, clientY: 50 })
      interrupt()
      fireEvent.pointerUp(pad, { pointerId: 1, clientX: 90, clientY: 50 })
      expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled()
    }
    fireEvent.pointerDown(pad, { pointerId: 1, button: 0, isPrimary: false, clientX: 10, clientY: 50 })
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 90, clientY: 50 })
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled()
  })
  it('reveals just the missed stroke and hides the following guide in memory', async () => {
    const twoStrokes: CharacterAsset = { ...asset, strokeCount: 2, paths: ['M10 50 L90 50', 'M50 10 L50 90'] }
    render(<WritingPlayer {...props} asset={twoStrokes} back="#dictionary/characters" />)
    for (let index = 0; index < 6; index++) {
      stroke()
      stroke([50, 10], [50, 90])
      fireEvent.click(screen.getByRole('button', { name: index % 3 === 2 ? 'Next phase' : 'Repeat' }))
    }
    stroke([0, 0], [1, 1])
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="0"]')).toBeInTheDocument()
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="1"]')).toBeNull()
    stroke()
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="0"]')).toHaveClass('completed')
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="1"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled()
  })
  it('does not turn watching stroke order into a completed stroke', async () => {
    const user = userEvent.setup()
    render(<WritingPlayer {...props} asset={asset} back="#dictionary/characters" />)
    await user.click(screen.getByRole('button', { name: 'Watch stroke order' }))
    expect(screen.getByRole('status')).toHaveTextContent('Watching stroke 1')
    stroke()
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop demonstration' }))
    expect(await db.characterStates.count()).toBe(0)
  })
  it('surfaces save failure and allows retry without an unearned completion', async () => {
    const errors: unknown[] = []
    props.run = async operation => { try { await operation() } catch (error) { errors.push(error) } }
    const add = vi.spyOn(db.characterStates, 'put').mockRejectedValueOnce(new Error('Storage full'))
    render(<WritingPlayer {...props} asset={asset} back="#dictionary/characters" />)
    for (let index = 0; index < 9; index++) {
      stroke()
      fireEvent.click(screen.getByRole('button', { name: index === 8 ? 'Finish writing' : index % 3 === 2 ? 'Next phase' : 'Repeat' }))
    }
    await waitFor(() => expect(errors).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Practice again' })).not.toBeInTheDocument()
    add.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Finish writing' }))
    await screen.findByRole('button', { name: 'Practice again' })
    expect((await db.characterStates.get('\u4e00'))?.practiceCompletions).toBe(1)
  })
  it('keeps missing and failed assets explicit and retries failed requests', async () => {
    const view = render(<Writing {...props} codepoint="9fff" />)
    expect(screen.getByRole('heading', { name: 'This stroke guide is not available.' })).toBeInTheDocument()
    expect(assets.load).not.toHaveBeenCalled()
    assets.load.mockRejectedValueOnce(new Error('Offline'))
    view.rerender(<Writing {...props} codepoint="4e00" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('img', { name: 'Handwriting area' })
    expect(assets.load).toHaveBeenCalledTimes(2)
    await act(async () => { view.unmount() })
  })
})
