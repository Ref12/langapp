import type { StudyCard } from '../study/contracts'
import type { Collection, CollectionItem, CollectionsBackup } from './contracts'

// Collections travel in backups as their own section. Cards of collection items belong to the section,
// not to the study cards (which stay one per knowledge item), so a collection-only item never looks like knowledge.

interface Readable<T> { toArray(): Promise<T[]> }
export interface CollectionTables {
  collections: Readable<Collection>
  collectionItems: Readable<CollectionItem>
  studyCards: Readable<StudyCard> & { bulkGet(ids: string[]): Promise<(StudyCard | undefined)[]> }
}

export async function readCollectionsState(tables: CollectionTables): Promise<CollectionsBackup> {
  const [collections, items] = await Promise.all([tables.collections.toArray(), tables.collectionItems.toArray()])
  const ids = [...new Set(items.map(item => `${item.ref}:reading`))]
  const cards = (await tables.studyCards.bulkGet(ids)).flatMap(card => card ? [card] : [])
  return { collections, items, cards }
}

/** Study cards that belong to the knowledge set. */
export function knowledgeCards(cards: StudyCard[], known: Set<string>): StudyCard[] {
  return cards.filter(card => known.has(card.ref))
}

/** Per-collection files for the repository layout. */
export function splitCollections(state: CollectionsBackup): { id: string; value: CollectionsBackup }[] {
  const cards = new Map(state.cards.map(card => [card.ref, card]))
  return state.collections.map(collection => {
    const items = state.items.filter(item => item.collectionId === collection.id)
    return { id: collection.id, value: { collections: [collection], items, cards: [...new Set(items.map(item => item.ref))].flatMap(ref => cards.has(ref) ? [cards.get(ref)!] : []) } }
  })
}

export function joinCollections(parts: CollectionsBackup[]): CollectionsBackup {
  const cards = new Map<string, StudyCard>()
  for (const part of parts) for (const card of part.cards ?? []) if ((cards.get(card.id)?.reps ?? -1) <= card.reps) cards.set(card.id, card)
  return { collections: parts.flatMap(part => part.collections), items: parts.flatMap(part => part.items), cards: [...cards.values()] }
}

/** The card to keep when two exist for one item: the one with more history. */
export function richerCard(a: StudyCard | undefined, b: StudyCard): StudyCard {
  return a && a.reps > b.reps ? a : b
}
