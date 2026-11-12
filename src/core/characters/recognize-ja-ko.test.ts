// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeStrokeGuide, type Point } from './geometry'
import { decodeRecognitionIndex, loadRecognitionIndex, recognize, type RecognitionFile } from './recognize'
import { buildIndex } from '../../../scripts/generate-recognition-index.mjs'

const pages = new Map<string, { characters: { character: string; paths: string[] }[] }>()
const medians = (folder: string, character: string): Point[][] => {
  const page = `u${(character.codePointAt(0)! >>> 8).toString(16).padStart(4, '0')}`
  const key = folder + page
  if (!pages.has(key)) pages.set(key, JSON.parse(readFileSync(join('public', 'characters', folder, `${page}.generated.json`), 'utf8')))
  return pages.get(key)!.characters.find(entry => entry.character === character)!.paths.map(path => makeStrokeGuide(path).points)
}
const load = (folder: string) => decodeRecognitionIndex(JSON.parse(readFileSync(join('public', 'characters', folder, 'recognition.generated.json'), 'utf8')) as RecognitionFile)

describe('Japanese and Korean built-in matcher', () => {
  it('recognises kana and kanji from the Japanese stroke data', () => {
    const index = load('japanese')
    for (const character of [...'あか大木学']) expect(recognize(index, medians('japanese', character))[0].character, character).toBe(character)
  }, 60_000)
  it('recognises Hangul from the Korean stroke data', () => {
    const index = load('korean')
    for (const character of [...'가한']) expect(recognize(index, medians('korean', character))[0].character, character).toBe(character)
  }, 60_000)
  it('only offers characters of its own language', () => {
    expect(load('japanese').glyphs.some(glyph => glyph.character === '한')).toBe(false)
    expect(load('korean').glyphs.some(glyph => glyph.character === '木')).toBe(false)
  })
  it('favours lesson characters between close candidates and keeps a clear winner', () => {
    const index = load('japanese')
    const drawing = medians('japanese', '大')
    expect(recognize(index, drawing, { preferred: new Set(['木']) })[0].character).toBe('大')
  })
  it('ships indexes that are current with the stroke pages', () => {
    for (const [folder, language] of [['japanese', 'japanese'], ['korean', 'korean']]) {
      expect(JSON.stringify(buildIndex(folder, language)) + '\n').toBe(readFileSync(join('public', 'characters', folder, 'recognition.generated.json'), 'utf8'))
    }
  })
})

describe('missing handwriting data', () => {
  it('gives a clear message, not a raw 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    await expect(loadRecognitionIndex('x', 'Japanese')).rejects.toThrow('This build has no built-in handwriting data for Japanese. Use another recognizer.')
    vi.unstubAllGlobals()
  })
})
