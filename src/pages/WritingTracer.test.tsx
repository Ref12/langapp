import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWorkspace, loadWorkspace, db } from '../core/database'
import { WritingPlayer } from './Writing'
import { savePreferences } from '../core/learning'
import { resetCharacterMeanings } from '../core/characters/meanings'
import type { CharacterAsset } from '../core/characters/assets'
import type { PageProps } from '../components/shared'

vi.mock('../core/characters/assets', () => ({
  characterAssetIndex: [],
  characterAttributionUrl: './characters/chinese/attribution.html',
  loadCharacterAsset: vi.fn(),
}))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({}) }))

const two: CharacterAsset = { character: '\u4e8c', strokeCount: 2, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 30 L90 30', 'M10 70 L90 70'] }
const one: CharacterAsset = { character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }
let props: PageProps
let captured = false
beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
  await savePreferences({ writingSpeech: 'off' })
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    isPrimary: boolean
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true }
  })
  resetCharacterMeanings()
  captured = false
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  Object.defineProperties(SVGElement.prototype, {
    setPointerCapture: { configurable: true, value: () => { captured = true } },
    hasPointerCapture: { configurable: true, value: () => captured },
    releasePointerCapture: { configurable: true, value: () => { captured = false } },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const pad = () => screen.getByRole('img', { name: 'Handwriting area' })
function stroke(from: number[], to: number[]) {
  fireEvent.pointerDown(pad(), { pointerId: 1, button: 0, clientX: from[0], clientY: from[1] })
  fireEvent.pointerMove(pad(), { pointerId: 1, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 })
  fireEvent.pointerUp(pad(), { pointerId: 1, clientX: to[0], clientY: to[1] })
}
const drag = (points: number[][]) => {
  fireEvent.pointerDown(pad(), { pointerId: 1, button: 0, clientX: points[0][0], clientY: points[0][1] })
  for (const point of points.slice(1)) fireEvent.pointerMove(pad(), { pointerId: 1, clientX: point[0], clientY: point[1] })
  fireEvent.pointerUp(pad(), { pointerId: 1, clientX: points[points.length - 1][0], clientY: points[points.length - 1][1] })
}
const miss = () => stroke([0, 0], [1, 1])
const tracerOn = () => screen.queryByTestId('tracer-badge') !== null

describe('writing tracer', () => {
  it('switches the stroke to the tracer after three misses; the next stroke is normal again', () => {
    render(<WritingPlayer {...props} asset={two} backHref="#d" />)
    miss(); miss()
    expect(tracerOn()).toBe(false)
    miss()
    expect(tracerOn()).toBe(true)
    expect(pad()).toHaveAttribute('data-tracer')
    expect(screen.getByRole('status')).toHaveTextContent(/Tracer on/)
    // Staying off the path does nothing; the path is drawn up to the pointer, and progress is kept when the learner lifts.
    drag([[50, 95], [60, 95]])
    expect(screen.queryByTestId('tracer-trace')).toBeNull()
    drag([[10, 30], [25, 30], [40, 30]])
    expect(screen.getByTestId('tracer-trace').getAttribute('points')).toMatch(/^10,30 .*40,30$/)
    drag([[20, 30], [30, 31]])
    expect(screen.getByTestId('tracer-trace').getAttribute('points')).toMatch(/40,30$/)
    expect(screen.getByText('0/2')).toBeInTheDocument()
    drag([[40, 30], [55, 30], [70, 30], [85, 30]])
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(tracerOn()).toBe(false)
    expect(pad()).not.toHaveAttribute('data-tracer')
    // The second stroke is checked normally: a miss is a miss, not a trace.
    drag([[10, 70], [30, 70]])
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.queryByTestId('tracer-trace')).toBeNull()
    stroke([10, 70], [90, 70])
    expect(screen.getByText('Complete. Press Next.')).toBeInTheDocument()
  })
  it('misses of different strokes do not add up', () => {
    render(<WritingPlayer {...props} asset={two} backHref="#d" />)
    miss(); miss()
    stroke([10, 30], [90, 30])
    miss()
    expect(tracerOn()).toBe(false)
  })
  it('a stroke finished with the tracer is help: the character is not recorded as written; clean writing is', async () => {
    const run = async (helped: boolean) => {
      await db.characterStates.clear()
      const view = render(<WritingPlayer {...props} asset={one} backHref="#d" />)
      for (let part = 0; part < 9; part++) {
        if (helped && part === 6) { miss(); miss(); miss(); drag([[10, 50], [30, 50], [50, 50], [70, 50], [85, 50]]) } else stroke([10, 50], [90, 50])
        fireEvent.click(screen.getByRole('button', { name: part === 8 ? 'Finish' : 'Next' }))
      }
      await new Promise(resolve => setTimeout(resolve, 30))
      view.unmount()
      return db.characterStates.get('\u4e00')
    }
    expect(await run(true)).toBeUndefined()
    await waitFor(async () => expect((await run(false))?.practiceCompletions).toBe(1))
  })
  it('the setting changes what a stroke needs: Strict rejects a wobble that Normal accepts', async () => {
    const wobbly = [[10, 50], [30, 50], [50, 63], [70, 50], [90, 50]]
    const { unmount } = render(<WritingPlayer {...props} asset={one} backHref="#d" />)
    drag(wobbly)
    expect(screen.getByText('Complete. Press Next.')).toBeInTheDocument()
    unmount()
    await savePreferences({ strokeMatching: 'strict' })
    props = { ...props, workspace: await loadWorkspace() }
    render(<WritingPlayer {...props} asset={one} backHref="#d" />)
    drag(wobbly)
    expect(screen.queryByText('Complete. Press Next.')).toBeNull()
  })
})
