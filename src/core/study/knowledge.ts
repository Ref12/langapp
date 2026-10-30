import { TERM } from '../collections/terms'
import { db } from '../database'
import { addEvent, exerciseAttemptEvent, reviewEvent } from '../backup/journal'
import { recordJournal } from '../backup/journal-store'
import type { AIConnection } from '../assistant/contracts'
import { loadCatalog, requireUnit, type Catalog, type StudyGroup, type Unit } from './catalog'
import type { PhraseTarget } from './exercises'
import { isSourceRef } from './contracts'
import {
  cardId, unitRef, type Band, type ExerciseAttempt, type ExerciseSession, type KnowledgeEntry, type StudyCard, type StudyDomain,
} from './contracts'
import { checkAnswer, generateBatched, shuffleIndexes } from './exercises'
import { playItem, queueLength, redoFor } from './redo'
import { cancelGeneration, exerciseCountPreference, runGeneration, type GenerationResult } from './generation'
import { emptySchedulingState, schedule, type Rating, type SchedulingState } from './fsrs'

// Knowledge set, next-group selection, review selection and exercise sessions.
// Adding an item to the knowledge set makes it eligible for review; it asserts nothing about proficiency.

export const DOMAIN: StudyDomain = 'reading'
/** Curriculum units among these refs; source entries and phrases have no curriculum record. */
export function curriculumUnits(catalog: Catalog, refs: Iterable<string>): Unit[] {
  return [...new Set(refs)].flatMap(ref => { const unit = catalog.units.get(ref); return unit ? [unit] : [] })
}

/** The exercise targets for source entries in the knowledge set: each is its own word, with its meanings as the translation. */
export async function sourceTargets(refs: Iterable<string>): Promise<PhraseTarget[]> {
  const wanted = [...new Set(refs)].filter(isSourceRef)
  if (!wanted.length) return []
  const entries = await db.sourceEntries.bulkGet(wanted.map(ref => ref.slice('source:'.length)))
  return entries.flatMap(entry => entry ? [{ ref: `source:${entry.id}`, text: entry.word, translation: entry.meanings.join('; '), pinyin: entry.pinyin }] : [])
}

export const REVIEW_ITEMS_PER_SESSION = 8
export const RECENT_REVIEW_ITEMS = 4
const RECENT_NEW_SESSIONS = 2

export interface NextGroup {
  band: Band
  group: StudyGroup
  units: Unit[]
  newUnits: Unit[]
}

export function nextGroup(catalog: Catalog, known: Set<string>): NextGroup | undefined {
  for (const { band, group } of catalog.orderedGroups) {
    const units = group.units.map(unit => requireUnit(catalog, unitRef(unit.kind, unit.ref)))
    const newUnits = units.filter(unit => !known.has(unit.ref))
    if (newUnits.length) return { band, group, units, newUnits }
  }
  return undefined
}

export function groupProgress(catalog: Catalog, known: Set<string>): { completed: number; total: number } {
  let completed = 0
  for (const { group } of catalog.orderedGroups) {
    if (group.units.every(unit => known.has(unitRef(unit.kind, unit.ref)))) completed++
  }
  return { completed, total: catalog.orderedGroups.length }
}

function knowledgeEntry(unit: Unit, source: KnowledgeEntry['source'], now: number): KnowledgeEntry {
  return { ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: now, source }
}

function newCard(ref: string, now: number): StudyCard {
  return { id: cardId(ref, DOMAIN), ref, domain: DOMAIN, ...emptySchedulingState(now), updatedAt: now }
}

async function addUnits(units: Unit[], source: KnowledgeEntry['source'], now: number): Promise<string[]> {
  const added: string[] = []
  for (const unit of units) {
    if (await db.knowledge.get(unit.ref)) continue
    const entry = knowledgeEntry(unit, source, now)
    await db.knowledge.add(entry)
    await recordJournal(addEvent(entry))
    if (!await db.studyCards.get(cardId(unit.ref, DOMAIN))) await db.studyCards.add(newCard(unit.ref, now))
    added.push(unit.ref)
  }
  return added
}

