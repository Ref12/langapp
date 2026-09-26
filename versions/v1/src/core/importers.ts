import {
  importDocumentFile,
  importDocumentUrl,
  splitDocumentChapters,
  type ImportedTextDocument,
} from '../../../../shared/document-import'
import type { DocumentChapter, LibraryItem } from './domain'
import { createId } from './ids'

export interface ImportedDocument {
  title: string
  content: string
  sourceType: LibraryItem['sourceType']
  chapters: DocumentChapter[]
}

function createChapter(chapter: ImportedTextDocument['chapters'][number]): DocumentChapter {
  return {
    id: createId('chapter'),
    ...chapter,
    annotations: [],
    analysisStatus: 'not-analyzed',
  }
}

function importedDocument(document: ImportedTextDocument): ImportedDocument {
  const chapters = document.chapters.map(createChapter)
  return {
    title: document.title,
    sourceType: document.sourceType,
    chapters,
    content: chapters.map((chapter) => chapter.content).join('\n\n'),
  }
}

export function splitIntoChapters(content: string, fallbackTitle = 'Full text'): DocumentChapter[] {
  return splitDocumentChapters(content, fallbackTitle).map(createChapter)
}

export async function importFile(file: File): Promise<ImportedDocument> {
  const document = await importDocumentFile(file)
  return importedDocument({
    ...document,
    title: file.name.replace(/\.(txt|md|markdown|epub)$/i, ''),
  })
}

export async function importUrl(url: string): Promise<ImportedDocument> {
  return importedDocument(await importDocumentUrl(url))
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
