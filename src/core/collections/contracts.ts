import { z } from 'zod'
import { studyCardSchema, unitRefSchema } from '../study/contracts'

// Collections: named sets of study items kept apart from the main knowledge set.
// An item is a curriculum unit (vocabulary or grammar, `vocabulary:lb`) or a free phrase (`phrase:<hash>`).

const id = z.string().min(1).max(200)
const timestamp = z.number().int().nonnegative()

export const collectionSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  /** `show` collections are created on the first add from a media item and link back to it. */
  kind: z.enum(['show', 'user']),
  mediaId: id.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict()

export const collectionSourceSchema = z.object({
  mediaId: id,
  title: z.string().max(500),
  /** Index of the subtitle line and its start time in seconds (Medusa's own timeline, before sync offsets). */
  line: z.number().int().nonnegative(),
  start: z.number().min(0),
  text: z.string().max(2000),
}).strict()

export const collectionItemSchema = z.object({
  /** `${collectionId}|${ref}` */
  id: z.string().min(1).max(500),
  collectionId: id,
  ref: unitRefSchema,
  /** Free phrases carry their text and, when known, a translation. */
  text: z.string().max(2000).optional(),
  translation: z.string().max(2000).optional(),
  source: collectionSourceSchema.optional(),
  addedAt: timestamp,
}).strict()

export const collectionsBackupSchema = z.object({
  collections: z.array(collectionSchema).max(2000),
  items: z.array(collectionItemSchema).max(100000),
  /** The shared cards of the collections' items, whether or not the item is also in the knowledge set. */
  cards: z.array(studyCardSchema).max(100000).default([]),
}).strict()

export type Collection = z.infer<typeof collectionSchema>
export type CollectionItem = z.infer<typeof collectionItemSchema>
export type CollectionSource = z.infer<typeof collectionSourceSchema>
export type CollectionsBackup = z.infer<typeof collectionsBackupSchema>

export const itemId = (collectionId: string, ref: string) => `${collectionId}|${ref}`

/** Stable ref of a phrase: the same text always gives the same ref, so its card is shared across collections. */
export function phraseRef(text: string): string {
  const value = text.replace(/\s+/g, ' ').trim()
  let a = 0xdeadbeef, b = 0x41c6ce57
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return `phrase:p${(4294967296 * (2097151 & b) + (a >>> 0)).toString(36)}${value.length.toString(36)}`
}
