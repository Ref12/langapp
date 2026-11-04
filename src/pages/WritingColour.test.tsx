import { readFileSync } from 'node:fs'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWorkspace, loadWorkspace, db } from '../core/database'
import { WritingPlayer } from './Writing'
import { resetComponentData, strokeParts, type ComponentData } from '../core/characters/components'
import { resetCharacterMeanings } from '../core/characters/meanings'
import { savePreferences } from '../core/learning'
import type { CharacterAsset } from '../core/characters/assets'
import type { PageProps } from '../components/shared'

vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({}) }))
const componentsText = readFileSync('public/characters/chinese/components.generated.json', 'utf8')
const data = JSON.parse(componentsText) as ComponentData
const assetFor = (character: string): CharacterAsset => ({ character, strokeCount: data.characters[character].n, reviewed: true, variant: 'reviewed-monoline',
  paths: Array.from({ length: data.characters[character].n }, (_, index) => `M10 ${10 + index * 5} L90 ${10 + index * 5}`) })

let props: PageProps
beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  resetComponentData(); resetCharacterMeanings()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('components.generated.json') ? new Response(componentsText) : new Response('', { status: 404 })))
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const palette = () => screen.getByRole('button', { name: 'Colour parts' })

describe('Colour parts in the writing player', () => {
  it('sits on the decomposition line, not in the toolbar beside Undo', async () => {
    render(<WritingPlayer {...props} asset={assetFor('河')} backHref="#x" />)
    await screen.findByText(/氵/, { selector: '.cmp-glyph' })
    expect(palette().closest('.cmp-row')).not.toBeNull()
    expect(palette().closest('[role="toolbar"]')).toBeNull()
  })
  it('is off by default: the Palette button is not pressed and no stroke is coloured', async () => {
    render(<WritingPlayer {...props} asset={assetFor('河')} backHref="#x" />)
    await screen.findByText(/氵/, { selector: '.cmp-glyph' })
    expect(palette()).toHaveAttribute('aria-pressed', 'false')
    expect(palette()).not.toHaveClass('is-on')
    expect(document.querySelectorAll('.writing-guide[data-part]')).toHaveLength(0)
    expect(document.querySelector('.cmp-tp.coloured')).toBeNull()
  })
  it('pressing it saves the preference and colours strokes and the text line; pressing again clears it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<WritingPlayer {...props} asset={assetFor('河')} backHref="#x" />)
    await screen.findByText(/氵/, { selector: '.cmp-glyph' })
    await user.click(palette())
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.writingColourParts).toBe(true))
    props = { ...props, workspace: await loadWorkspace() }
    rerender(<WritingPlayer {...props} asset={assetFor('河')} backHref="#x" />)
    expect(palette()).toHaveAttribute('aria-pressed', 'true')
    expect(palette()).toHaveClass('is-on')
    expect(document.querySelectorAll('.cmp-tp.coloured')).toHaveLength(2)
    const owners = strokeParts(data, '河', 8)
    const guides = [...document.querySelectorAll('.writing-guide')] as SVGPathElement[]
    expect(guides.length).toBeGreaterThan(0)
    for (const guide of guides) expect(guide.style.stroke).toBe(`var(--part-c${owners[Number(guide.dataset.stroke)]! + 1})`)
    await user.click(palette())
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.writingColourParts).toBe(false))
  })
  it('is remembered: a workspace with the preference on starts coloured', async () => {
    await savePreferences({ writingColourParts: true })
    props = { ...props, workspace: await loadWorkspace() }
    render(<WritingPlayer {...props} asset={assetFor('想')} backHref="#x" />)
    await waitFor(() => expect(document.querySelectorAll('.cmp-tp.coloured')).toHaveLength(2))
    expect(palette()).toHaveAttribute('aria-pressed', 'true')
    expect(palette()).toHaveClass('is-on')
  })
  it('colours in every phase: guides are shown in the watch replay too', async () => {
    await savePreferences({ writingColourParts: true })
    props = { ...props, workspace: await loadWorkspace() }
    const user = userEvent.setup()
    render(<WritingPlayer {...props} asset={assetFor('妈')} backHref="#x" />)
    await waitFor(() => expect(document.querySelectorAll('.cmp-tp.coloured')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Watch stroke order' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)) })
    const guides = [...document.querySelectorAll('.writing-guide')] as SVGPathElement[]
    expect(guides.length).toBeGreaterThan(0)
    expect(guides.every(guide => guide.style.stroke.startsWith('var(--part-c'))).toBe(true)
  })
  it('with colour on, unwritten strokes are the part colour dimmed, written ones full', async () => {
    const user = userEvent.setup()
    await db.preferences.update('workspace', { writingColourParts: true })
    props = { ...props, workspace: await loadWorkspace() }
    render(<WritingPlayer {...props} asset={assetFor('河')} backHref="#x" />)
    await screen.findByText(/氵/, { selector: '.cmp-glyph' })
    const guides = () => [...document.querySelectorAll<SVGPathElement>('.writing-guide[data-part]')]
    expect(guides().length).toBeGreaterThan(1)
    expect(guides().every(path => path.style.strokeOpacity === '0.4')).toBe(true)
    expect(guides().every(path => path.style.stroke !== '')).toBe(true)
    void user
  })
})
