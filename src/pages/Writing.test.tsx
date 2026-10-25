import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWorkspace, loadWorkspace, db } from '../core/database'
import { Writing, WritingPlayer } from './Writing'
import type { CharacterAsset } from '../core/characters/assets'
import type { PageProps } from '../components/shared'

const assets = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../core/characters/assets', () => ({
  characterAssetIndex: ['\u4e00', '\u4e8c', '\u4e09'].map(character => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' })),
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
  assets.load.mockImplementation(async (character: string) => ({ ...asset, character }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }
}

describe('writing exercise', () => {
  it('completes nine repetitions and saves practice without changing reading or manual knowledge', async () => {
    const onNext = vi.fn()
    render(<WritingPlayer {...props} asset={asset} back="dictionary/characters/knowledge" onNext={onNext} />)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await finishGuidedPhases()
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    expect(screen.queryByText('\u4e00', { selector: '.writing-reference-character' })).not.toBeInTheDocument()
    for (let index = 0; index < 3; index++) {
      stroke()
      fireEvent.click(screen.getByRole('button', { name: index === 2 ? 'Finish' : 'Next' }))
    }
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
    expect(await db.characterStates.get('\u4e00')).toMatchObject({ character: '\u4e00', practiceCompletions: 1 })
    expect((await db.characterStates.get('\u4e00'))?.manualAddedAt).toBeUndefined()
    expect(await db.studyCards.count()).toBe(0)
    expect(await db.knowledge.count()).toBe(0)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#dictionary/characters/knowledge')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    expect(await db.characterStates.count()).toBe(1)
  })
  it('reveals memory hints only after two committed misses, keeps undo assistance, and clears it on reset', async () => {
    render(<WritingPlayer {...props} asset={asset} back="dictionary/characters" />)
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
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
  })
  it('cancels on blur, lost capture, Escape and resize; ignores secondary pointers', () => {
    render(<WritingPlayer {...props} asset={asset} back="dictionary/characters" />)
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    for (const interrupt of [
      () => fireEvent.blur(window), () => fireEvent.lostPointerCapture(pad, { pointerId: 1 }),
      () => fireEvent.keyDown(pad, { key: 'Escape' }), () => fireEvent.resize(window),
    ]) {
      fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 10, clientY: 50 })
      fireEvent.pointerUp(pad, { pointerId: 2, clientX: 90, clientY: 50 })
      interrupt()
      fireEvent.pointerUp(pad, { pointerId: 1, clientX: 90, clientY: 50 })
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    }
    fireEvent.pointerDown(pad, { pointerId: 1, button: 0, isPrimary: false, clientX: 10, clientY: 50 })
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 90, clientY: 50 })
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('reveals just the missed stroke and hides the following guide in memory', async () => {
    const twoStrokes: CharacterAsset = { ...asset, strokeCount: 2, paths: ['M10 50 L90 50', 'M50 10 L50 90'] }
    render(<WritingPlayer {...props} asset={twoStrokes} back="dictionary/characters" />)
    for (let index = 0; index < 6; index++) {
      stroke()
      stroke([50, 10], [50, 90])
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
    stroke([0, 0], [1, 1])
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="0"]')).toBeInTheDocument()
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="1"]')).toBeNull()
    stroke()
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="0"]')).toHaveClass('completed')
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="1"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('does not turn watching stroke order into a completed stroke', async () => {
    const user = userEvent.setup()
    render(<WritingPlayer {...props} asset={asset} back="dictionary/characters" />)
    await user.click(screen.getByRole('button', { name: 'Watch stroke order' }))
    expect(screen.getByRole('status')).toHaveTextContent('Watching stroke 1')
    stroke()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop demonstration' }))
    expect(await db.characterStates.count()).toBe(0)
  })
  it('surfaces save failure and allows retry without an unearned completion', async () => {
    const errors: unknown[] = []
    props.run = async operation => { try { await operation() } catch (error) { errors.push(error) } }
    const add = vi.spyOn(db.characterStates, 'put').mockRejectedValueOnce(new Error('Storage full'))
    render(<WritingPlayer {...props} asset={asset} back="dictionary/characters" />)
    for (let index = 0; index < 9; index++) {
      stroke()
      fireEvent.click(screen.getByRole('button', { name: index === 8 ? 'Finish' : 'Next' }))
    }
    await waitFor(() => expect(errors).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
    add.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(async () => expect((await db.characterStates.get('\u4e00'))?.practiceCompletions).toBe(1))
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

  describe('navigation', () => {
    const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Next|Finish)$/ }))
    const previous = () => fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    const phase = () => screen.getByRole('status', { hidden: true }) && document.querySelector('.writing-statusline strong')?.textContent
    const step = () => document.querySelector('.writing-statusline > span')?.textContent

    it('walks repetitions then phases forward and back, with Previous disabled at the very start', () => {
      render(<WritingPlayer {...props} asset={asset} back="dictionary" />)
      expect(step()).toBe('Full guide \u00b7 1/3')
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
      const seen: string[] = []
      for (let index = 0; index < 8; index++) { stroke(); next(); seen.push(step()!) }
      expect(seen).toEqual(['Full guide \u00b7 2/3', 'Full guide \u00b7 3/3', 'One stroke at a time \u00b7 1/3', 'One stroke at a time \u00b7 2/3', 'One stroke at a time \u00b7 3/3', 'From memory \u00b7 1/3', 'From memory \u00b7 2/3', 'From memory \u00b7 3/3'])
      expect(phase()).toBe('From memory')
      expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
      previous()
      expect(step()).toBe('From memory \u00b7 2/3')
      previous(); previous()
      expect(step()).toBe('One stroke at a time \u00b7 3/3')
      for (let index = 0; index < 5; index++) previous()
      expect(step()).toBe('Full guide \u00b7 1/3')
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    })
    it('resets the strokes of a repetition when stepping back', () => {
      render(<WritingPlayer {...props} asset={asset} back="dictionary" />)
      stroke(); next()
      stroke()
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
      previous()
      expect(step()).toBe('Full guide \u00b7 1/3')
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
    it('saves once when the nine repetitions end, then moves on; stepping back and forward does not save twice', async () => {
      const onNext = vi.fn()
      render(<WritingPlayer {...props} asset={asset} back="dictionary" onNext={onNext} />)
      for (let index = 0; index < 9; index++) { stroke(); next() }
      await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
      previous()
      stroke(); next()
      await waitFor(() => expect(onNext).toHaveBeenCalledTimes(2))
      expect((await db.characterStates.get('\u4e00'))?.practiceCompletions).toBe(1)
    })
    it('labels the final step Next while another character follows, Finish otherwise', () => {
      const view = render(<WritingPlayer {...props} asset={asset} back="dictionary" last={false} />)
      for (let index = 0; index < 8; index++) { stroke(); next() }
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
      view.unmount()
    })
    it('points Back at the back route', () => {
      render(<WritingPlayer {...props} asset={asset} back="lessons/new" />)
      expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#lessons/new')
    })
    it('puts the explanatory text and licences link behind the ? sheet', async () => {
      const user = userEvent.setup()
      render(<WritingPlayer {...props} asset={asset} back="dictionary" />)
      expect(screen.queryByRole('link', { name: 'Artwork sources and licenses' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'About this exercise' }))
      expect(screen.getByRole('link', { name: 'Artwork sources and licenses' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    describe('across the characters of a word', () => {
      const route = (_char: string, at: number, extra = '') => `word=${encodeURIComponent('\u4e00\u4e8c\u4e09')}&i=${at}&back=${encodeURIComponent('lessons/new')}${extra}`
      const hash = () => window.location.hash
      beforeEach(() => { window.location.hash = '' })
      async function finishCharacter(code: string, at: number) {
        const view = render(<Writing {...props} codepoint={code} scope="all" query={route('', at)} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        for (let index = 0; index < 9; index++) { stroke(); next() }
        return view
      }
      it('shows the position and goes to the next character (replace) after the last repetition', async () => {
        const view = await finishCharacter('4e00', 0)
        expect(screen.getByText('Character 1 of 3')).toBeInTheDocument()
        await waitFor(() => expect(hash()).toBe('#writing/4e8c/all?word=%E4%B8%80%E4%BA%8C%E4%B8%89&i=1&back=lessons%2Fnew'))
        view.unmount()
      })
      it('opens the next character at the first step and Previous returns to the earlier one at its last phase', async () => {
        const view = await finishCharacter('4e00', 0)
        await waitFor(() => expect(hash()).toContain('writing/4e8c'))
        view.unmount()
        render(<Writing {...props} codepoint="4e8c" scope="all" query={route('', 1)} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        expect(screen.getByText('Character 2 of 3')).toBeInTheDocument()
        expect(step()).toBe('Full guide \u00b7 1/3')
        previous()
        await waitFor(() => expect(hash()).toContain('writing/4e00'))
        cleanup()
        render(<Writing {...props} codepoint="4e00" scope="all" query={route('', 0)} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        expect(step()).toBe('From memory \u00b7 3/3')
        expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
      })
      it('returns to the back route after the last character', async () => {
        await finishCharacter('4e09', 2)
        await waitFor(() => expect(hash()).toBe('#lessons/new'))
        expect(await db.characterStates.get('\u4e09')).toMatchObject({ practiceCompletions: 1 })
      })
      it('trusts the hex codepoint over i, and skips characters without a guide', async () => {
        render(<Writing {...props} codepoint="4e8c" scope="all" query={`word=${encodeURIComponent('\u4e00a\u9fff\u4e8c')}&i=0`} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        expect(screen.getByText('Character 3 of 3')).toBeInTheDocument()
        expect(screen.getByText(/No guide for \u9fff/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#dictionary/characters/all')
        previous()
        await waitFor(() => expect(hash()).toMatch(/^#writing\/4e00\/all\?word=[^&]*$/))
      })
      it('shows a one-line no-guide note with a skip link for a Han character without a guide', async () => {
        render(<Writing {...props} codepoint="9fff" scope="all" query={`word=${encodeURIComponent('\u9fff\u4e00')}`} />)
        expect(screen.getByText('No guide for \u9fff.')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Skip to next character' })).toHaveAttribute('href', '#writing/4e00/all?word=%E9%BF%BF%E4%B8%80&i=1')
      })
    })
  })
})
