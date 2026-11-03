import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCharacterOrigin, provenanceLine, resetCharacterOrigins } from './origins'
import type { DictionaryCharacter } from './dictionary'

const asset = { character: '\u9e23', strokeCount: 8, reviewed: false, variant: 'source-median' } as DictionaryCharacter['asset']
const builtIn: DictionaryCharacter = { character: '\u9e23', asset, words: [], bands: [] }
afterEach(() => { resetCharacterOrigins(); vi.unstubAllGlobals() })

describe('character provenance line', () => {
  it('names the built-in list and the word for a character that is only built in', () => {
    expect(provenanceLine({ entry: builtIn, knownWords: [], origin: ['7-9', '\u5171\u9e23', 'w'] })).toBe('Built-in writing guide \u00b7 HSK 7\u20139 word \u5171\u9e23')
    expect(provenanceLine({ entry: builtIn, knownWords: [], origin: ['', '', 't'] })).toBe('Built-in writing guide \u00b7 course tracks only')
  })
  it('puts your own words first, then the built-in list', () => {
    const entry = { ...builtIn, character: '\u8336' }
    expect(provenanceLine({ entry, knownWords: ['\u8336\u676f', '\u8336\u53f6', '\u7ea2\u8336', '\u7eff\u8336'], origin: ['1', '\u8336', 'w'] }))
      .toBe('From your words: \u8336\u676f, \u8336\u53f6, \u7ea2\u8336 (+1 more) \u00b7 Built-in writing guide \u00b7 HSK 1 word \u8336')
  })
  it('says when and that it was added manually', () => {
    const line = provenanceLine({ entry: { character: '\u6c34', words: [], bands: [] }, knownWords: [], state: { character: '\u6c34', manualAddedAt: Date.UTC(2026, 10, 2, 12), practiceCompletions: 0 } })
    expect(line).toBe('Added manually Nov 2, 2026')
  })
  it('loads the origin table once and tolerates a failed fetch', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ origins: { '\u9e23': ['7-9', '\u5171\u9e23', 'w'] } }) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await loadCharacterOrigin('\u9e23')).toEqual(['7-9', '\u5171\u9e23', 'w'])
    expect(await loadCharacterOrigin('\u4e00')).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resetCharacterOrigins(); vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    expect(await loadCharacterOrigin('\u9e23')).toBeUndefined()
  })
})
