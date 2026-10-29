import { db } from '../database'
import { loadCatalog, requireUnit, type Unit } from '../study/catalog'
import { cardId, isPhraseRef, type StudyCard } from '../study/contracts'
import { emptySchedulingState } from '../study/fsrs'
import { DOMAIN, addToKnowledge } from '../study/knowledge'
import { generateExercises, type PhraseTarget } from '../study/exercises'
import { orderByPhase } from './phases'
import { findCatalogUnits } from './extract'
import { itemId, phraseRef, type Collection, type CollectionItem, type CollectionSource } from './contracts'

/** A subtitle line to add: its text, optional translation and where it came from. */
export interface LineInput { text: string; translation?: string; source?: CollectionSource }

export const MAX_COLLECTION_TARGETS = 8

function newCard(ref: string, now: number): StudyCard {
  return { id: cardId(ref, DOMAIN), ref, domain: DOMAIN, ...emptySchedulingState(now), updatedAt: now }
}

export async function createCollection(name: string): Promise<Collection> {
  const clean = name.trim()
  if (!clean) throw new Error('Name the collection.')
  const now = Date.now()
  const collection: Collection = { id: crypto.randomUUID(), name: clean.slice(0, 120), kind: 'user', createdAt: now, updatedAt: now }
  await db.collections.add(collection)
  return collection
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) throw new Error('Name the collection.')
  await db.transaction('rw', db.collections, async () => {
    const collection = await db.collections.get(id)
    if (!collection) throw new Error('That collection no longer exists.')
    await db.collections.put({ ...collection, name: clean.slice(0, 120), updatedAt: Date.now() })
  })
}

/** Deletes a collection and its items. Shared cards and the knowledge set are left alone. */
export async function deleteCollection(id: string): Promise<void> {
  await db.transaction('rw', db.collections, db.collectionItems, async () => {
    await db.collectionItems.where('collectionId').equals(id).delete()
    await db.collections.delete(id)
  })
}

/** The show's collection, created on first use. */
export async function showCollection(mediaId: string, title: string): Promise<Collection> {
  return db.transaction('rw', db.collections, async () => {
    const existing = await db.collections.where('mediaId').equals(mediaId).first()
    if (existing) return existing
    const now = Date.now()
    const collection: Collection = { id: crypto.randomUUID(), name: title.trim().slice(0, 120) || 'Show', kind: 'show', mediaId, createdAt: now, updatedAt: now }
    await db.collections.add(collection)
    return collection
  })
}

export interface AddResult { phrases: number; units: number; total: number }

/** Adds each line as a free phrase and the catalog units found in it; items already present are kept. */
export async function addLines(collectionId: string, lines: LineInput[]): Promise<AddResult> {
  const catalog = await loadCatalog()
  const now = Date.now()
  const candidates: CollectionItem[] = []
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const base = { collectionId, addedAt: now, ...(line.source ? { source: line.source } : {}) }
    const ref = phraseRef(text)
    candidates.push({ ...base, id: itemId(collectionId, ref), ref, text, ...(line.translation?.trim() ? { translation: line.translation.trim() } : {}) })
    for (const unit of findCatalogUnits([text], catalog)) candidates.push({ ...base, id: itemId(collectionId, unit.ref), ref: unit.ref })
  }
  return db.transaction('rw', db.collections, db.collectionItems, db.studyCards, async () => {
    const collection = await db.collections.get(collectionId)
    if (!collection) throw new Error('That collection no longer exists.')
    const result: AddResult = { phrases: 0, units: 0, total: 0 }
    for (const item of candidates) {
      if (await db.collectionItems.get(item.id)) continue
      await db.collectionItems.add(item)
      if (!await db.studyCards.get(cardId(item.ref, DOMAIN))) await db.studyCards.add(newCard(item.ref, now))
      if (isPhraseRef(item.ref)) result.phrases++; else result.units++
      result.total++
    }
    await db.collections.put({ ...collection, updatedAt: now })
    return result
  })
}

/** Adds curriculum units (e.g. from a search) to a collection. */
export async function addUnitsToCollection(collectionId: string, refs: string[]): Promise<void> {
  const catalog = await loadCatalog()
  refs.forEach(ref => requireUnit(catalog, ref))
  const now = Date.now()
  await db.transaction('rw', db.collections, db.collectionItems, db.studyCards, async () => {
    if (!await db.collections.get(collectionId)) throw new Error('That collection no longer exists.')
    for (const ref of refs) {
      if (await db.collectionItems.get(itemId(collectionId, ref))) continue
      await db.collectionItems.add({ id: itemId(collectionId, ref), collectionId, ref, addedAt: now })
      if (!await db.studyCards.get(cardId(ref, DOMAIN))) await db.studyCards.add(newCard(ref, now))
    }
  })
}

export async function removeItems(ids: string[]): Promise<void> {
  await db.collectionItems.bulkDelete(ids)
}

/** Items whose shared card is due; a card never reviewed is due from the moment it was added. */
export async function dueItems(collectionId: string, now: number): Promise<CollectionItem[]> {
  const items = await db.collectionItems.where('collectionId').equals(collectionId).toArray()
  const cards = await db.studyCards.bulkGet(items.map(item => cardId(item.ref, DOMAIN)))
  return items.filter((_item, index) => !cards[index] || cards[index]!.due <= now)
}

