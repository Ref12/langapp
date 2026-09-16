import JSZip from 'jszip'
import type { DocumentChapter, LibraryItem } from './domain'
import { createId } from './ids'

export interface ImportedDocument {
  title: string
  content: string
  sourceType: LibraryItem['sourceType']
  chapters: DocumentChapter[]
}

function createChapter(title: string, content: string): DocumentChapter {
  return {
    id: createId('chapter'),
    title: title.trim() || 'Untitled chapter',
    content: content.trim(),
    annotations: [],
    analysisStatus: 'not-analyzed',
  }
}

function chapterFromMarkup(
  markup: string,
  fallbackTitle: string,
): DocumentChapter | null {
  const document = new DOMParser().parseFromString(markup, 'text/html')
  document
    .querySelectorAll('script, style, nav, footer, iframe, noscript')
    .forEach((element) => element.remove())

  const title =
    document.querySelector('h1, h2, title')?.textContent?.trim() || fallbackTitle
  const blocks = Array.from(
    document.querySelectorAll('h1, h2, h3, p, li, blockquote, pre'),
  )
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
    .filter((value): value is string => Boolean(value))
  const content =
    blocks.length > 0
      ? blocks.join('\n\n')
      : (document.body.textContent ?? '').replace(/\s+/g, ' ').trim()

  return content ? createChapter(title, content) : null
}

export function splitIntoChapters(
  content: string,
  fallbackTitle = 'Full text',
): DocumentChapter[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const headingPattern =
    /^(?:#{1,2}\s+(.+)|\s*((?:chapter|part|book)\s+(?:[\divxlcdm]+|[a-z]+)(?:\s*[:.-]\s*.*)?))\s*$/i
  const chapters: DocumentChapter[] = []
  let title = fallbackTitle
  let body: string[] = []
  let foundHeading = false

  const flush = () => {
    const chapterContent = body.join('\n').trim()
    if (chapterContent) chapters.push(createChapter(title, chapterContent))
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

  if (!foundHeading || chapters.length === 0) {
    return [createChapter(fallbackTitle, content)]
  }
  return chapters
}

function dirname(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator + 1)
}

function resolvePath(base: string, relative: string): string {
  const stack = `${dirname(base)}${relative}`.split('/')
  const resolved: string[] = []
  for (const segment of stack) {
    if (!segment || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return resolved.join('/')
}

async function extractEpub(file: File): Promise<DocumentChapter[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const container = await zip
    .file('META-INF/container.xml')
    ?.async('string')
  if (!container) throw new Error('The EPUB container metadata is missing.')

  const containerDocument = new DOMParser().parseFromString(
    container,
    'application/xml',
  )
  const packagePath = containerDocument
    .querySelector('rootfile')
    ?.getAttribute('full-path')
  if (!packagePath) throw new Error('The EPUB package path is missing.')

  const packageXml = await zip.file(packagePath)?.async('string')
  if (!packageXml) throw new Error('The EPUB package could not be read.')

  const packageDocument = new DOMParser().parseFromString(
    packageXml,
    'application/xml',
  )
  const hrefById = new Map(
    Array.from(packageDocument.querySelectorAll('manifest item'))
      .map((item) => [item.getAttribute('id'), item.getAttribute('href')] as const)
      .filter(
        (entry): entry is readonly [string, string] =>
          entry[0] !== null && entry[1] !== null,
      ),
  )

  const chapters: DocumentChapter[] = []
  let chapterNumber = 1
  for (const item of packageDocument.querySelectorAll('spine itemref')) {
    const id = item.getAttribute('idref')
    const href = id ? hrefById.get(id) : undefined
    if (!href) continue
    const markup = await zip.file(resolvePath(packagePath, href))?.async('string')
    if (!markup) continue
    const chapter = chapterFromMarkup(markup, `Chapter ${chapterNumber}`)
    if (chapter) {
      chapters.push(chapter)
      chapterNumber += 1
    }
  }

  if (!chapters.length) {
    throw new Error('The EPUB did not contain readable chapters.')
  }
  return chapters
}

function importedDocument(
  title: string,
  sourceType: LibraryItem['sourceType'],
  chapters: DocumentChapter[],
): ImportedDocument {
  return {
    title,
    sourceType,
    chapters,
    content: chapters.map((chapter) => chapter.content).join('\n\n'),
  }
}

export async function importFile(file: File): Promise<ImportedDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  const title = file.name.replace(/\.(txt|md|markdown|epub)$/i, '')
  if (extension === 'epub') {
    return importedDocument(title, 'epub', await extractEpub(file))
  }

  if (extension !== 'txt' && extension !== 'md' && extension !== 'markdown') {
    throw new Error('Choose a .txt, .md, .markdown, or .epub file.')
  }

  const content = await file.text()
  return importedDocument(
    title,
    extension === 'txt' ? 'text' : 'markdown',
    splitIntoChapters(content),
  )
}

export async function importUrl(url: string): Promise<ImportedDocument> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new Error('Web imports require an HTTPS URL.')
  }

  let response: Response
  try {
    response = await fetch(parsed, { signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new Error(
      'The article could not be fetched. The site may block browser CORS; paste the article text instead.',
    )
  }
  if (!response.ok) {
    throw new Error(`The article request failed with HTTP ${response.status}.`)
  }

  const markup = await response.text()
  const document = new DOMParser().parseFromString(markup, 'text/html')
  const chapter = chapterFromMarkup(
    markup,
    document.title || parsed.hostname,
  )
  if (!chapter) throw new Error('The article did not contain readable text.')
  return importedDocument(document.title || parsed.hostname, 'url', [chapter])
}

export function chaptersFor(item: LibraryItem): DocumentChapter[] {
  if (item.chapters?.length) return item.chapters
  return [
    {
      id: `${item.id}_chapter_1`,
      title: 'Full text',
      content: item.content,
      annotations: item.annotations ?? [],
      analysisStatus: item.analysisStatus ?? 'not-analyzed',
      analysisError: item.analysisError,
    },
  ]
}
