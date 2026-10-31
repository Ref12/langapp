import { db } from '../database'
import { loadCatalog, requireUnit } from '../study/catalog'
import { cardId, isPhraseRef, isSourceRef, type Exercise, type ExerciseSession, type StudyCard } from '../study/contracts'
import { emptySchedulingState } from '../study/fsrs'
import { DOMAIN, addToKnowledge, sourceTargets } from '../study/knowledge'
import { generateStreaming, type PhraseTarget } from '../study/exercises'
import { exerciseCountPreference, runGeneration, type Emit, type GenerationResult } from '../study/generation'
import { fillLocalExercises, isVocabulary, localVocabularyExercises, seedFrom, vocabularyInPhrases, type LocalInput, type VocabularyUnit } from '../study/local-exercises'
import type { Catalog, Unit } from '../study/catalog'
import { orderByPhase, phaseOf } from './phases'
import { findCatalogUnits } from './extract'
import { TERM } from './terms'
import { itemId, phraseRef, type Collection, type CollectionItem, type CollectionSource } from './contracts'

/** A subtitle line to add: its text, optional translation and where it came from. */
export interface LineInput { text: string; translation?: string; source?: CollectionSource }

export const MAX_COLLECTION_TARGETS = 8

function newCard(ref: string, now: number): StudyCard {
  return { id: cardId(ref, DOMAIN), ref, domain: DOMAIN, ...emptySchedulingState(now), updatedAt: now }
}

