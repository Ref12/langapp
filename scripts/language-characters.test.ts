import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyPublic, keepPublicFile } from './language-characters'

describe('a build ships its own language\'s stroke data only', () => {
  it('keeps the build language\'s folder and everything outside characters', () => {
    expect(keepPublicFile('ko', join('characters', 'korean', 'ATTRIBUTION.html'))).toBe(true)
    expect(keepPublicFile('ko', join('characters', 'korean'))).toBe(true)
    expect(keepPublicFile('ko', join('characters', 'chinese', 'u4e00.generated.json'))).toBe(false)
    expect(keepPublicFile('ko', join('characters', 'japanese'))).toBe(false)
    expect(keepPublicFile('ja', join('characters', 'japanese', 'index.generated.json'))).toBe(true)
    expect(keepPublicFile('zh', join('characters', 'chinese', 'hanzi-writer-selected.zip'))).toBe(true)
    expect(keepPublicFile('zh', join('characters', 'korean', 'index.generated.json'))).toBe(false)
    expect(keepPublicFile('zh', join('guides', 'hangul.html'))).toBe(true)
    expect(keepPublicFile('zh', 'characters')).toBe(true)
    expect(keepPublicFile('ja', 'icon.svg')).toBe(true)
  })

  it('copies a folder with the filter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'langapp-chars-'))
    try {
      const source = join(root, 'public')
      for (const folder of ['chinese', 'japanese', 'korean']) {
        await mkdir(join(source, 'characters', folder), { recursive: true })
        await writeFile(join(source, 'characters', folder, 'ATTRIBUTION.html'), folder)
      }
      await writeFile(join(source, 'icon.svg'), '<svg/>')
      await copyPublic('ja', source, join(root, 'dist'))
      expect((await readdir(join(root, 'dist', 'characters'))).sort()).toEqual(['japanese'])
      expect((await readdir(join(root, 'dist'))).sort()).toEqual(['characters', 'icon.svg'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
