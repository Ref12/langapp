// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWritingJaKo, synchronize } from '../../../scripts/generate-app-writing-ja-ko.mjs'

const folders = { ja: 'japanese', ko: 'korean', zh: 'chinese' } as const
const fileOf = (url: string) => join('public', ...url.replace(/^\//, '').split('/'))
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response
/** Serves public/ files by URL, like the dev server would; unknown URLs are 404. */
const serve = () => {
  const fetch = vi.fn(async (url: string) => existsSync(fileOf(url)) ? response(JSON.parse(readFileSync(fileOf(url), 'utf8'))) : response({}, 404))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('per-language writing loaders', () => {
  it('fetches each language from its own folder and never touches Chinese for ja/ko', async () => {
    const fetch = serve()
    const { loadCharacterAsset } = await import('./assets')
    const kana = await loadCharacterAsset('あ', 'ja')
    const hangul = await loadCharacterAsset('가', 'ko')
    expect(kana).toMatchObject({ character: 'あ', variant: 'japanese-source' })
    expect(kana.paths.length).toBe(kana.strokeCount)
    expect(hangul).toMatchObject({ character: '가', strokeCount: 3, review: 'ai-reviewed', reviewed: false })
    const urls = fetch.mock.calls.map(call => call[0] as string)
    expect(urls).toEqual(['/characters/japanese/index.generated.json', '/characters/japanese/u0030.generated.json', '/characters/korean/index.generated.json', '/characters/korean/u00ac.generated.json'])
  })

  it('keeps Chinese on its own URL by default', async () => {
    const fetch = serve()
    const { loadCharacterAsset } = await import('./assets')
    const one = await loadCharacterAsset('一')
    expect(one.reviewed).toBe(true)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/characters/chinese/u004e.generated.json')
  })

  it('a Japanese miss is a miss: no Chinese strokes', async () => {
    const fetch = serve()
    const { loadCharacterAsset } = await import('./assets')
    // 这 (simplified) is not in the Japanese set, but exists in the Chinese data. 的 is now in it: the Japanese dictionary uses it.
    await expect(loadCharacterAsset('这', 'ja')).rejects.toThrow(/No Japanese writing guide/)
    await expect(loadCharacterAsset('一', 'ko')).rejects.toThrow(/No Korean writing guide/)
    expect((fetch.mock.calls.map(call => call[0] as string)).every(url => !url.includes('/chinese/'))).toBe(true)
  })

  it('keeps Japanese 右 apart from the Chinese one', async () => {
    serve()
    const { loadCharacterAsset } = await import('./assets')
    const [ja, zh] = await Promise.all([loadCharacterAsset('右', 'ja'), loadCharacterAsset('右', 'zh')])
    expect(ja.paths).not.toEqual(zh.paths)
    expect(ja.strokeCount).toBe(5)
  })

  it('rejects a corrupt page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(String(url).includes('index') ? { schemaVersion: 1, language: 'korean', characters: { 가: 3 } } : { schemaVersion: 1, language: 'korean', page: 'uac00', notice: 'CC0', characters: [{ character: '가', strokeCount: 3, paths: ['bad', 'bad', 'bad'] }] })))
    const { loadCharacterAsset } = await import('./assets')
    await expect(loadCharacterAsset('가', 'ko')).rejects.toThrow(/Invalid Korean writing asset/)
  })
})

describe('shipped Japanese and Korean data', () => {
  it('is current for the generator (--check semantics) and complete', () => {
    const data = buildWritingJaKo()
    expect(data.japanese.failures).toEqual([])
    expect(data.korean.failures).toEqual([])
    for (const name of ['japanese', 'korean'] as const) expect(synchronize(data[name].outputs, name, true)).toEqual([])
    const kana = ['あ', 'ぁ', 'ゔ', '゛', '゜', 'ア', 'ッ', 'ー', 'ヺ'].filter(character => data.japanese.entries.has(character))
    expect(kana).toEqual(expect.arrayContaining(['あ', 'ぁ', 'ア', 'ッ', 'ー', '゛', '゜']))
    expect(data.japanese.counts).toMatchObject({ n5: 79, n4: 166 })
    for (const kanji of ['右', '図', '書', '日']) expect(data.japanese.entries.has(kanji)).toBe(true)
    expect(data.korean.counts.syllables).toBeGreaterThanOrEqual(514) // TOPIK 1 syllables plus those the parallel lessons use
    expect(['한', '국', '어'].every(character => data.korean.entries.get(character)?.review === 'ai-reviewed')).toBe(true)
    expect(data.korean.entries.get('ㄱ')?.review).toBeUndefined()
  })

  it('ships licence and attribution files next to the data', () => {
    for (const file of ['ATTRIBUTION.html', 'writing-ARPHICPL.txt', 'writing-kanjivg-COPYING.txt']) expect(existsSync(join('public', 'characters', folders.ja, file))).toBe(true)
    for (const file of ['ATTRIBUTION.html', 'ORIGINAL-WRITING-PILOT.md']) expect(existsSync(join('public', 'characters', folders.ko, file))).toBe(true)
  })

  it('renders a sample of kana, kanji and Hangul as drawable strokes', async () => {
    serve()
    const { loadCharacterAsset } = await import('./assets')
    const { makeStrokeGuide } = await import('./geometry')
    for (const [character, language] of [['し', 'ja'], ['ツ', 'ja'], ['図', 'ja'], ['한', 'ko'], ['ㅎ', 'ko']] as const) {
      const asset = await loadCharacterAsset(character, language)
      expect(asset.paths.length).toBeGreaterThan(0)
      for (const path of asset.paths) expect(makeStrokeGuide(path).length).toBeGreaterThan(0)
    }
  })
})
