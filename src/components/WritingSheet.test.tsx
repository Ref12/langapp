import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import type { PageProps } from './shared'
import { WritingSheetHost } from './WritingSheet'
import { WritePractice } from './assistant/WritePractice'
import { Writing } from '../pages/Writing'
import { closeWritingSheet, getWritingSheet, openWritingSheet } from '../core/characters/writing-sheet'

vi.mock('../core/characters/assets', () => ({
  characterAssetIndex: ['\u4e00', '\u4e8c', '\u4e09'].map(character => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' })),
  characterAttributionUrl: './characters/chinese/attribution.html',
  loadCharacterAsset: async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }),
}))
vi.mock('./study/useCatalog', () => ({ useCatalog: () => ({}) }))

let props: PageProps
beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
  window.location.hash = '#study/session-1'
})
afterEach(() => { act(() => closeWritingSheet()); cleanup(); vi.unstubAllGlobals() })

const sheet = () => screen.getByRole('dialog', { name: 'Writing practice', hidden: true })

describe('writing overlay sheet', () => {
  it('opens from the Write-mode list; Back returns to the same list and X closes, with no hash change', async () => {
    render(<><div data-testid="host-page"><WritePractice text={'\u4e00\u4e8c \u4e09'} route="study/session-1" onSpeak={() => undefined} /></div><WritingSheetHost {...props} /></>)
    const list = await screen.findByRole('list', { name: 'Words to write' })
    fireEvent.click(screen.getByRole('button', { name: /Write \u4e00\u4e8c/ }))
    await within(sheet()).findByRole('img', { name: 'Handwriting area' })
    expect(window.location.hash).toBe('#study/session-1')
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    expect(screen.getByRole('list', { name: 'Words to write' })).toBe(list)
    fireEvent.click(screen.getByRole('button', { name: /Write \u4e09/ }))
    await within(sheet()).findByRole('img', { name: 'Handwriting area' })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close writing practice' }))
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    expect(window.location.hash).toBe('#study/session-1')
    expect(screen.getByRole('list', { name: 'Words to write' })).toBe(list)
  })

  it('a single-character open has no Back, only X', async () => {
    render(<WritingSheetHost {...props} />)
    act(() => { openWritingSheet('\u4e00', { remember: false }) })
    await within(sheet()).findByRole('img', { name: 'Handwriting area' })
    expect(within(sheet()).queryByRole('button', { name: 'Back' })).toBeNull()
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close writing practice' }))
    expect(getWritingSheet()).toBeUndefined()
  })

  it('the old #writing route still renders the player', async () => {
    render(<Writing {...props} codepoint="4e8c" scope="all" />)
    expect(await screen.findByRole('img', { name: 'Handwriting area' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#dictionary/characters/all')
  })
})