/** Adds words drawn from media sources to the knowledge set, like curriculum units: an entry, a card and a journal event. */
export async function addSourceEntriesToKnowledge(refs: string[]): Promise<string[]> {
  const ids = [...new Set(refs)].map(ref => { if (!isSourceRef(ref)) throw new Error('That is not a source entry.'); return ref.slice('source:'.length) })
  return db.transaction('rw', db.sourceEntries, db.knowledge, db.studyCards, db.journal, async () => {
    const now = Date.now()
    const added: string[] = []
    for (const id of ids) {
      if (!await db.sourceEntries.get(id)) throw new Error('That word is no longer saved from its source.')
      const ref = `source:${id}`
      if (await db.knowledge.get(ref)) continue
      const entry: KnowledgeEntry = { ref, kind: 'source', lb: id, band: '6', addedAt: now, source: 'dictionary' }
      await db.knowledge.add(entry)
      await recordJournal(addEvent(entry))
      if (!await db.studyCards.get(cardId(ref, DOMAIN))) await db.studyCards.add(newCard(ref, now))
      added.push(ref)
    }
    return added
  })
}

/** Adds curriculum units to the knowledge set from the Dictionary. Existing entries are unchanged. */
export async function addToKnowledge(refs: string[]): Promise<void> {
  const catalog = await loadCatalog()
  const units = refs.map(ref => requireUnit(catalog, ref))
  await db.transaction('rw', db.knowledge, db.studyCards, db.journal, () => addUnits(units, 'dictionary', Date.now()))
}

async function requireConnection(): Promise<AIConnection> {
  const connection = await db.aiConnections.get('assistant')
  if (!connection) throw new Error('Connect an AI model in Settings before generating exercises. The app does not include a built-in model.')
  return connection
}

async function activeSession(mode: ExerciseSession['mode']): Promise<ExerciseSession | undefined> {
  // A redo is a repeat, never the curriculum's current step, so it does not count as the unfinished session.
  return db.exerciseSessions.where('status').equals('active').filter(session => session.mode === mode && !session.redoOf && !session.collectionId).sortBy('createdAt').then(rows => rows[0])
}

function recentReviewRefs(sessions: ExerciseSession[], exclude: Set<string>): string[] {
  const recent = sessions.filter(session => session.mode === 'new' && session.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, RECENT_NEW_SESSIONS)
  const refs: string[] = []
  for (const session of recent) {
    for (const ref of session.targetRefs) {
      if (!exclude.has(ref) && !refs.includes(ref)) refs.push(ref)
    }
  }
  return refs.slice(0, RECENT_REVIEW_ITEMS)
}

async function saveSession(session: ExerciseSession): Promise<string> {
  await db.exerciseSessions.add(session)
  return session.id
}

/**
 * Introduces the next curriculum group, then generates its exercises. By default an unfinished New session is resumed first;
 * with `resume: false` it always starts the next group and leaves active sessions alone.
 */
export async function startNewSession(signal?: AbortSignal, options: { resume?: boolean } = {}): Promise<string> {
  const resume = options.resume ?? true
  if (resume) {
    const existing = await activeSession('new')
    if (existing) return existing.id
  }
  const connection = await requireConnection()
  const catalog = await loadCatalog()
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  const next = nextGroup(catalog, known)
  if (!next) throw new Error('Every available curriculum group is already in your knowledge set.')
  const sessions = await db.exerciseSessions.toArray()
  const targetRefs = next.units.map(unit => unit.ref)
  const reviewRefs = recentReviewRefs(sessions, new Set(targetRefs)).filter(ref => known.has(ref) && catalog.units.has(ref))
  const now = Date.now()
  const count = await exerciseCountPreference()
  let created: ExerciseSession | undefined
  const id = await db.transaction('rw', db.knowledge, db.studyCards, db.exerciseSessions, db.journal, async () => {
    // Guard only against the same group being started twice at once.
    const resumed = resume ? await activeSession('new') : await db.exerciseSessions.where('status').equals('active')
      .filter(session => session.mode === 'new' && !session.redoOf && session.groupId === next.group.id).first()
    if (resumed) return resumed.id
    await addUnits(next.newUnits, 'new', now)
    created = {
      id: crypto.randomUUID(), mode: 'new', domain: DOMAIN, groupId: next.group.id, targetRefs, reviewRefs,
      exercises: [], cursor: 0, status: 'active', model: connection.model, rejected: [], createdAt: now, generation: 'running', exerciseCount: count,
    }
    return saveSession(created)
  })
  if (created) { const session = created; void runGeneration(id, own => lessonResult(session, signal ? AbortSignal.any([signal, own]) : own)) }
  return id
}

