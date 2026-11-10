// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptedGaps, appCharacters, buildWritingJaKo } from './generate-app-writing-ja-ko.mjs'

const fileOf = (url: string) => join('public', ...url.replace(/^\//, '').split('/'))
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => existsSync(fileOf(url)) ? response(JSON.parse(readFileSync(fileOf(url), 'utf8'))) : response({}, 404)))
})
afterEach(() => { vi.unstubAllGlobals() })

const shipped = (): Record<string, number> => JSON.parse(readFileSync(join('public', 'characters', 'japanese', 'index.generated.json'), 'utf8')).characters

describe('Japanese stroke data covers everything the Japanese app shows', () => {
  it('loads the five course kanji that used to have no data, each with at least one stroke', async () => {
    const { loadCharacterAsset } = await import('../src/core/characters/assets')
    for (const character of ['嬉', '椅', '隣', '餃', '麺']) {
      const asset = await loadCharacterAsset(character, 'ja')
      expect(asset.variant).toBe('japanese-source')
      expect(asset.strokeCount).toBeGreaterThanOrEqual(1)
      expect(asset.paths).toHaveLength(asset.strokeCount)
    }
  })

  it('has an index entry for every kanji in the course data and every kana the data uses', () => {
    const index = shipped(), app = appCharacters()
    expect(app.course.length).toBeGreaterThan(200)
    expect(app.course.filter(character => !(character in index))).toEqual([])
    expect(app.kana.filter(character => !(character in index))).toEqual([])
  })

  it('has an entry for every dictionary kanji except the accepted gaps, and the accepted list is short and reasoned', () => {
    const index = shipped(), app = appCharacters(), gaps = acceptedGaps()
    expect(app.dictionary.filter(character => !(character in index) && !gaps[character])).toEqual([])
    for (const [character, reason] of Object.entries(gaps)) {
      expect(character in index).toBe(false)
      expect(reason.length).toBeGreaterThan(20)
      expect(app.course).not.toContain(character)
    }
    expect(Object.keys(gaps).length).toBeLessThanOrEqual(5)
  })

  it('is regenerated from the data: the generator reports nothing stale and no failures', () => {
    const data = buildWritingJaKo()
    expect(data.japanese.failures).toEqual([])
    expect(readFileSync(join('curriculum', 'japanese', 'characters', 'app-kanji.yaml'), 'utf8')).toBe(data.japanese.list)
  })

  it('keeps the Japanese shape and stroke order for 読 (not the Chinese data)', async () => {
    const { loadCharacterAsset } = await import('../src/core/characters/assets')
    const ja = await loadCharacterAsset('読', 'ja')
    expect(ja.variant).toBe('japanese-source')
    const zh = await loadCharacterAsset('読', 'zh').catch(() => null)
    if (zh) expect(ja.paths).not.toEqual(zh.paths)
  })
})
