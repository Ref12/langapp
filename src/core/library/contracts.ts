import { z } from 'zod'

export const MAX_PASSAGE_LENGTH = 1500
export const MAX_BOOK_TEXT_LENGTH = 4_000_000
const index = z.number().int().nonnegative()
const text = (maximum: number) => z.string().min(1).max(maximum).refine(value => Boolean(value.trim()))

export const translationTokenSchema = z.object({
  text: text(200),
  pinyin: z.string().max(300),
  meaning: text(300),
  trailing: z.string().max(40).regex(/^[\p{P}\p{Z}\s]*$/u),
}).strict()
export const translationSchema = z.object({
  blocks: z.array(z.array(translationTokenSchema).min(1).max(600)).min(1).max(150),
}).strict()
export type BookTranslation = z.infer<typeof translationSchema>

export function sourceParagraphs(source: string): string[] {
  return source.split(/\n\s*\n/).filter(part => part.trim())
}

export function translationText(translation: BookTranslation): string {
  return translation.blocks.map(block => block.map(token => token.text + token.trailing).join('')).join('\n\n')
}

export const bookSchema = z.object({
  id: z.string().uuid(),
  revision: z.string().uuid(),
  title: text(300),
  author: text(300).optional(),
  sourceType: z.enum(['epub', 'text', 'markdown', 'paste']),
  chapters: z.array(text(300)).min(1).max(2000),
  passages: z.array(z.object({
    chapter: index,
    source: text(MAX_PASSAGE_LENGTH),
    translation: translationSchema.extend({ translatedAt: index }).optional(),
  }).strict()).min(1).max(10000),
  passage: index,
  completed: z.array(index).max(10000),
  importedAt: index,
  updatedAt: index,
}).strict().superRefine((book, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message })
  if (book.passage >= book.passages.length || book.completed.some(value => value >= book.passages.length)
    || new Set(book.completed).size !== book.completed.length) invalid('Invalid book reading position.')
  if (book.passages.reduce((total, passage) => total + passage.source.length, 0) > MAX_BOOK_TEXT_LENGTH) invalid('The book text is too large.')
  const chapters = new Set<number>()
  for (const [position, passage] of book.passages.entries()) {
    chapters.add(passage.chapter)
    if (passage.chapter >= book.chapters.length || (position > 0 && passage.chapter < book.passages[position - 1].chapter)) invalid('Invalid book chapter order.')
    if (passage.translation && (passage.translation.blocks.length !== sourceParagraphs(passage.source).length
      || translationText(passage.translation).length > 6000)) invalid('Invalid saved book translation.')
  }
  if (chapters.size !== book.chapters.length) invalid('A book chapter has no readable passages.')
})
export type LibraryBook = z.infer<typeof bookSchema>

export const librarySchema = z.array(bookSchema).max(200).superRefine((books, context) => {
  if (new Set(books.map(book => book.id)).size !== books.length) context.addIssue({ code: 'custom', message: 'Duplicate library books.' })
})