/** Writes the exercises for a New, Review or redo session from its saved targets; also what Try again runs. */
export async function lessonResult(session: ExerciseSession, signal?: AbortSignal): Promise<GenerationResult> {
  const connection = await requireConnection()
  const catalog = await loadCatalog()
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  const targets = curriculumUnits(catalog, session.targetRefs)
  const review = curriculumUnits(catalog, session.reviewRefs)
  const allowed = curriculumUnits(catalog, [...known, ...session.targetRefs, ...session.reviewRefs])
  const phrases = await sourceTargets(session.mode === 'new' ? known : [...session.targetRefs, ...session.reviewRefs])
  return generateBatched(connection, { mode: session.mode, targets, review, allowed, catalog, phrases }, session.exerciseCount ?? await exerciseCountPreference(), signal)
}

export async function dueCards(now: number): Promise<StudyCard[]> {
  return db.studyCards.where('[domain+due]').between([DOMAIN, 0], [DOMAIN, now], true, true).toArray()
}

/** Reviews due items chosen by FSRS; with `anyway`, reviews the soonest-due items even when nothing is due. */
export async function startReviewSession(now: number, anyway = false, signal?: AbortSignal): Promise<string> {
  const existing = await activeSession('review')
  if (existing) return existing.id
  const connection = await requireConnection()
  const catalog = await loadCatalog()
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  const cards = (anyway ? await db.studyCards.where('domain').equals(DOMAIN).toArray() : await dueCards(now))
    .filter(card => known.has(card.ref) && (catalog.units.has(card.ref) || isSourceRef(card.ref)))
    .sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref))
  const chosen = cards.slice(0, REVIEW_ITEMS_PER_SESSION)
  const targets = chosen.flatMap(card => catalog.units.has(card.ref) ? [requireUnit(catalog, card.ref)] : [])
  const sourceWords = await sourceTargets(chosen.map(card => card.ref))
  if (!targets.length && !sourceWords.length) throw new Error(known.size ? 'Nothing is due for review right now.' : 'Your knowledge set is empty. Start with New, or add items from the Dictionary.')
  const count = await exerciseCountPreference()
  let created: ExerciseSession | undefined
  const id = await db.transaction('rw', db.exerciseSessions, async () => {
    const resumed = await activeSession('review')
    if (resumed) return resumed.id
    created = {
      id: crypto.randomUUID(), mode: 'review', domain: DOMAIN, targetRefs: [...targets.map(unit => unit.ref), ...sourceWords.map(word => word.ref)], reviewRefs: [],
      exercises: [], cursor: 0, status: 'active', model: connection.model, rejected: [], createdAt: Date.now(), generation: 'running', exerciseCount: count,
    }
    return saveSession(created)
  })
  if (created) { const session = created; void runGeneration(id, own => lessonResult(session, signal ? AbortSignal.any([signal, own]) : own)) }
  return id
}

/** Starts a fresh session with the same mode and items as an earlier one; the earlier session and its attempts stay. */
export async function startRedoSession(sourceId: string, signal?: AbortSignal): Promise<string> {
  const source = await db.exerciseSessions.get(sourceId)
  if (!source) throw new Error('That lesson session could not be found.')
  if (source.collectionId) throw new Error(`Practice a ${TERM.singular} from its own page.`)
  const connection = await requireConnection()
  // A redo is only a repeat: starting another replaces the unfinished one.
  const previous = await db.exerciseSessions.where('status').equals('active').filter(item => !!item.redoOf).toArray()
  for (const item of previous) await discardSession(item.id)
  const id = await saveSession({
    id: crypto.randomUUID(), mode: source.mode, domain: source.domain, ...(source.groupId ? { groupId: source.groupId } : {}),
    targetRefs: source.targetRefs, reviewRefs: source.reviewRefs, exercises: [], cursor: 0, status: 'active',
    model: connection.model, rejected: [], createdAt: Date.now(), redoOf: source.id, generation: 'running', exerciseCount: await exerciseCountPreference(),
  })
  const session = (await db.exerciseSessions.get(id))!
  void runGeneration(id, own => lessonResult(session, signal ? AbortSignal.any([signal, own]) : own))
  return id
}

