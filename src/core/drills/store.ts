import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { cardId, isSourceRef, type StudyCard } from '../study/contracts'
import { addUnits, dueCards, DOMAIN, nextGroup } from '../study/knowledge'
import { schedule, type SchedulingState } from '../study/fsrs'
import { reviewEvent } from '../backup/journal'
import { recordJournal } from '../backup/journal-store'
import { promoteItems } from '../collections/store'
import { isPhraseRef } from '../study/contracts'
import { cancelContent, startContent } from './content'
import { MARK_RATING, drillSetSchema, type DrillFormat, type DrillSet, type DrillTypeId, type Mark } from './contracts'

export const NEW_SET_SIZE = 10
export const REVIEW_SET_SIZE = 12
export const STUDY_SET_LIMIT = 40
/** Unfinished sets kept at once; starting another quietly sets the oldest untouched one aside. */
export const MAX_UNFINISHED_SETS = 8

export type DrillSource = { kind: 'new'; from?: string } | { kind: 'review'; from?: string } | { kind: 'study-set'; collectionId: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (time: number) => { const date = new Date(time); return `${date.getDate()} ${MONTHS[date.getMonth()]}` }
export const originLabel = (source: DrillSource['kind']) => source === 'review' ? 'Reviews' : 'New words'

function emptySet(fields: Pick<DrillSet, 'id' | 'source' | 'title' | 'refs' | 'createdAt'> & { collectionId?: string }): DrillSet {
  return { ...fields, status: 'active', format: 'single', progress: {}, content: { state: 'pending', sentences: {}, conversations: [] }, updatedAt: fields.createdAt }
}

async function chooseRefs(source: DrillSource, now: number): Promise<{ refs: string[]; title: string; collectionId?: string; promote?: string[] }> {
  const catalog = await loadCatalog()
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  if (source.kind === 'review' && source.from) {
    const collection = await db.collections.get(source.from)
    if (!collection) throw new Error('That study set could not be found.')
    const inSet = new Set((await db.collectionItems.where('collectionId').equals(source.from).toArray()).map(item => item.ref))
    const cards = (await dueCards(now)).filter(card => inSet.has(card.ref) && known.has(card.ref) && (catalog.units.has(card.ref) || isSourceRef(card.ref) || isPhraseRef(card.ref)))
      .sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref)).slice(0, REVIEW_SET_SIZE)
    if (!cards.length) throw new Error(`Nothing in ${collection.name} is due for review right now.`)
    return { refs: cards.map(card => card.ref), title: `Reviews · ${shortDate(now)}`, collectionId: source.from }
  }
  if (source.kind === 'review') {
    const cards = (await dueCards(now)).filter(card => known.has(card.ref) && (catalog.units.has(card.ref) || isSourceRef(card.ref)))
      .sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref)).slice(0, REVIEW_SET_SIZE)
    if (!cards.length) throw new Error(known.size ? 'Nothing is due for review right now.' : 'Your knowledge set is empty. Start with New words, or add items from the Dictionary.')
    return { refs: cards.map(card => card.ref), title: `Reviews · ${shortDate(now)}` }
  }
  if (source.kind === 'new' && !source.from) {
    const next = nextGroup(catalog, known)
    if (!next) throw new Error('Every available curriculum group is already in your knowledge set.')
    return { refs: next.newUnits.slice(0, NEW_SET_SIZE).map(unit => unit.ref), title: `New words · ${shortDate(now)}` }
  }
  const collectionId = source.kind === 'new' ? source.from! : source.collectionId
  const collection = await db.collections.get(collectionId)
  if (!collection) throw new Error('That study set could not be found.')
  const items = (await db.collectionItems.where('collectionId').equals(collectionId).toArray()).sort((a, b) => a.addedAt - b.addedAt)
  if (source.kind === 'new') {
    const cards = new Map((await db.studyCards.bulkGet(items.map(item => cardId(item.ref, DOMAIN)))).flatMap(card => card ? [[card.ref, card] as const] : []))
    const fresh = items.filter(item => isPhraseRef(item.ref) ? !(cards.get(item.ref)?.reps) : !known.has(item.ref)).slice(0, NEW_SET_SIZE)
    if (!fresh.length) throw new Error(`Every item in this study set is already in your knowledge set.`)
    return { refs: fresh.map(item => item.ref), title: `New words · ${shortDate(now)}`, collectionId, promote: fresh.map(item => item.id) }
  }
  if (!items.length) throw new Error('This study set has no items yet.')
  const cards = new Map((await db.studyCards.bulkGet(items.map(item => cardId(item.ref, DOMAIN)))).flatMap(card => card ? [[card.ref, card] as const] : []))
  const due = (ref: string) => { const card = cards.get(ref); return !card || card.due <= now ? 0 : 1 }
  const chosen = [...items].sort((a, b) => due(a.ref) - due(b.ref) || a.addedAt - b.addedAt).slice(0, STUDY_SET_LIMIT)
  return { refs: chosen.map(item => item.ref), title: collection.name, collectionId }
}

