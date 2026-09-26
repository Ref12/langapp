import JSZip from 'jszip'

export interface ImportedTextDocument {
  title: string
  author?: string
  sourceType: 'epub' | 'text' | 'markdown' | 'paste' | 'url'
  chapters: { title: string; content: string }[]
}

type TextChapter = ImportedTextDocument['chapters'][number]

const MIB = 1024 * 1024
const MAX_FILE_BYTES = 64 * MIB
const MAX_TEXT_BYTES = 20 * MIB
const MAX_ENTRY_BYTES = 32 * MIB
const MAX_EXPANDED_BYTES = 256 * MIB
const MAX_ZIP_ENTRIES = 10_000

// Public JSZip API omitted by its bundled typings:
// https://stuk.github.io/jszip/documentation/api_zipobject/internal_stream.html
declare module 'jszip' {
  interface JSZipObject {
    internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
  }
}

function chapter(title: string, content: string): TextChapter {
  return { title: title.trim() || 'Untitled chapter', content: content.trim() }
}

export function splitDocumentChapters(
  content: string,
  fallbackTitle = 'Full text',
): TextChapter[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const headingPattern =
    /^(?:#{1,2}\s+(.+)|\s*((?:chapter|part|book)\s+(?:[\divxlcdm]+|[a-z]+)(?:\s*[:.-]\s*.*)?))\s*$/i
  const chapters: TextChapter[] = []
  let title = fallbackTitle
  let body: string[] = []
  let foundHeading = false
  const flush = () => {
    const content = body.join('\n').trim()
    if (content) chapters.push(chapter(title, content))
    body = []
  }

  for (const line of lines) {
    const heading = line.match(headingPattern)
    if (heading) {
      flush()
      title = (heading[1] ?? heading[2] ?? fallbackTitle).trim()
      foundHeading = true
    } else {
      body.push(line)
    }
  }
  flush()
  return !foundHeading || chapters.length === 0
    ? [chapter(fallbackTitle, content)]
    : chapters
}

function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', name))
}

function parseXml(markup: string, label: string): Document {
  const document = new DOMParser().parseFromString(markup, 'application/xml')
  if (elements(document, 'parsererror').length) {
    throw new Error(`The EPUB ${label} is malformed XML.`)
  }
  return document
}

function readableChapter(
  document: Document,
  body: Element,
  fallbackTitle: string,
): TextChapter | null {
  const ignored = new Set([
    'script', 'style', 'nav', 'footer', 'iframe', 'noscript', 'object',
    'embed', 'template', 'svg', 'math',
  ])
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (
      ignored.has(element.localName.toLowerCase()) ||
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true'
    ) element.remove()
  }
  const heading = Array.from(body.getElementsByTagName('*')).find(
    (element) => ['h1', 'h2'].includes(element.localName.toLowerCase()),
  )
  const title = heading?.textContent?.trim() ||
    elements(document, 'title')[0]?.textContent?.trim() || fallbackTitle
  const blocks = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'li', 'blockquote',
    'pre', 'section', 'article', 'dt', 'dd', 'tr', 'address', 'figure',
    'figcaption', 'hr',
  ])
  const text: string[] = []
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      text.push(node.textContent?.replace(/\s+/g, ' ') ?? '')
      return
    }
    if (node.nodeType !== 1) return
    const name = (node as Element).localName.toLowerCase()
    if (name === 'br') {
      text.push('\n')
      return
    }
    const isBlock = blocks.has(name)
    if (isBlock) text.push('\n\n')
    for (const child of Array.from(node.childNodes)) visit(child)
    if (isBlock) text.push('\n\n')
    if (name === 'td' || name === 'th') text.push(' ')
  }
  visit(body)
  const content = text.join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return content ? chapter(title, content) : null
}

function resolveEpubPath(base: string, href: string): string {
  const path = href.split(/[?#]/, 1)[0]
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/')) {
    throw new Error('The EPUB contains an unsupported content path.')
  }
  const resolved = base.slice(0, base.lastIndexOf('/') + 1).split('/').filter(Boolean)
  for (const encodedSegment of path.split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(encodedSegment)
    } catch {
      throw new Error('The EPUB contains an invalid encoded content path.')
    }
    if (/[\\/]/.test(segment) || segment.includes('\0')) {
      throw new Error('The EPUB contains an invalid content path.')
    }
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!resolved.length) throw new Error('The EPUB content path escapes the archive.')
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  return resolved.join('/')
}

