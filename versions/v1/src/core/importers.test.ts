import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chaptersFor, importFile, importUrl, splitIntoChapters } from './importers'
import type { LibraryItem } from './domain'

afterEach(() => vi.unstubAllGlobals())

describe('chapter splitting', () => {
  it('recognizes markdown headings', () => {
    const chapters = splitIntoChapters(
      '# Arrival\nThe train arrived.\n\n# Departure\nIt left again.',
    )

    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.title).toBe('Arrival')
    expect(chapters[1]?.content).toContain('left again')
  })

  it('keeps unstructured text as one chapter', () => {
    const chapters = splitIntoChapters('A short standalone article.', 'Article')

    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe('Article')
  })

  it('retains v1 analysis fields and unique chapter IDs', () => {
    const chapters = splitIntoChapters('# One\nFirst.\n# Two\nSecond.')
    expect(chapters[0]).toMatchObject({ annotations: [], analysisStatus: 'not-analyzed' })
    expect(chapters[0].id).toMatch(/^chapter_/)
    expect(chapters[0].id).not.toBe(chapters[1].id)
  })
})

describe('v1 import adapters', () => {
  it('retains joined content and filename-based titles', async () => {
    const result = await importFile(new File(['# One\nFirst.\n# Two\nSecond.'], 'legacy.md'))
    expect(result).toMatchObject({ title: 'legacy', sourceType: 'markdown', content: 'First.\n\nSecond.' })
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0]).toMatchObject({ annotations: [], analysisStatus: 'not-analyzed' })
  })

  it('preserves the legacy EPUB filename title instead of switching to metadata', async () => {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
    zip.file('book.opf', `
      <package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>Metadata title</dc:title></metadata>
        <manifest><item id="one" href="one.xhtml"/></manifest>
        <spine><itemref idref="one"/></spine>
      </package>`)
    zip.file('one.xhtml', '<html><body><p>Chapter content.</p></body></html>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const result = await importFile(new File([bytes], 'Legacy filename.epub'))
    expect(result).toMatchObject({
      title: 'Legacy filename', sourceType: 'epub', content: 'Chapter content.',
    })
  })

  it('retains URL chapter and combined content contracts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<title>Web title</title><p>Article body.</p>')))
    expect(await importUrl('https://example.com')).toMatchObject({
      title: 'Web title', sourceType: 'url', content: 'Article body.',
      chapters: [{ title: 'Web title', content: 'Article body.', annotations: [], analysisStatus: 'not-analyzed' }],
    })
  })

  it('retains existing chapters and the old single-document fallback', () => {
    const item = {
      id: 'legacy', content: 'Old content.', annotations: [],
      analysisStatus: 'failed', analysisError: 'Old error',
    } as unknown as LibraryItem
    expect(chaptersFor(item)).toEqual([{
      id: 'legacy_chapter_1', title: 'Full text', content: 'Old content.',
      annotations: [], analysisStatus: 'failed', analysisError: 'Old error',
    }])
    item.chapters = splitIntoChapters('New content.')
    expect(chaptersFor(item)).toBe(item.chapters)
  })
})
