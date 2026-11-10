import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { resetCharacterMeanings } from '../../core/characters/meanings'
import { CharacterIntro, WordParts } from './CharacterIntro'

// A pack without character data ships no meanings table: its build never asks for one (no 404 in the console).
const urls: string[] = []
beforeEach(() => {
  urls.length = 0
  resetCharacterMeanings()
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => { urls.push(String(input)); return new Response('{}', { status: 404 }) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined) })

describe('character intro meanings', () => {
  it('a Japanese build asks for no meanings file', async () => {
    setBuildLanguageForTests('ja')
    render(<><CharacterIntro character={'\u50cd'} onStart={() => undefined} onKnown={() => undefined} /><WordParts word={'\u50cd\u304f'} /></>)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(urls.filter(url => url.includes('meanings'))).toEqual([])
  })
  it('the Chinese build still loads its own', async () => {
    render(<CharacterIntro character={'\u5b66'} onStart={() => undefined} onKnown={() => undefined} />)
    await waitFor(() => expect(urls.some(url => url.includes('characters/chinese/meanings.generated.json'))).toBe(true))
  })
})