function validateZipSize(data: ArrayBuffer): void {
  // ZIP APPNOTE 4.3.12 / 4.3.16: inspect the central directory before JSZip
  // can inflate anything, including unused images. ZIP64 and split ZIPs are
  // unnecessary at these limits and are deliberately unsupported.
  const view = new DataView(data)
  const invalid = () => new Error('The EPUB ZIP archive is malformed or unsupported.')
  let end = -1
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === view.byteLength) {
      end = offset
      break
    }
  }
  if (end < 0) throw invalid()
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  let offset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== count ||
      count === 0xffff || directorySize === 0xffffffff || offset === 0xffffffff ||
      offset + directorySize !== end) throw invalid()
  if (count > MAX_ZIP_ENTRIES) throw new Error('The EPUB has too many ZIP entries.')
  let expandedBytes = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid()
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const expanded = view.getUint32(offset + 24, true)
    const localOffset = view.getUint32(offset + 42, true)
    if (flags & 0x41) throw new Error('Encrypted or DRM-protected EPUBs are not supported.')
    if ((method !== 0 && method !== 8) || view.getUint16(offset + 34, true) ||
        localOffset + 30 > view.byteLength ||
        view.getUint32(localOffset, true) !== 0x04034b50 ||
        compressed > data.byteLength) throw invalid()
    expandedBytes += expanded
    if (expanded > MAX_ENTRY_BYTES || expandedBytes > MAX_EXPANDED_BYTES) {
      throw new Error('The EPUB exceeds the expanded size limit (32 MiB per entry, 256 MiB total).')
    }
    offset += 46 + view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    if (offset > end) throw invalid()
  }
  if (offset !== end) throw invalid()
}

function zipReader(zip: JSZip): (path: string) => Promise<string> {
  let totalBytes = 0
  return async (path) => {
    const entry = zip.file(path)
    if (!entry) throw new Error(`The EPUB is missing a required file: ${path}`)
    return new Promise<string>((resolve, reject) => {
      // Bound actual output too: a malicious directory can lie about sizes.
      const stream = entry.internalStream('uint8array')
      const decoder = new TextDecoder()
      const parts: string[] = []
      let bytes = 0
      let stopped = false
      stream.on('data', (chunk) => {
        if (stopped) return
        bytes += chunk.byteLength
        totalBytes += chunk.byteLength
        if (bytes > MAX_ENTRY_BYTES || totalBytes > MAX_EXPANDED_BYTES) {
          stopped = true
          stream.pause()
          parts.length = 0
          reject(new Error('The EPUB exceeds the expanded size limit.'))
          return
        }
        parts.push(decoder.decode(chunk, { stream: true }))
      })
      stream.on('error', reject)
      stream.on('end', () => {
        if (!stopped) resolve(parts.join('') + decoder.decode())
      })
      stream.resume()
    })
  }
}

