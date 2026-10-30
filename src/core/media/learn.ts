import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { addSourceEntriesToKnowledge, addToKnowledge } from '../study/knowledge'
import { isSourceRef } from '../study/contracts'
import { addLines, showCollection, startCollectionSession } from '../collections/store'
import { itemId, type CollectionSource } from '../collections/contracts'
import type { MediaItem } from './contracts'
import type { Proposal } from './span'

/**
 * Confirms a span proposal: the chosen words join the main knowledge set, each is tagged in the show's collection with the example line it came from
 * (source and position), the example lines are kept as phrases, and one lesson (introduction, then exercises) starts on them. One exercise request for the lot.
 */
export async function learnFromSpan(item: Pick<MediaItem, 'lines' | 'title'> & { id: string }, picks: readonly Proposal[], signal?: AbortSignal): Promise<string> {
  if (!picks.length) throw new Error('Choose at least one word to learn.')
  const catalog = await loadCatalog()
  const curriculum = picks.filter(pick => catalog.units.has(pick.ref)).map(pick => pick.ref)
  const sources = picks.filter(pick => isSourceRef(pick.ref)).map(pick => pick.ref)
  if (curriculum.length) await addToKnowledge(curriculum)
  if (sources.length) await addSourceEntriesToKnowledge(sources)
  const collection = await showCollection(item.id, item.title)
  const sourceOf = (line: number): CollectionSource => ({ mediaId: item.id, title: item.title, line, start: item.lines[line]?.start ?? 0, text: item.lines[line]?.text ?? '' })
  await addLines(collection.id, [...new Map(picks.map(pick => [pick.example, pick.example])).values()].flatMap(line => item.lines[line] ? [{ text: item.lines[line].text, source: sourceOf(line) }] : []))
  const now = Date.now()
  await db.transaction('rw', db.collectionItems, db.studyCards, async () => {
    for (const pick of picks) {
      const id = itemId(collection.id, pick.ref)
      const existing = await db.collectionItems.get(id)
      if (existing) await db.collectionItems.update(id, { source: sourceOf(pick.example) })
      else await db.collectionItems.add({ id, collectionId: collection.id, ref: pick.ref, source: sourceOf(pick.example), addedAt: now })
    }
  })
  return startCollectionSession(collection.id, { itemIds: picks.map(pick => itemId(collection.id, pick.ref)) }, signal)
}
