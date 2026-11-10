import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBuildLanguageForTests } from '../../core/storage-names'
import * as assets from '../../core/characters/assets'
import { StrokeOrder } from './StrokeOrder'
import { StrokePad } from './StrokePad'

// In a Japanese build the stroke views take every guided character (kana too) and ask for Japanese data.
const loads: [string, string | undefined][] = []
beforeEach(() => {
  setBuildLanguageForTests('ja')
  loads.length = 0
  vi.spyOn(assets, 'loadCharacterAsset').mockImplementation(async (character, language) => {
    loads.push([character, language])
    return { character, strokeCount: 1, reviewed: false, variant: 'japanese-source', paths: ['M10 50 L90 50'] }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined) })

describe('stroke views in a Japanese build', () => {
  it('the stroke order view loads each kanji and kana from the Japanese data', async () => {
    render(<StrokeOrder text={'\u50cd\u304f\u8fd9'} />)
    await waitFor(() => expect(loads.length).toBeGreaterThan(0))
    expect(loads.every(([, language]) => language === 'ja')).toBe(true)
    expect(loads.map(([character]) => character)).not.toContain('\u8fd9')
  })
  it('the write pad loads Japanese strokes, kana included', async () => {
    render(<StrokePad text={'\u3042'} onDone={() => undefined} />)
    await waitFor(() => expect(loads).toEqual([['\u3042', 'ja']]))
  })
})
