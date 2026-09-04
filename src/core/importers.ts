import JSZip from 'jszip'

function textFromMarkup(markup: string): string {
  const document = new DOMParser().parseFromString(markup, 'text/html')
  document
    .querySelectorAll('script, style, nav, footer, iframe, noscript')
    .forEach((element) => element.remove())
  return (document.body.textContent ?? '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
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

async function extractEpub(file: File): Promise<string> {
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

  const chapters: string[] = []
  for (const item of packageDocument.querySelectorAll('spine itemref')) {
    const id = item.getAttribute('idref')
    const href = id ? hrefById.get(id) : undefined
    if (!href) continue
    const chapter = await zip.file(resolvePath(packagePath, href))?.async('string')
    if (chapter) chapters.push(textFromMarkup(chapter))
  }

  const content = chapters.filter(Boolean).join('\n\n')
  if (!content) throw new Error('The EPUB did not contain readable chapters.')
  return content
}

export async function importFile(file: File): Promise<{
  title: string
  content: string
  sourceType: 'text' | 'markdown'
}> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'epub') {
    return {
      title: file.name.replace(/\.epub$/i, ''),
      content: await extractEpub(file),
      sourceType: 'text',
    }
  }

  if (extension !== 'txt' && extension !== 'md' && extension !== 'markdown') {
    throw new Error('Choose a .txt, .md, .markdown, or .epub file.')
  }

  return {
    title: file.name.replace(/\.(txt|md|markdown)$/i, ''),
    content: await file.text(),
    sourceType: extension === 'txt' ? 'text' : 'markdown',
  }
}

export async function importUrl(url: string): Promise<{
  title: string
  content: string
}> {
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
  return {
    title: document.title || parsed.hostname,
    content: textFromMarkup(markup),
  }
}