export async function createCollection(name: string): Promise<Collection> {
  const clean = name.trim()
  if (!clean) throw new Error(`Name the ${TERM.singular}.`)
  const now = Date.now()
  const collection: Collection = { id: crypto.randomUUID(), name: clean.slice(0, 120), kind: 'user', createdAt: now, updatedAt: now }
  await db.collections.add(collection)
  return collection
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) throw new Error(`Name the ${TERM.singular}.`)
  await db.transaction('rw', db.collections, async () => {
    const collection = await db.collections.get(id)
    if (!collection) throw new Error(`That ${TERM.singular} no longer exists.`)
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
    if (!collection) throw new Error(`That ${TERM.singular} no longer exists.`)
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
export async function startCollectionSession(collectionId: string, options: { itemIds?: string[]; dueOnly?: boolean; now?: number; resume?: boolean } = {}, signal?: AbortSignal): Promise<string> {
  // One unfinished session per collection; starting again resumes it unless asked for a fresh one.
  if (options.resume !== false) {
    const open = await db.exerciseSessions.where('status').equals('active').filter(item => item.collectionId === collectionId).sortBy('createdAt')
    if (open.length) return open[0].id
  }
  const connection = await db.aiConnections.get('assistant')
  if (!connection) throw new Error('Connect an AI model in Settings before generating exercises. The app does not include a built-in model.')
  const catalog = await loadCatalog()
  let items = await db.collectionItems.where('collectionId').equals(collectionId).toArray()
  if (options.itemIds) { const wanted = new Set(options.itemIds); items = items.filter(item => wanted.has(item.id)) }
  if (options.dueOnly) { const due = new Set((await dueItems(collectionId, options.now ?? Date.now())).map(item => item.id)); items = items.filter(item => due.has(item.id)) }
  const cards = new Map((await db.studyCards.bulkGet(items.map(item => cardId(item.ref, DOMAIN)))).flatMap(card => card ? [[card.ref, card] as const] : []))
  items = items.filter(item => isPhraseRef(item.ref) ? !!item.text : isSourceRef(item.ref) || catalog.units.has(item.ref))
  // Lesson order: words, then grammar, then phrases. A chosen selection keeps its order (first appearance in the line); otherwise the most due first.
  const given = options.itemIds ? new Map(options.itemIds.map((wanted, index) => [wanted, index])) : undefined
  const rank = (ref: string) => isPhraseRef(ref) ? 2 : ref.startsWith('grammar:') ? 1 : 0
  items.sort((a, b) => rank(a.ref) - rank(b.ref) || (given ? (given.get(a.id) ?? 0) - (given.get(b.id) ?? 0) : (cards.get(a.ref)?.due ?? 0) - (cards.get(b.ref)?.due ?? 0) || a.ref.localeCompare(b.ref)))
  // A chosen selection keeps every word; otherwise the usual caps apply. Grammar and phrase caps stay either way.
  const all = items.filter(item => rank(item.ref) === 0)
  const words = options.itemIds ? all : all.slice(0, MAX_COLLECTION_TARGETS)
  items = [...words, ...items.filter(item => rank(item.ref) === 1).slice(0, 3), ...items.filter(item => rank(item.ref) === 2).slice(0, 3)]
  if (!items.length) throw new Error(options.dueOnly ? `Nothing in this ${TERM.singular} is due right now.` : `This ${TERM.singular} has no items to practice yet.`)
  const refs = items.map(item => item.ref)
  const id = crypto.randomUUID()
  const now = Date.now()
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  const opening = await openingExercises(catalog, known, { id, targetRefs: refs }, items)
  const session: ExerciseSession = {
    id, mode: 'review', domain: DOMAIN, collectionId, targetRefs: refs, reviewRefs: [], exercises: opening, ...(opening.length ? { phases: [{ kind: 'words' as const, start: 0 }] } : {}), cursor: 0, status: 'active',
    model: connection.model, rejected: [], createdAt: now, generation: 'running', exerciseCount: await exerciseCountPreference(),
  }
  await db.transaction('rw', db.exerciseSessions, db.studyCards, async () => {
    for (const ref of refs) if (!await db.studyCards.get(cardId(ref, DOMAIN))) await db.studyCards.add(newCard(ref, now))
    await db.exerciseSessions.add(session)
  })
  void runGeneration(id, (own, emit) => collectionResult(session, signal ? AbortSignal.any([signal, own]) : own, emit))
  return id
}

/** A source-entry word that carries pinyin, as a vocabulary unit the local builders can drill. */
function sourceUnits(entries: { id: string; word: string; pinyin?: string; meanings: string[] }[]): VocabularyUnit[] {
  return entries.flatMap(entry => entry.pinyin?.trim() && entry.meanings.length ? [{ kind: 'vocabulary' as const, ref: `source:${entry.id}`, band: '6' as const, record: { id: entry.id, ch: entry.word, pr: entry.pinyin.trim(), ds: entry.meanings.join('; '), lb: entry.id } }] : [])
}

/** What the programmatic exercises are built from: the set's curriculum words and source words with pinyin; with none, the known words found in its whole lines. */
async function localInput(catalog: Catalog, known: Set<string>, session: Pick<ExerciseSession, 'id' | 'targetRefs'>, items: CollectionItem[]): Promise<LocalInput> {
  const refs = new Set(session.targetRefs)
  const entries = (await db.sourceEntries.bulkGet(session.targetRefs.filter(isSourceRef).map(ref => ref.slice('source:'.length)))).flatMap(entry => entry ? [entry] : [])
  const own: Unit[] = [...session.targetRefs.flatMap(ref => { const unit = catalog.units.get(ref); return unit && isVocabulary(unit) ? [unit] : [] }), ...sourceUnits(entries)]
  const curriculum = [...catalog.units.values()].filter(isVocabulary)
  const lines = items.filter(item => refs.has(item.ref) && isPhraseRef(item.ref) && item.text).map(item => ({ text: item.text! }))
  const knownVocabulary = curriculum.filter(unit => known.has(unit.ref))
  const targets = own.length ? own : vocabularyInPhrases(lines, knownVocabulary.length ? knownVocabulary : curriculum)
  return { targets, pool: [...curriculum, ...sourceUnits(entries)], known, seed: seedFrom(session.id) }
}

/** The exercises a study-set lesson opens on, built in code before any AI request. */
async function openingExercises(catalog: Catalog, known: Set<string>, session: Pick<ExerciseSession, 'id' | 'targetRefs'>, items: CollectionItem[]): Promise<Exercise[]> {
  return localVocabularyExercises(await localInput(catalog, known, session, items))
}

/** The smallest share of a lesson's exercises a word chunk gets, so every chunk's request stays usable. */
const MIN_CHUNK_EXERCISES = 6

/** Phases for the final list when its exercises already sit in lesson order (the local words first); undefined when streaming interleaved them. */
function phasesIfOrdered(exercises: Exercise[]): ExerciseSession['phases'] {
  const order = ['words', 'grammar', 'line']
  const phases: NonNullable<ExerciseSession['phases']> = []
  let last = 0
  for (const [index, exercise] of exercises.entries()) {
    const kind = phaseOf(exercise), rank = order.indexOf(kind)
    if (rank < last) return undefined
    last = rank
    if (!phases.some(phase => phase.kind === kind)) phases.push({ kind, start: index })
  }
  return phases
}

/**
 * Streams the AI's exercises for a collection session into the saved session batch by batch. Words go in chunks of at most MAX_COLLECTION_TARGETS,
 * one request per chunk, run together; grammar and phrases ride with the first chunk. A batch is put in lesson order (words, grammar, the line) before it joins.
 * A failure or shortfall is filled with more programmatic vocabulary exercises, and the failure is a quiet notice.
 */
export async function collectionResult(session: ExerciseSession, signal?: AbortSignal, emit?: Emit): Promise<GenerationResult> {
  const connection = await db.aiConnections.get('assistant')
  if (!connection) throw new Error('Connect an AI model in Settings before generating exercises. The app does not include a built-in model.')
  const catalog = await loadCatalog()
  const collectionId = session.collectionId!
  const items = (await db.collectionItems.bulkGet(session.targetRefs.map(ref => itemId(collectionId, ref)))).flatMap(item => item ? [item] : [])
  if (!items.length) throw new Error(`The items of this ${TERM.singular} lesson are gone.`)
  const rank = (ref: string) => isPhraseRef(ref) ? 2 : ref.startsWith('grammar:') ? 1 : 0
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  const targetsOf = (part: CollectionItem[]) => part.filter(item => !isPhraseRef(item.ref) && !isSourceRef(item.ref)).map(item => requireUnit(catalog, item.ref))
  const phrasesOf = async (part: CollectionItem[]): Promise<PhraseTarget[]> => [...await sourceTargets(part.map(item => item.ref)), ...part.filter(item => isPhraseRef(item.ref)).map(item => ({ ref: item.ref, text: item.text!, ...(item.translation ? { translation: item.translation } : {}) }))]
  const words = items.filter(item => rank(item.ref) === 0)
  const rest = items.filter(item => rank(item.ref) !== 0)
  const chunks: CollectionItem[][] = []
  for (let from = 0; from < words.length || !chunks.length; from += MAX_COLLECTION_TARGETS) chunks.push(words.slice(from, from + MAX_COLLECTION_TARGETS))
  chunks[0] = [...chunks[0], ...rest]
  const total = session.exerciseCount ?? await exerciseCountPreference()
  const share = Math.max(MIN_CHUNK_EXERCISES, Math.ceil(total / chunks.length))
  let delivered = 0
  let failure: Error | undefined
  const rejected: string[] = []
  const joined: Exercise[] = []
  await Promise.all(chunks.map(async (part, index) => {
    try {
      const targets = targetsOf(part)
      const allowed = [...new Map([...known, ...targets.map(unit => unit.ref)].filter(ref => catalog.units.has(ref)).map(ref => [ref, requireUnit(catalog, ref)])).values()]
      const outcome = await generateStreaming(connection, { mode: 'review', targets, review: [], allowed, catalog, phrases: await phrasesOf(part) }, share, signal, async batch => {
        const prefixed = chunks.length === 1 ? batch.exercises : batch.exercises.map(exercise => ({ ...exercise, id: `${index + 1}-${exercise.id}` }))
        const ordered = orderByPhase(prefixed).exercises
        if (emit) await emit(ordered, batch.rejected)
        else { joined.push(...ordered); rejected.push(...batch.rejected) }
      })
      delivered += outcome.delivered
      failure ??= outcome.failure
    } catch (reason) {
      failure ??= reason instanceof Error ? reason : new Error('The exercises could not be generated.')
    }
  }))
  if (signal?.aborted) return { exercises: [], rejected: [], appended: true }
  const have = session.exercises.length + delivered
  const current = (await db.exerciseSessions.get(session.id))?.exercises ?? session.exercises
  const complete = !failure && have >= total
  const fill = complete ? [] : fillLocalExercises(await localInput(catalog, known, session, items), Math.max(0, total - have))
  if (failure && !have && !fill.length) throw failure
  const phases = phasesIfOrdered([...current, ...(emit ? [] : joined), ...fill])
  return { exercises: emit ? fill : [...joined, ...fill], rejected: emit ? [] : rejected, appended: true, ...(phases ? { phases } : {}), ...(failure ? { notice: failure.message.slice(0, 600) } : {}) }
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
