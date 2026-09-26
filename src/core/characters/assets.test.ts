// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = () => JSON.parse(readFileSync(join('public', 'characters', 'chinese', 'u004e.generated.json'), 'utf8'))
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response
beforeEach(() => { vi.resetModules() })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.doUnmock('../../data/characters/index.generated.json')
})

describe('Chinese writing page loader', () => {
  it('loads metadata without fetching or eagerly bundling geometry', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const assets = await import('./assets')
    expect(assets.characterAssetIndex).toHaveLength(3001)
    expect(assets.characterAssetIndex.filter(record => record.reviewed)).toHaveLength(5)
    expect(assets.characterAssetIndex.every(record => !('paths' in record))).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('respects deployment BASE_URL, loads exact defaults, and shares page requests', async () => {
    vi.stubEnv('BASE_URL', '/langapp/next/')
    const fetch = vi.fn().mockResolvedValue(response(page()))
    vi.stubGlobal('fetch', fetch)
    const assets = await import('./assets')
    expect(assets.characterAttributionUrl).toBe('/langapp/next/characters/chinese/ATTRIBUTION.html')
    const [one, ding] = await Promise.all([assets.loadCharacterAsset('一'), assets.loadCharacterAsset('丁')])
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/langapp/next/characters/chinese/u004e.generated.json')
    expect(one).toMatchObject({ character: '一', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M15.838 51.693 L85.496 45.049'] })
    expect(ding).toMatchObject({ character: '丁', strokeCount: 2, reviewed: false, variant: 'source-median' })
    one.paths[0] = 'corrupted caller copy'
    one.provenance!.member = 'wrong'
    const again = await assets.loadCharacterAsset('一')
    expect(again.paths[0]).toBe('M15.838 51.693 L85.496 45.049')
    expect(again.provenance!.member).toBe('data/一.json')
  })

  it.each(['', '一 ', ' 一', '一\uFE00', '一丁', '\uD800', '。', '../../other', 'A'])('rejects nonmember key %j without normalization or fetch', async character => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { loadCharacterAsset } = await import('./assets')
    await expect(loadCharacterAsset(character)).rejects.toThrow(/No Chinese writing guide/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('supports relative production bases', async () => {
    vi.stubEnv('BASE_URL', './')
    const fetch = vi.fn().mockResolvedValue(response(page()))
    vi.stubGlobal('fetch', fetch)
    const { loadCharacterAsset } = await import('./assets')
    await loadCharacterAsset('一')
    expect(fetch).toHaveBeenCalledWith('./characters/chinese/u004e.generated.json')
  })

  it('follows regenerated source pins and rejects pages carrying the previous pins', async () => {
    const refreshedIndex = JSON.parse(readFileSync(join('src', 'data', 'characters', 'index.generated.json'), 'utf8'))
    const sourcePin = refreshedIndex.sourcePins['zh-writing-hanzi-writer']
    sourcePin.revision = 'a'.repeat(40)
    sourcePin.archiveSha256 = 'b'.repeat(64)
    vi.doMock('../../data/characters/index.generated.json', () => ({ default: refreshedIndex }))
    const refreshedPage = page()
    for (const record of refreshedPage.characters) {
      record.provenance.sourceArchiveSha256 = sourcePin.archiveSha256
      record.provenance.sourceEntry = `https://raw.githubusercontent.com/chanind/hanzi-writer-data/${sourcePin.revision}/${record.provenance.member}`
    }
    const fetch = vi.fn().mockResolvedValueOnce(response(page())).mockResolvedValueOnce(response(refreshedPage))
    vi.stubGlobal('fetch', fetch)
    const { loadCharacterAsset } = await import('./assets')
    await expect(loadCharacterAsset('一')).rejects.toThrow(/Invalid Chinese writing asset page/)
    await expect(loadCharacterAsset('一')).resolves.toMatchObject({
      provenance: { sourceArchiveSha256: sourcePin.archiveSha256, sourceEntry: `https://raw.githubusercontent.com/chanind/hanzi-writer-data/${sourcePin.revision}/data/一.json` },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['network', 'http', 'json', 'shape'])('does not permanently cache rejected %s requests', async failure => {
    const fetch = vi.fn()
    if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'))
    if (failure === 'http') fetch.mockResolvedValueOnce(response({}, 404))
    if (failure === 'json') fetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('invalid JSON') } })
    if (failure === 'shape') fetch.mockResolvedValueOnce(response({}))
    fetch.mockResolvedValueOnce(response(page()))
    vi.stubGlobal('fetch', fetch)
    const { loadCharacterAsset } = await import('./assets')
    await expect(loadCharacterAsset('一')).rejects.toThrow()
    await expect(loadCharacterAsset('一')).resolves.toMatchObject({ character: '一' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['version', (input: ReturnType<typeof page>) => { input.schemaVersion = 2 }],
    ['language', (input: ReturnType<typeof page>) => { input.language = 'japanese' }],
    ['page', (input: ReturnType<typeof page>) => { input.page = 'u004f' }],
    ['notice', (input: ReturnType<typeof page>) => { delete input.notice }],
    ['missing entry', (input: ReturnType<typeof page>) => { input.characters.pop() }],
    ['duplicate entry', (input: ReturnType<typeof page>) => { input.characters[1] = input.characters[0] }],
    ['foreign entry', (input: ReturnType<typeof page>) => { input.characters[1].character = '雨' }],
    ['review', (input: ReturnType<typeof page>) => { input.characters[1].reviewed = true }],
    ['variant', (input: ReturnType<typeof page>) => { input.characters[1].variant = 'refined-candidate' }],
    ['stroke count', (input: ReturnType<typeof page>) => { input.characters[1].paths.pop() }],
    ['source member', (input: ReturnType<typeof page>) => { input.characters[1].provenance.member = 'data/雨.json' }],
    ['source archive hash', (input: ReturnType<typeof page>) => { input.characters[1].provenance.sourceArchiveSha256 = 'f'.repeat(64) }],
    ['source revision', (input: ReturnType<typeof page>) => { input.characters[1].provenance.sourceEntry = input.characters[1].provenance.sourceEntry.replace(/\/[a-f0-9]{40}\//, `/${'f'.repeat(40)}/`) }],
    ['missing review evidence', (input: ReturnType<typeof page>) => { delete input.characters[0].provenance.review }],
    ['bad path type', (input: ReturnType<typeof page>) => { input.characters[1].paths[0] = 42 }],
    ['markup', (input: ReturnType<typeof page>) => { input.characters[1].paths[0] = '<svg onload="alert(1)"/>' }],
    ['multiple pen-downs', (input: ReturnType<typeof page>) => { input.characters[1].paths[0] = 'M0 0 L10 10 M20 20 L30 30' }],
    ['out of bounds', (input: ReturnType<typeof page>) => { input.characters[1].paths[0] = 'M0 0 C0 0 101 101 50 50' }],
    ['zero length', (input: ReturnType<typeof page>) => { input.characters[1].paths[0] = 'M5 5 Q5 5 5 5' }],
  ])('rejects invalid incoming %s for the whole page', async (_name, mutate) => {
    const input = page()
    mutate(input)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(input)))
    const { loadCharacterAsset } = await import('./assets')
    await expect(loadCharacterAsset('一')).rejects.toThrow(/Invalid Chinese writing asset page/)
  })
})