/**
 * "Add to my knowledge set" for collection items. Catalog units move over with their existing cards (history kept);
 * a free phrase brings the catalog units found in it. Returns the number of units newly added.
 */
export async function promoteItems(itemIds: string[]): Promise<number> {
  const items = (await db.collectionItems.bulkGet(itemIds)).flatMap(item => item ? [item] : [])
  const catalog = await loadCatalog()
  const refs = new Set<string>()
  for (const item of items) {
    if (!isPhraseRef(item.ref)) refs.add(item.ref)
    else for (const unit of findCatalogUnits([item.text ?? ''], catalog)) refs.add(unit.ref)
  }
  const before = new Set((await db.knowledge.bulkGet([...refs])).flatMap(entry => entry ? [entry.ref] : []))
  const fresh = [...refs].filter(ref => !before.has(ref))
  if (fresh.length) await addToKnowledge(fresh)
  return fresh.length
}

/** Starts a practice session on a collection's items (all, a selection, or the due ones). The knowledge set is left unchanged. */
export async function startCollectionSession(collectionId: string, options: { itemIds?: string[]; dueOnly?: boolean; now?: number } = {}, signal?: AbortSignal): Promise<string> {
  const connection = await db.aiConnections.get('assistant')
  if (!connection) throw new Error('Connect an AI model in Settings before generating exercises. The app does not include a built-in model.')
  const catalog = await loadCatalog()
  let items = await db.collectionItems.where('collectionId').equals(collectionId).toArray()
  if (options.itemIds) { const wanted = new Set(options.itemIds); items = items.filter(item => wanted.has(item.id)) }
  if (options.dueOnly) { const due = new Set((await dueItems(collectionId, options.now ?? Date.now())).map(item => item.id)); items = items.filter(item => due.has(item.id)) }
  const cards = new Map((await db.studyCards.bulkGet(items.map(item => cardId(item.ref, DOMAIN)))).flatMap(card => card ? [[card.ref, card] as const] : []))
  items = items.filter(item => !isPhraseRef(item.ref) ? catalog.units.has(item.ref) : !!item.text)
  // Lesson order: words, then grammar, then phrases. A chosen selection keeps its order (first appearance in the line); otherwise the most due first.
  const given = options.itemIds ? new Map(options.itemIds.map((wanted, index) => [wanted, index])) : undefined
  const rank = (ref: string) => isPhraseRef(ref) ? 2 : ref.startsWith('grammar:') ? 1 : 0
  items.sort((a, b) => rank(a.ref) - rank(b.ref) || (given ? (given.get(a.id) ?? 0) - (given.get(b.id) ?? 0) : (cards.get(a.ref)?.due ?? 0) - (cards.get(b.ref)?.due ?? 0) || a.ref.localeCompare(b.ref)))
  items = [...items.filter(item => rank(item.ref) === 0).slice(0, MAX_COLLECTION_TARGETS), ...items.filter(item => rank(item.ref) === 1).slice(0, 3), ...items.filter(item => rank(item.ref) === 2).slice(0, 3)]
  if (!items.length) throw new Error(options.dueOnly ? 'Nothing in this collection is due right now.' : 'This collection has no items to practise yet.')
  const targets: Unit[] = items.filter(item => !isPhraseRef(item.ref)).map(item => requireUnit(catalog, item.ref))
  const phrases: PhraseTarget[] = items.filter(item => isPhraseRef(item.ref)).map(item => ({ ref: item.ref, text: item.text!, ...(item.translation ? { translation: item.translation } : {}) }))
  const known = (await db.knowledge.toArray()).map(entry => entry.ref)
  const allowed = [...new Map([...known, ...targets.map(unit => unit.ref)].filter(ref => catalog.units.has(ref)).map(ref => [ref, requireUnit(catalog, ref)])).values()]
  const generated = await generateExercises(connection, { mode: 'review', targets, review: [], allowed, catalog, phrases }, signal)
  const ordered = orderByPhase(generated.exercises)
  const refs = items.map(item => item.ref)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.transaction('rw', db.exerciseSessions, db.studyCards, async () => {
    for (const ref of refs) if (!await db.studyCards.get(cardId(ref, DOMAIN))) await db.studyCards.add(newCard(ref, now))
    await db.exerciseSessions.add({
      id, mode: 'review', domain: DOMAIN, collectionId, targetRefs: refs, reviewRefs: [], exercises: ordered.exercises, phases: ordered.phases, cursor: 0, status: 'active',
      model: connection.model, rejected: generated.rejected, createdAt: now,
    })
  })
  return id
}

/** Media.tsx calls this from a line's menu: adds the lines (each carries its media source) to their show's collection, then starts practice on them. */
export async function studyLines(lines: LineInput[], signal?: AbortSignal): Promise<string> {
  const first = lines.find(line => line.source)?.source
  if (!first) throw new Error('These lines have no media to collect them under.')
  const collection = await showCollection(first.mediaId, first.title)
  await addLines(collection.id, lines)
  const catalog = await loadCatalog()
  const refs = new Set<string>()
  for (const line of lines) {
    refs.add(phraseRef(line.text))
    for (const unit of findCatalogUnits([line.text], catalog)) refs.add(unit.ref)
  }
  return startCollectionSession(collection.id, { itemIds: [...refs].map(ref => itemId(collection.id, ref)) }, signal)
}
