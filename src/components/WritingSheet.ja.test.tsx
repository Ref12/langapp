import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import type { PageProps } from './shared'
import { WritingSheetHost } from './WritingSheet'
import { WritePractice } from './assistant/WritePractice'
import { closeWritingSheet } from '../core/characters/writing-sheet'
import { buildWritingRoute } from '../core/characters/writing-route'
import * as assets from '../core/characters/assets'

// A Japanese build's Practice card for a word with kana and kanji: Write is offered, and the stroke view asks the Japanese data, never the Chinese.
vi.mock('./study/useCatalog', () => ({ useCatalog: () => ({}) }))
vi.mock('./assistant/useWriteWords', () => ({ useWriteWords: () => ({ words: [
  { text: '\u98df\u3079\u307e\u3059', pinyin: '' }, { text: '\u50cd\u304f', pinyin: '' }, { text: '\u8fd9', pinyin: '' }] }) }))

let props: PageProps
const loads: [string, string | undefined][] = []
beforeEach(async () => {
  setBuildLanguageForTests('ja')
  loads.length = 0
  vi.spyOn(assets, 'loadCharacterAsset').mockImplementation(async (character, language) => {
    loads.push([character, language])
    return { character, strokeCount: 1, reviewed: false, variant: 'japanese-source', paths: ['M10 50 L90 50'] }
  })
  await db.delete(); await db.open(); await initializeWorkspace()
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
})
afterEach(() => { act(() => closeWritingSheet()); cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined) })

describe('writing in a Japanese build', () => {
  it('offers Write for kana and kanji, none for a character without a Japanese guide, and loads Japanese strokes', async () => {
    render(<><WritePractice text="x" onSpeak={() => undefined} /><WritingSheetHost {...props} /></>)
    expect(await screen.findByRole('button', { name: /Write \u98df\u3079\u307e\u3059/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Write \u50cd\u304f/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Write \u8fd9/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Write \u98df\u3079\u307e\u3059/ }))
    await within(screen.getByRole('dialog', { name: 'Writing practice', hidden: true })).findByRole('img', { name: 'Handwriting area' })
    expect(loads).toEqual([['\u98df', 'ja']])
    expect(loads.every(([, language]) => language === 'ja')).toBe(true)
  })
  it('a link to the Writing page carries the Japanese language', () => {
    expect(buildWritingRoute('\u50cd', 'all')).toContain('lang=ja')
  })
})
