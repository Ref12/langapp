import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importDocumentFile, importDocumentUrl, splitDocumentChapters } from './document-import'

const packagePath = 'OPS/package.opf'
const packageXml = (manifest: string, spine: string, metadata = `
  <dc:title>The Fixture Book</dc:title><dc:creator>A. Writer</dc:creator>`) => `
  <opf:package xmlns:opf="http://www.idpf.org/2007/opf"
      xmlns:dc="http://purl.org/dc/elements/1.1/">
    <opf:metadata>${metadata}</opf:metadata>
    <opf:manifest>${manifest}</opf:manifest>
    <opf:spine>${spine}</opf:spine>
  </opf:package>`

function fixture() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', `
    <c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container">
      <c:rootfiles><c:rootfile full-path="${packagePath}"
        media-type="application/oebps-package+xml"/></c:rootfiles>
    </c:container>`)
  zip.file(packagePath, packageXml(`
    <opf:item id="second" href="Text/second.xhtml" media-type="application/xhtml+xml"/>
    <opf:item id="first" href="Text/first.xhtml" media-type="application/xhtml+xml"/>
  `, '<opf:itemref idref="first"/><opf:itemref idref="second"/>'))
  zip.file('OPS/Text/first.xhtml', `
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>First file</title></head>
      <body><h1>Arrival</h1><p>The train arrived.</p></body></html>`)
  zip.file('OPS/Text/second.xhtml', `
    <html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h2>Departure</h2><p>It left again.</p></body></html>`)
  return zip
}

async function epubFile(zip: JSZip, name = 'filename.epub') {
  return new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], name)
}

function directoryOffsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result: number[] = []
  for (let offset = 0; offset <= bytes.length - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) result.push(offset)
  }
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('shared text document import', () => {
  it.each([
    ['book.TXT', 'text'],
    ['book.md', 'markdown'],
    ['book.markdown', 'markdown'],
  ])('imports %s with pure chapter records', async (name, sourceType) => {
    const result = await importDocumentFile(new File([
      '\ufeff# Arrival\r\nThe train arrived.\r\n\r\n## Departure\r\nIt left again.',
    ], name))
    expect(result).toEqual({
      title: 'book',
      sourceType,
      chapters: [
        { title: 'Arrival', content: 'The train arrived.' },
        { title: 'Departure', content: 'It left again.' },
      ],
    })
  })

  it('keeps prefaces, recognizes traditional headings, and normalizes line endings', () => {
    expect(splitDocumentChapters(
      'A preface.\rChapter I\rA beginning.\rPart Two: Beyond\rAn ending.', 'Preface',
    )).toEqual([
      { title: 'Preface', content: 'A preface.' },
      { title: 'Chapter I', content: 'A beginning.' },
      { title: 'Part Two: Beyond', content: 'An ending.' },
    ])
  })

  it('preserves the v1 fallback for unstructured, empty, and headings-only input', () => {
    expect(splitDocumentChapters('  Text  ', 'Article')).toEqual([{ title: 'Article', content: 'Text' }])
    expect(splitDocumentChapters('')).toEqual([{ title: 'Full text', content: '' }])
    expect(splitDocumentChapters('# Alone')).toEqual([{ title: 'Full text', content: '# Alone' }])
  })

  it.each([
    ['empty.txt', ''],
    ['space.md', ' \n\t '],
  ])('rejects empty file %s', async (name, text) => {
    await expect(importDocumentFile(new File([text], name))).rejects.toThrow(/empty|readable text/)
  })

  it('rejects unsupported formats and oversized input before reading it', async () => {
    await expect(importDocumentFile(new File(['text'], 'book.pdf'))).rejects.toThrow('Choose a .txt')
    for (const [name, size] of [['large.epub', 64 * 1024 * 1024 + 1], ['large.txt', 20 * 1024 * 1024 + 1]] as const) {
      const file = new File(['small'], name)
      Object.defineProperty(file, 'size', { value: size })
      const arrayBuffer = vi.fn()
      Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
      await expect(importDocumentFile(file)).rejects.toThrow('size limit')
      expect(arrayBuffer).not.toHaveBeenCalled()
    }
  })
})

describe('EPUB import', () => {
  it('reads namespace-qualified metadata, following spine order rather than manifest order', async () => {
    const result = await importDocumentFile(await epubFile(fixture()))
    expect(result.title).toBe('The Fixture Book')
    expect(result.author).toBe('A. Writer')
    expect(result.sourceType).toBe('epub')
    expect(result.chapters).toEqual([
      { title: 'Arrival', content: 'Arrival\n\nThe train arrived.' },
      { title: 'Departure', content: 'Departure\n\nIt left again.' },
    ])
  })

  it('uses the filename when optional metadata is absent', async () => {
    const zip = fixture()
    zip.file(packagePath, packageXml(
      '<opf:item id="one" href="Text/first.xhtml"/>', '<opf:itemref idref="one"/>', '',
    ))
    const result = await importDocumentFile(await epubFile(zip, 'Fallback.epub'))
    expect(result.title).toBe('Fallback')
    expect(result.author).toBeUndefined()
  })

  it('resolves relative paths, percent-encoded filenames, queries and fragments', async () => {
    const zip = fixture()
    zip.file(packagePath, packageXml(
      '<opf:item id="one" href="../Text/./caf%C3%A9%20one.xhtml?edition=1#start"/>',
      '<opf:itemref idref="one"/><opf:itemref idref="one"/>',
    ))
    zip.file('Text/café one.xhtml', '<html><body><p>A readable chapter.</p></body></html>')
    const result = await importDocumentFile(await epubFile(zip))
    expect(result.chapters).toEqual([{ title: 'Chapter 1', content: 'A readable chapter.' }])
  })

  it('drops executable/navigation content without duplicating nested blocks or losing loose text', async () => {
    const zip = fixture()
    zip.file('OPS/Text/first.xhtml', `
      <html><body><h1>Safe title</h1>
        <script>BAD_SCRIPT</script><style>BAD_STYLE</style><nav>BAD_NAV</nav>
        <iframe>BAD_FRAME</iframe><object>BAD_OBJECT</object><template>BAD_TEMPLATE</template>
        <div hidden="">BAD_HIDDEN</div><p aria-hidden="true">BAD_ARIA</p>
        <blockquote><p>Quoted once.</p></blockquote>
        <ul><li>Outer list.<ul><li>Inner list.</li></ul></li></ul>
        <div>Loose before.<p>Middle paragraph.</p>Loose after.<br/>Final line.</div>
      </body></html>`)
    const result = await importDocumentFile(await epubFile(zip))
    const content = result.chapters[0].content
    expect(content).not.toContain('BAD_')
    for (const phrase of ['Quoted once.', 'Outer list.', 'Inner list.', 'Loose before.', 'Middle paragraph.', 'Loose after.', 'Final line.']) {
      expect(content.split(phrase)).toHaveLength(2)
    }
    expect(content).toContain('Loose after.\nFinal line.')
  })

  it('preserves readable body fallback and prefixed XHTML', async () => {
    const zip = fixture()
    zip.file('OPS/Text/first.xhtml', `
      <x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:head><x:title>Fallback title</x:title></x:head>
        <x:body>Some <x:span>inline</x:span> body text.</x:body></x:html>`)
    const result = await importDocumentFile(await epubFile(zip))
    expect(result.chapters[0]).toEqual({
      title: 'Fallback title', content: 'Some inline body text.',
    })
  })

  it('skips nav manifest items and image-only covers but retains supplementary readable chapters', async () => {
    const zip = fixture()
    zip.file(packagePath, packageXml(`
      <opf:item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
      <opf:item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
      <opf:item id="one" href="Text/first.xhtml" media-type="application/xhtml+xml"/>
    `, '<opf:itemref idref="nav"/><opf:itemref idref="cover"/><opf:itemref idref="one" linear="no"/>'))
    zip.file('OPS/nav.xhtml', '<html><body><h1>Navigation only</h1></body></html>')
    zip.file('OPS/cover.xhtml', '<html><body><img src="cover.jpg"/></body></html>')
    const result = await importDocumentFile(await epubFile(zip))
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].title).toBe('Arrival')
  })

  it.each([
    ['META-INF/container.xml', 'required file'],
    [packagePath, 'required file'],
    ['OPS/Text/second.xhtml', 'spine file'],
  ])('rejects a missing %s instead of silently dropping content', async (path, message) => {
    const zip = fixture().remove(path)
    await expect(importDocumentFile(await epubFile(zip))).rejects.toThrow(message)
  })

  it.each([
    ['META-INF/container.xml', '<container>', 'malformed XML'],
    [packagePath, '<package>', 'malformed XML'],
    ['OPS/Text/first.xhtml', '<html><body><p>Broken</body></html>', 'malformed XML'],
    ['OPS/Text/first.xhtml', '<html><head><title>No body</title></head></html>', 'missing its body'],
  ])('rejects malformed or bodyless markup in %s', async (path, markup, message) => {
    const zip = fixture().file(path, markup)
    await expect(importDocumentFile(await epubFile(zip))).rejects.toThrow(message)
  })

  it('rejects unknown spine references, missing spine, duplicate IDs and empty books', async () => {
    for (const [xml, message] of [
      [packageXml('', '<opf:itemref idref="absent"/>'), 'missing manifest item'],
      ['<package><manifest/></package>', 'reading spine is missing'],
      [packageXml('<opf:item id="one"/><opf:item id="one"/>', ''), 'duplicate IDs'],
      [packageXml('', ''), 'readable chapters'],
    ]) {
      await expect(importDocumentFile(await epubFile(fixture().file(packagePath, xml)))).rejects.toThrow(message)
    }
  })

  it.each(['https://example.com/book.xhtml', '../../escape.xhtml', '/absolute.xhtml', 'Text/%zz.xhtml', 'Text%2ffirst.xhtml'])(
    'rejects invalid or remote content path %s without fetching',
    async (href) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const zip = fixture().file(packagePath, packageXml(
        `<opf:item id="one" href="${href}"/>`, '<opf:itemref idref="one"/>',
      ))
      await expect(importDocumentFile(await epubFile(zip))).rejects.toThrow(/path/)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('supports HTML spine items with explicit bodies and rejects nontext spine media', async () => {
    const zip = fixture().file(packagePath, packageXml(
      '<opf:item id="one" href="Text/first.xhtml" media-type="text/html"/>', '<opf:itemref idref="one"/>',
    ))
    zip.file('OPS/Text/first.xhtml', '<html><body><p>A loose HTML paragraph.<br>Second line.</body>')
    expect((await importDocumentFile(await epubFile(zip))).chapters[0].content)
      .toBe('A loose HTML paragraph.\nSecond line.')
    zip.file('OPS/Text/first.xhtml', '<p>No explicit body.</p>')
    await expect(importDocumentFile(await epubFile(zip))).rejects.toThrow('missing its body')
    zip.file(packagePath, packageXml(
      '<opf:item id="one" href="Text/first.xhtml" media-type="application/pdf"/>', '<opf:itemref idref="one"/>',
    ))
    await expect(importDocumentFile(await epubFile(zip))).rejects.toThrow('unsupported content')
  })

  it.each([
    ['http://www.w3.org/2001/04/xmlenc#aes128-cbc', false],
    ['http://www.idpf.org/2008/embedding', true],
    ['http://ns.adobe.com/pdf/enc#RC', true],
  ])('rejects DRM but permits standard font obfuscation: %s', async (algorithm, allowed) => {
    const zip = fixture().file('META-INF/encryption.xml', `
      <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <enc:EncryptedData xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
          <enc:EncryptionMethod Algorithm="${algorithm}"/>
        </enc:EncryptedData>
      </encryption>`)
    const promise = importDocumentFile(await epubFile(zip))
    if (allowed) expect((await promise).chapters).toHaveLength(2)
    else await expect(promise).rejects.toThrow('DRM')
  })

  it('rejects invalid archives and wrong EPUB mimetype', async () => {
    await expect(importDocumentFile(new File(['Not a ZIP'], 'fake.epub'))).rejects.toThrow('ZIP archive')
    const zip = fixture().file('mimetype', 'application/not-an-epub')
    await expect(importDocumentFile(await epubFile(zip))).rejects.toThrow('not an EPUB')
  })
})

describe('EPUB expansion limits', () => {
  it('rejects an oversized entry before loading or inflating the archive', async () => {
    const bytes = await fixture().generateAsync({ type: 'uint8array' })
    const view = new DataView(bytes.buffer)
    view.setUint32(directoryOffsets(bytes)[0] + 24, 32 * 1024 * 1024 + 1, true)
    const load = vi.spyOn(JSZip, 'loadAsync')
    await expect(importDocumentFile(new File([bytes], 'bomb.epub'))).rejects.toThrow('expanded size limit')
    expect(load).not.toHaveBeenCalled()
  })

  it('enforces total declared expansion, including entries that are not in the spine', async () => {
    const zip = fixture()
    for (let i = 0; i < 10; i++) zip.file(`unused-${i}.dat`, 'small')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const view = new DataView(bytes.buffer)
    for (const offset of directoryOffsets(bytes)) view.setUint32(offset + 24, 32 * 1024 * 1024, true)
    const load = vi.spyOn(JSZip, 'loadAsync')
    await expect(importDocumentFile(new File([bytes], 'bomb.epub'))).rejects.toThrow('expanded size limit')
    expect(load).not.toHaveBeenCalled()
  })

  it('rejects encrypted, split, ZIP64 and malformed central directories before load', async () => {
    const original = await fixture().generateAsync({ type: 'uint8array' })
    for (const mutate of [
      (view: DataView, first: number) => view.setUint16(first + 8, 1, true),
      (view: DataView) => view.setUint16(view.byteLength - 18, 1, true),
      (view: DataView) => view.setUint32(view.byteLength - 6, 0xffffffff, true),
      (view: DataView, first: number) => view.setUint16(first + 28, 0xffff, true),
    ]) {
      const bytes = original.slice()
      mutate(new DataView(bytes.buffer), directoryOffsets(bytes)[0])
      const load = vi.spyOn(JSZip, 'loadAsync')
      await expect(importDocumentFile(new File([bytes], 'bad.epub'))).rejects.toThrow(/DRM|malformed/)
      expect(load).not.toHaveBeenCalled()
      load.mockRestore()
    }
  })

  it('bounds actual decompression when the directory lies about expanded size', async () => {
    const zip = fixture().file('OPS/Text/first.xhtml', 'x'.repeat(32 * 1024 * 1024 + 1))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const view = new DataView(bytes.buffer)
    for (const offset of directoryOffsets(bytes)) {
      if (view.getUint32(offset + 24, true) > 32 * 1024 * 1024) {
        view.setUint32(offset + 24, 100, true)
      }
    }
    await expect(importDocumentFile(new File([bytes], 'lying.epub'))).rejects.toThrow('expanded size limit')
  }, 15_000)
})

describe('shared URL adapter', () => {
  it('imports an HTTPS article while removing active content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<title>Article</title><h1>A heading</h1><blockquote><p>Quoted once.</p></blockquote><script>BAD</script>',
    )))
    expect(await importDocumentUrl('https://example.com/article')).toEqual({
      title: 'Article', sourceType: 'url',
      chapters: [{ title: 'A heading', content: 'A heading\n\nQuoted once.' }],
    })
  })

  it('preserves actionable protocol, CORS, HTTP and empty-article failures', async () => {
    await expect(importDocumentUrl('http://example.com')).rejects.toThrow('HTTPS')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network')))
    await expect(importDocumentUrl('https://example.com')).rejects.toThrow('CORS')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(importDocumentUrl('https://example.com')).rejects.toThrow('HTTP 404')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<body><script>no</script></body>')))
    await expect(importDocumentUrl('https://example.com')).rejects.toThrow('readable text')
  })
})

// Opt in locally; never check the user's book into the repository or log prose.
it.skipIf(!process.env.DOCUMENT_IMPORT_EPUB_PATH)('imports a locally supplied EPUB without exposing its prose', async () => {
  const path = process.env.DOCUMENT_IMPORT_EPUB_PATH!
  const bytes = await readFile(path)
  const result = await importDocumentFile(new File([new Uint8Array(bytes)], basename(path)))
  const sourceLength = result.chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)
  const nonempty = result.chapters.every((chapter) => Boolean(chapter.content.trim()))
  expect(result.sourceType === 'epub' && nonempty && sourceLength > 0).toBe(true)
  console.info(JSON.stringify({
    title: result.title, chapterCount: result.chapters.length, nonempty, sourceLength,
  }))
}, 30_000)
