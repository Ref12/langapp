import { cleanup, render, screen } from '@testing-library/react'
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
    expect(await screen.findByText('Built-in writing guide \u00b7 HSK 7\u20139 word \u5171\u9e23')).toBeInTheDocument()
    expect(await screen.findByText(/Character gloss:/)).toBeInTheDocument()
    expect(screen.getByText('cry of bird or animal; make sound')).toBeInTheDocument()
    expect(screen.queryByText('No word in the current app bands.')).not.toBeInTheDocument()
    expect(screen.getByText('Not in your set')).toBeInTheDocument()
  })
  it('names the word for a character from your words, and a manual addition', async () => {
    stubTables()
    render(<CharacterCard {...props} entry={{ character: '\u8336', asset, words: [word], bands: ['1'] }} automatic manual known={new Set(['vocabulary:tea-cup'])}
      state={{ character: '\u8336', manualAddedAt: Date.UTC(2026, 10, 2, 12), practiceCompletions: 0 }} />)
    expect(await screen.findByText('From your words: \u8336\u676f \u00b7 Added manually Nov 2, 2026 \u00b7 Built-in writing guide \u00b7 HSK 1 word \u8336')).toBeInTheDocument()
    expect(screen.queryByText(/Character gloss:/)).not.toBeInTheDocument()
  })
})
