import { getPack, isAreaOn } from '../../core/language'
import { navigate } from '../../core/routing'
import type { DrillSet } from '../../core/drills/contracts'
import { ensureHandsfree, restartHandsfree, activityOf, handsfreeRoute, type HandsfreeKind } from '../../core/drills/store'
import { loadHandsfreeSettings } from '../../core/handsfree/store'
import type { PageProps } from '../../components/shared'

const setRoute = (id: string, page = '') => `practice/set/${id}${page ? `/${page}` : ''}`

/** The two Hands-free practice types of a set. */
const ALL_HANDSFREE_TYPES: { kind: HandsfreeKind; name: string; blurb: string }[] = [
  { kind: 'introduction', name: 'Hands-free introduction', blurb: 'A hands-free lesson: each word and its phrase introduced, then recalled' },
  { kind: 'recall', name: 'Hands-free recall', blurb: 'Scrambled recall of words and phrases, both directions' },
]
/** The Hands-free types of a build that has the Hands-free area. */
export const handsfreeTypes = () => isAreaOn(getPack(), 'handsFree') ? ALL_HANDSFREE_TYPES : []
/** Phrase sets have no Hands-free, as on the Practice home. */
export const setHasHandsfree = (set: DrillSet) => set.source !== 'phrases' && handsfreeTypes().length > 0
/** Where a type sits in a list: stopped first, then not started, then done. */
export const handsfreeRank = (set: DrillSet, kind: HandsfreeKind) => { const hf = activityOf(set, kind); return hf?.done ? 2 : hf?.started ? 0 : 1 }

/** Opens a Hands-free type of a set: again = restart it, else start or continue it. */
export const useOpenHandsfree = (set: DrillSet, run: PageProps['run']) => (again: boolean, kind: HandsfreeKind) =>
  void run(async () => { if (again) await restartHandsfree(set.id, kind); else await ensureHandsfree(set.id, loadHandsfreeSettings(), kind); navigate(setRoute(set.id, handsfreeRoute(kind))) })
