// The top-level areas of the app that a language pack can switch off, and which route belongs to which area.
// Lessons, Practice, Overview and Settings (profiles and backup) are always on and are not listed.

export const AREAS = ['games', 'media', 'library', 'collections', 'assistant', 'history', 'dictionary', 'writing', 'handsFree', 'wordLists'] as const
export type Area = (typeof AREAS)[number]
export type Features = Record<Area, boolean>

/** The area a route (the hash without '#') belongs to, or undefined for an always-on page. */
export function areaOfRoute(route: string): Area | undefined {
  const [page, id] = route.split('?')[0].split('/')
  switch (page) {
    case 'library': case 'book': case 'reader': return 'library'
    case 'media': return 'media'
    case 'collections': return 'collections'
    case 'games': return 'games'
    case 'history': return 'history'
    case 'dictionary': return 'dictionary'
    case 'writing': return 'writing'
    case 'conversation': return 'assistant'
    // The old Word-list pages: the curriculum map, level and lesson pages, the old review page and its saved sessions.
    case 'curriculum': case 'level': case 'lesson': case 'review': return 'wordLists'
    case 'practice':
      if (id === 'mahjong') return 'games'
      if (id === 'handsfree') return 'handsFree'
      return id && id !== 'set' ? 'wordLists' : undefined
    default: return undefined
  }
}
