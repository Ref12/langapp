import { db } from '../database'
import { rowsOfCurrentLanguage } from '../language/scope'
import type { Preferences } from '../model'
import type { Collection } from './contracts'

/**
 * The collections of the language the learner is in. A collection has no language field; its language is that of its items' refs
 * (ja:/ko: marks), and a collection with no items, or only unmarked refs, is Chinese (where media lines are saved today).
 */
export async function collectionsOfCurrentLanguage(preferences: Pick<Preferences, 'currentLanguage'>): Promise<Collection[]> {
  const [collections, items] = await Promise.all([db.collections.orderBy('updatedAt').reverse().toArray(), db.collectionItems.toArray()])
  const refs = new Map<string, string[]>()
  for (const item of items) { const list = refs.get(item.collectionId); if (list) list.push(item.ref); else refs.set(item.collectionId, [item.ref]) }
  return rowsOfCurrentLanguage(collections, collection => refs.get(collection.id) ?? [], preferences)
}

/** The language switch as stored (for components that do not receive the workspace). */
export async function storedLanguagePreference(): Promise<Pick<Preferences, 'currentLanguage'>> {
  return { currentLanguage: (await db.preferences.get('workspace'))?.currentLanguage }
}
