import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CharacterCard } from './CharacterCard'
import { resetCharacterMeanings } from '../../core/characters/meanings'
import { resetCharacterOrigins } from '../../core/characters/origins'
import type { DictionaryCharacter } from '../../core/characters/dictionary'

const asset = { character: '\u9e23', strokeCount: 8, reviewed: false, variant: 'source-median' } as DictionaryCharacter['asset']
const word = { ref: 'vocabulary:tea-cup', kind: 'vocabulary', band: '1', record: { id: 'v', ch: '\u8336\u676f', pr: 'cha bei', ds: 'teacup', lb: 'tea-cup' } } as unknown as DictionaryCharacter['words'][number]
const props = { scope: 'all' as const, pinyin: false, run: vi.fn(), busy: false }

afterEach(() => { cleanup(); resetCharacterMeanings(); resetCharacterOrigins(); vi.unstubAllGlobals() })
function stubTables() {
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, json: async () => String(url).includes('origins')
    ? { origins: { '\u9e23': ['7-9', '\u5171\u9e23', 'w'], '\u8336': ['1', '\u8336', 'w'] } }
    : { meanings: { '\u9e23': ['m\u00edng', 'cry of bird or animal; make sound'] } } }))
}

describe('CharacterCard provenance', () => {
  it('shows the built-in list and a labelled character gloss when no word uses the character', async () => {
    stubTables()
    render(<CharacterCard {...props} entry={{ character: '\u9e23', asset, words: [], bands: [] }} automatic={false} manual={false} />)
    expect(await screen.findByText('cry of bird or animal; make sound')).toBeInTheDocument()
    expect(screen.getByTestId('character-meaning')).toBeInTheDocument()
    expect(screen.queryByTestId('character-info')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Details for \u9e23' }))
    expect(await screen.findByText('Built-in writing guide \u00b7 HSK 7\u20139 word \u5171\u9e23')).toBeInTheDocument()
    expect(screen.getByText('Not in your set')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/U\+[0-9A-F]{4}/)
  })
  it('names the word for a character from your words, and a manual addition', async () => {
    stubTables()
    render(<CharacterCard {...props} entry={{ character: '\u8336', asset, words: [word], bands: ['1'] }} automatic manual known={new Set(['vocabulary:tea-cup'])}
      state={{ character: '\u8336', manualAddedAt: Date.UTC(2026, 10, 2, 12), practiceCompletions: 0 }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Details for \u8336' }))
    expect(await screen.findByText('From your words: \u8336\u676f \u00b7 Added manually Nov 2, 2026 \u00b7 Built-in writing guide \u00b7 HSK 1 word \u8336')).toBeInTheDocument()
  })
  it('shows one usage example with its meaning and expands the other words', async () => {
    stubTables()
    const other = { ...word, ref: 'vocabulary:tea', record: { id: 'v2', ch: '\u8336', pr: 'ch\u00e1', ds: 'tea', lb: 'tea' } } as unknown as DictionaryCharacter['words'][number]
    render(<CharacterCard {...props} pinyin entry={{ character: '\u8336', asset, words: [other, word], bands: ['1'] }} automatic={false} manual={false} known={new Set(['vocabulary:tea-cup'])} />)
    const usage = screen.getByTestId('character-usage')
    expect(within(usage).getByText('teacup')).toBeInTheDocument()
    expect(within(usage).queryByText('tea')).toBeNull()
    await userEvent.setup().click(within(usage).getByRole('button', { name: 'More words (1)' }))
    expect(within(usage).getByText('tea')).toBeInTheDocument()
  })
  it('shows the character\u2019s own word meaning when the table has none', async () => {
    stubTables()
    const own = { ...word, ref: 'vocabulary:tea', record: { id: 'v2', ch: '\u8336', pr: 'ch\u00e1', ds: 'tea', lb: 'tea' } } as unknown as DictionaryCharacter['words'][number]
    render(<CharacterCard {...props} entry={{ character: '\u8336', asset, words: [own], bands: ['1'] }} automatic manual={false} />)
    expect(await screen.findByText('tea', { selector: '[data-testid="character-meaning"]' })).toBeInTheDocument()
  })
})

describe('CharacterCard I can write this and Keep', () => {
    it('treats a practiced character as Can write, and the toggle turns it off (to cannot)', async () => {
      stubTables()
      const run = vi.fn((operation: () => Promise<unknown>) => operation())
      const { db } = await import('../../core/database')
      await db.characterStates.put({ character: '\u9e23', practiceCompletions: 3, lastPracticedAt: 5 })
      render(<CharacterCard {...props} run={run as never} entry={{ character: '\u9e23', asset, words: [], bands: [] }} automatic={false} manual={false} state={{ character: '\u9e23', practiceCompletions: 3, lastPracticedAt: 5 }} />)
      expect(screen.getByText('Can write')).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Details for \u9e23' }))
      expect(screen.getByText(/Practiced 3×/)).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: /^I can write \u9e23/ }))
      await vi.waitFor(async () => expect((await db.characterStates.get('\u9e23'))?.writeState).toBe('cannot'))
      expect((await db.characterStates.get('\u9e23'))?.practiceCompletions).toBe(3)
    })
  it('shows a Can write tag and a pressed toggle when flagged, and the toggle runs the undoable action', async () => {
    stubTables()
    const run = vi.fn()
    render(<CharacterCard {...props} run={run} entry={{ character: '\u9e23', asset, words: [], bands: [] }} automatic={false} manual={false} state={{ character: '\u9e23', practiceCompletions: 0, writeState: 'can' }} />)
    expect(screen.getByText('Can write')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /^I can write \u9e23/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.setup().click(toggle)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('is off by default, with Keep moved into the ⋯ menu for an automatic character and Add for one not in the set', async () => {
    stubTables()
    const user = userEvent.setup()
    const { unmount } = render(<CharacterCard {...props} entry={{ character: '\u8336', asset, words: [word], bands: ['1'] }} automatic manual={false} known={new Set(['vocabulary:tea-cup'])} />)
    expect(screen.queryByText('Can write')).toBeNull()
      expect(screen.getByText('Not yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^I can write \u8336/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /^Keep/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Details for \u8336' }))
    expect(within(screen.getByTestId('character-info')).getByRole('button', { name: 'Keep \u8336 even if my words change' })).toHaveTextContent('Keep even if my words change')
    unmount()
    render(<CharacterCard {...props} entry={{ character: '\u8336', asset, words: [], bands: [] }} automatic={false} manual={false} />)
    expect(screen.getByRole('button', { name: /^Add \u8336/ })).toBeInTheDocument()
  })
})
