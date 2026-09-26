import { importDocumentFile, splitDocumentChapters, type ImportedTextDocument } from '../../../shared/document-import'
import { db } from '../database'
import { bookSchema, MAX_BOOK_TEXT_LENGTH, MAX_PASSAGE_LENGTH, type LibraryBook } from './contracts'

export function splitBookPassages(text: string): string[] {
  const passages: string[] = []
  let remaining = text.replace(/\r\n?/g, '\n').trim()
  while (remaining) {
    let end = Math.min(remaining.length, MAX_PASSAGE_LENGTH)
    if (end < remaining.length) {
      const minimum = Math.floor(MAX_PASSAGE_LENGTH / 2)
      const paragraph = remaining.lastIndexOf('\n\n', end)
      const sentence = Math.max(...['. ', '? ', '! ', '\n', ' '].map(separator => remaining.lastIndexOf(separator, end - 1)))
      end = paragraph >= minimum ? paragraph : sentence >= minimum ? sentence + 1 : end
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
    }
    passages.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }
  return passages
}

export async function saveImportedBook(document: ImportedTextDocument): Promise<string> {
  if (document.sourceType === 'url') throw new Error('Import a book file or paste its text.')
  if (document.chapters.reduce((total, chapter) => total + chapter.content.length, 0) > MAX_BOOK_TEXT_LENGTH) {
    throw new Error('This book exceeds the 4 million character text limit.')
  }
  const chapters = document.chapters.filter(chapter => chapter.content.trim())
  const now = Date.now()
  const book = bookSchema.parse({
    id: crypto.randomUUID(), revision: crypto.randomUUID(),
    title: document.title.trim(), ...(document.author ? { author: document.author.trim() } : {}),
    sourceType: document.sourceType,
    chapters: chapters.map(chapter => chapter.title),
    passages: chapters.flatMap((chapter, index) => splitBookPassages(chapter.content).map(source => ({ chapter: index, source }))),
    passage: 0, completed: [], importedAt: now, updatedAt: now,
  })
  await db.libraryBooks.add(book)
  return book.id
}

export async function importBookFile(file: File): Promise<string> {
  return saveImportedBook(await importDocumentFile(file))
}

export async function importBookText(title: string, content: string): Promise<string> {
  if (!title.trim() || !content.trim()) throw new Error('Enter a title and some text to import.')
  return saveImportedBook({ title, sourceType: 'paste', chapters: splitDocumentChapters(content, title) })
}

export async function requireBook(id: string): Promise<LibraryBook> {
  const book = await db.libraryBooks.get(id)
  if (!book) throw new Error('This book is no longer in your library.')
  return book
}

export async function moveBookReading(id: string, from: number, to: number, complete = false): Promise<void> {
  await db.transaction('rw', db.libraryBooks, async () => {
    const book = await requireBook(id)
    if (!Number.isInteger(to) || to < 0 || to >= book.passages.length) throw new Error('That book passage is not available.')
    if (book.passage !== from) throw new Error('Your reading place changed in another tab. Please try again.')
    await db.libraryBooks.put({
      ...book, passage: to, updatedAt: Date.now(),
      completed: complete ? [...new Set([...book.completed, from])] : book.completed,
    })
  })
}

export async function removeBook(id: string): Promise<void> {
  await db.transaction('rw', db.libraryBooks, async () => {
    await requireBook(id)
    await db.libraryBooks.delete(id)
  })
}
