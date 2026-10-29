import { db } from '../database'
import { mediaItemSchema, type MediaItem, type MediaResult, type SyncAnchor } from './contracts'

/** Save (or replace) a fetched transcript. Nothing here touches the knowledge set. */
export async function saveMedia(result: MediaResult, id: string = crypto.randomUUID()): Promise<string> {
  const item: MediaItem = mediaItemSchema.parse({ ...result, id, savedAt: Date.now() })
  await db.mediaItems.put(item)
  return id
}

/** Keep the sync locally; `dirty` marks changes Medusa has not acknowledged yet, so its older copy must not win. */
export async function saveSync(id: string, sync: SyncAnchor[], dirty: boolean): Promise<void> {
  await db.mediaItems.update(id, { sync, syncDirty: dirty })
}

export async function removeMedia(id: string): Promise<void> {
  await db.mediaItems.delete(id)
}