function schedulingState(card: StudyCard): SchedulingState {
  return { due: card.due, stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview }
}

export async function submitExerciseAnswer(sessionId: string, index: number, response: unknown): Promise<ExerciseAttempt> {
  return db.transaction('rw', db.exerciseSessions, db.exerciseAttempts, db.studyCards, db.knowledge, db.journal, async () => {
    const id = `${sessionId}:${index}`
    const existing = await db.exerciseAttempts.get(id)
    if (existing) return existing
    const session = await db.exerciseSessions.get(sessionId)
    if (!session || session.status !== 'active' || session.cursor !== index) throw new Error('This exercise is no longer active.')
    const item = playItem(session, index)
    if (!item) throw new Error('This exercise is no longer active.')
    const exercise = item.exercise
    const result = checkAnswer(exercise, response)
    const now = Date.now()
    const attempt: ExerciseAttempt = { id, sessionId, index, refs: exercise.targets, response: result.response, correct: result.correct, ...(item.redo ? { redo: true } : {}), createdAt: now }
    await db.exerciseAttempts.add(attempt)
    // A miss goes to the end of the session to be played again; the first attempt below is graded as usual.
    const redo = result.correct ? undefined : redoFor(item, shuffleIndexes)
    if (redo) await db.exerciseSessions.put({ ...session, redos: [...(session.redos ?? []), redo] })
    // A redo only has to be answered correctly: nothing is journaled or scheduled again.
    if (item.redo) return attempt
    // Collection practice schedules the shared card but journals reviews only for items in the knowledge set.
    const inKnowledge = new Set((await db.knowledge.bulkGet(exercise.targets)).flatMap(entry => entry ? [entry.ref] : []))
    await recordJournal(exerciseAttemptEvent(attempt))
    const rating: Rating = result.correct ? 3 : 1
    for (const ref of exercise.targets) {
      const card = await db.studyCards.get(cardId(ref, DOMAIN))
      if (!card) continue // Items removed from the knowledge set are not rescheduled.
      await db.studyCards.put({ ...card, ...schedule(schedulingState(card), rating, now), updatedAt: now })
      if (inKnowledge.has(ref)) await recordJournal(reviewEvent(ref, rating, now, id))
    }
    return attempt
  })
}

export async function advanceExercise(sessionId: string, index: number): Promise<void> {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid exercise position.')
  await db.transaction('rw', db.exerciseSessions, db.exerciseAttempts, async () => {
    const session = await db.exerciseSessions.get(sessionId)
    if (!session) throw new Error('Exercise session not found.')
    if (session.status === 'completed' || session.cursor > index) return
    if (session.cursor !== index || !await db.exerciseAttempts.get(`${sessionId}:${index}`)) throw new Error('Check your answer before continuing.')
    if (index < queueLength(session) - 1) {
      await db.exerciseSessions.put({ ...session, cursor: index + 1 })
    } else {
      await db.exerciseSessions.put({ ...session, status: 'completed', completedAt: Date.now() })
    }
  })
}

/** Abandons an unfinished session. Recorded answers keep their scheduling effect. */
export async function discardSession(sessionId: string): Promise<void> {
  cancelGeneration(sessionId)
  await db.transaction('rw', db.exerciseSessions, async () => {
    const session = await db.exerciseSessions.get(sessionId)
    if (!session || session.status !== 'active') return
    await db.exerciseSessions.put({ ...session, status: 'abandoned', completedAt: Date.now() })
  })
}