async function extractEpub(data: ArrayBuffer, fallbackTitle: string): Promise<ImportedTextDocument> {
  validateZipSize(data)
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('The EPUB ZIP archive could not be read.')
  }
  const read = zipReader(zip)
  if (zip.file('mimetype') && (await read('mimetype')).trim() !== 'application/epub+zip') {
    throw new Error('The file is not an EPUB archive.')
  }
  if (zip.file('META-INF/encryption.xml')) {
    const encryption = parseXml(await read('META-INF/encryption.xml'), 'encryption metadata')
    const obfuscation = new Set([
      'http://www.idpf.org/2008/embedding',
      'http://ns.adobe.com/pdf/enc#RC',
    ])
    for (const encrypted of elements(encryption, 'EncryptedData')) {
      const algorithm = elements(encrypted, 'EncryptionMethod')[0]?.getAttribute('Algorithm')
      if (!algorithm || !obfuscation.has(algorithm)) {
        throw new Error('Encrypted or DRM-protected EPUBs are not supported.')
      }
    }
  }
  const container = parseXml(await read('META-INF/container.xml'), 'container metadata')
  const rootfiles = elements(container, 'rootfile')
  const rootfile = rootfiles.find((file) =>
    file.getAttribute('media-type') === 'application/oebps-package+xml',
  ) ?? rootfiles[0]
  const fullPath = rootfile?.getAttribute('full-path')
  if (!fullPath) throw new Error('The EPUB package path is missing.')
  const packagePath = resolveEpubPath('', fullPath)
  const packageDocument = parseXml(await read(packagePath), 'package metadata')
  const metadata = elements(packageDocument, 'metadata')[0]
  const dcText = (name: string) =>
    metadata?.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', name)[0]
      ?.textContent?.replace(/\s+/g, ' ').trim()
  const title = dcText('title') || fallbackTitle
  const author = dcText('creator')
  const manifest = elements(packageDocument, 'manifest')[0]
  const spine = elements(packageDocument, 'spine')[0]
  if (!manifest || !spine) throw new Error('The EPUB manifest or reading spine is missing.')
  const byId = new Map<string, Element>()
  for (const item of elements(manifest, 'item')) {
    const id = item.getAttribute('id')
    if (!id || byId.has(id)) throw new Error('The EPUB manifest contains missing or duplicate IDs.')
    byId.set(id, item)
  }
  const chapters: TextChapter[] = []
  const visited = new Set<string>()
  for (const itemref of elements(spine, 'itemref')) {
    const item = byId.get(itemref.getAttribute('idref') ?? '')
    const href = item?.getAttribute('href')
    if (!item || !href) throw new Error('The EPUB spine refers to a missing manifest item.')
    const path = resolveEpubPath(packagePath, href)
    if (!zip.file(path)) throw new Error(`The EPUB is missing a spine file: ${path}`)
    if (item.getAttribute('properties')?.split(/\s+/).includes('nav')) continue
    if (visited.has(path)) continue
    visited.add(path)
    const mediaType = item.getAttribute('media-type')
    if (mediaType && !['application/xhtml+xml', 'text/html'].includes(mediaType)) {
      throw new Error(`The EPUB spine contains unsupported content (${mediaType}).`)
    }
    const markup = await read(path)
    const document = mediaType === 'text/html'
      ? new DOMParser().parseFromString(markup, 'text/html')
      : parseXml(markup, 'chapter')
    const body = elements(document, 'body')[0]
    if (!body || (mediaType === 'text/html' && !/<body(?:\s|>)/i.test(markup))) {
      throw new Error(`The EPUB chapter is missing its body: ${path}`)
    }
    const extracted = readableChapter(document, body, `Chapter ${chapters.length + 1}`)
    if (extracted) chapters.push(extracted)
  }
  if (!chapters.length) throw new Error('The EPUB did not contain readable chapters.')
  return { title, ...(author ? { author } : {}), sourceType: 'epub', chapters }
}

async function fileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected file could not be read.'))
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(file)
  })
}

export async function importDocumentFile(file: File): Promise<ImportedTextDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension || !['txt', 'md', 'markdown', 'epub'].includes(extension)) {
    throw new Error('Choose a .txt, .md, .markdown, or .epub file.')
  }
  const limit = extension === 'epub' ? MAX_FILE_BYTES : MAX_TEXT_BYTES
  if (file.size > limit) throw new Error(`The file exceeds the ${limit / MIB} MiB size limit.`)
  if (!file.size) throw new Error('The selected file is empty.')
  const data = await fileBytes(file)
  if (data.byteLength > limit) throw new Error('The file exceeds the size limit.')
  const title = file.name.replace(/\.(txt|md|markdown|epub)$/i, '').trim() || 'Untitled document'
  if (extension === 'epub') return extractEpub(data, title)
  const content = new TextDecoder().decode(data)
  if (!content.trim()) throw new Error('The selected file does not contain readable text.')
  return {
    title,
    sourceType: extension === 'txt' ? 'text' : 'markdown',
    chapters: splitDocumentChapters(content),
  }
}

export async function importDocumentUrl(url: string): Promise<ImportedTextDocument> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Web imports require an HTTPS URL.')
  let response: Response
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new Error(
      'The article could not be fetched. The site may block browser CORS; paste the article text instead.',
    )
  }
  if (!response.ok) throw new Error(`The article request failed with HTTP ${response.status}.`)
  const markup = await response.text()
  const document = new DOMParser().parseFromString(markup, 'text/html')
  const title = document.title || parsed.hostname
  const extracted = readableChapter(document, document.body, title)
  if (!extracted) throw new Error('The article did not contain readable text.')
  return { title, sourceType: 'url', chapters: [extracted] }
}