/** Creates a drill set from a source and starts writing its sentences in the background. New items join the knowledge set, as a lesson's do. */
export async function createDrillSet(source: DrillSource, now = Date.now()): Promise<string> {
  const chosen = await chooseRefs(source, now)
  const catalog = await loadCatalog()
  if (chosen.promote) await promoteItems(chosen.promote)
  const id = crypto.randomUUID()
  const set = emptySet({ id, source: source.kind, title: chosen.title, refs: chosen.refs, createdAt: now, ...(chosen.collectionId ? { collectionId: chosen.collectionId } : {}) })
  await db.transaction('rw', [db.drillSets, db.knowledge, db.studyCards, db.journal], async () => {
    if (source.kind === 'new' && !source.from) {
      const units = chosen.refs.flatMap(ref => catalog.units.get(ref) ?? [])
      await addUnits(units, 'new', now)
    }
    await db.drillSets.add(drillSetSchema.parse(set))
    const unfinished = (await db.drillSets.where('status').equals('active').sortBy('createdAt')).filter(item => item.id !== id)
    for (const old of unfinished.slice(0, Math.max(0, unfinished.length - (MAX_UNFINISHED_SETS - 1)))) {
      if (!Object.keys(old.progress).length) await db.drillSets.put({ ...old, status: 'abandoned', completedAt: now })
    }
  })
  void startContent(id)
  return id
}

export const getDrillSet = (id: string) => db.drillSets.get(id)

async function mutate(id: string, change: (set: DrillSet) => DrillSet | undefined): Promise<DrillSet | undefined> {
  return db.transaction('rw', db.drillSets, async () => {
    const set = await db.drillSets.get(id)
    const next = set && change(set)
    if (!set || !next) return set
    await db.drillSets.put({ ...next, updatedAt: Date.now() })
    return next
  })
}

function schedulingState(card: StudyCard): SchedulingState {
  return { due: card.due, stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview }
}

/**
 * Records one item's result in a drill type. Only the first pass of a type is graded: it is stored in the set and scheduled like a lesson answer
 * (Got it = Good, Needed a hint = Hard, Missed = Again). Once the type is done, or the item already has a result, nothing changes (a redo is ungraded).
 */
export async function recordDrillResult(setId: string, type: DrillTypeId, ref: string, mark: Mark, scope: readonly string[], now = Date.now()): Promise<{ graded: boolean }> {
  return db.transaction('rw', [db.drillSets, db.studyCards, db.knowledge, db.journal], async () => {
    const set = await db.drillSets.get(setId)
    if (!set || set.status !== 'active') return { graded: false }
    const current = set.progress[type] ?? { results: {}, scope: [...scope], done: false, redos: 0 }
    if (current.done || current.results[ref]) return { graded: false }
    const results = { ...current.results, [ref]: mark }
    const covered = current.scope.length ? current.scope : [...scope]
    const done = covered.every(item => results[item])
    await db.drillSets.put({ ...set, updatedAt: now, progress: { ...set.progress, [type]: { ...current, scope: covered, results, done, ...(done ? { finishedAt: now } : {}) } } })
    const rating = MARK_RATING[mark]
    const card = await db.studyCards.get(cardId(ref, DOMAIN))
    if (card) {
      await db.studyCards.put({ ...card, ...schedule(schedulingState(card), rating, now), updatedAt: now })
      if (await db.knowledge.get(ref)) await recordJournal(reviewEvent(ref, rating, now, `drill:${setId}:${type}`))
    }
    return { graded: true }
  })
}

/** Counts a Redo of a finished type. The score is untouched. */
export async function recordRedo(setId: string, type: DrillTypeId): Promise<void> {
  await mutate(setId, set => { const current = set.progress[type]; return current ? { ...set, progress: { ...set.progress, [type]: { ...current, redos: current.redos + 1 } } } : undefined })
}

export const setFormat = (id: string, format: DrillFormat) => mutate(id, set => set.format === format ? undefined : { ...set, format })

export async function finishDrillSet(id: string): Promise<void> {
  await mutate(id, set => set.status === 'completed' ? undefined : { ...set, status: 'completed', completedAt: Date.now() })
}

/** Abandons an unfinished set. Results already recorded keep their scheduling effect. */
export async function discardDrillSet(id: string): Promise<void> {
  cancelContent(id)
  await mutate(id, set => set.status !== 'active' ? undefined : { ...set, status: 'abandoned', completedAt: Date.now() })
}

export const retryContent = (id: string) => startContent(id)
export const unfinishedSets = (sets: readonly DrillSet[]) => sets.filter(set => set.status === 'active').sort((a, b) => b.createdAt - a.createdAt)
