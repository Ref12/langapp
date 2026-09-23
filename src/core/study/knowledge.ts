import { db } from '../database'
import type { AIConnection } from '../assistant/contracts'
import { loadCatalog, requireUnit, type Catalog, type StudyGroup, type Unit } from './catalog'
import {
  cardId, unitRef, type Band, type ExerciseAttempt, type ExerciseSession, type KnowledgeEntry, type StudyCard, type StudyDomain,
} from './contracts'
import { checkAnswer, generateExercises } from './exercises'
import { emptySchedulingState, schedule, type Rating, type SchedulingState } from './fsrs'

// Knowledge set, next-group selection, review selection and exercise sessions.
// Adding an item to the knowledge set makes it eligible for review; it asserts nothing about proficiency.

export const DOMAIN: StudyDomain = 'reading'
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
    await db.knowledge.add(knowledgeEntry(unit, source, now))
    if (!await db.studyCards.get(cardId(unit.ref, DOMAIN))) await db.studyCards.add(newCard(unit.ref, now))
    added.push(unit.ref)
  }
  return added
}

/** Adds curriculum units to the knowledge set from the Dictionary. Existing entries are unchanged. */
export async function addToKnowledge(refs: string[]): Promise<void> {
  const catalog = await loadCatalog()
  const units = refs.map(ref => requireUnit(catalog, ref))
  await db.transaction('rw', db.knowledge, db.studyCards, () => addUnits(units, 'dictionary', Date.now()))
}

async function requireConnection(): Promise<AIConnection> {
  const connection = await db.aiConnections.get('assistant')
  if (!connection) throw new Error('Connect an AI model in Settings before generating exercises. The app does not include a built-in model.')
  return connection
}

async function activeSession(mode: ExerciseSession['mode']): Promise<ExerciseSession | undefined> {
  return db.exerciseSessions.where('status').equals('active').filter(session => session.mode === mode).first()
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

/** Introduces the next curriculum group, then generates its exercises. Resumes an unfinished New session first. */
export async function startNewSession(signal?: AbortSignal): Promise<string> {
  const existing = await activeSession('new')
  if (existing) return existing.id
  const connection = await requireConnection()
  const catalog = await loadCatalog()
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  const next = nextGroup(catalog, known)
  if (!next) throw new Error('Every available curriculum group is already in your knowledge set.')
  const sessions = await db.exerciseSessions.toArray()
  const targetRefs = next.units.map(unit => unit.ref)
  const reviewRefs = recentReviewRefs(sessions, new Set(targetRefs)).filter(ref => known.has(ref))
  const allowed = [...new Map([...known, ...targetRefs].map(ref => [ref, requireUnit(catalog, ref)])).values()]
  const generated = await generateExercises(connection, {
    mode: 'new', targets: next.units, review: reviewRefs.map(ref => requireUnit(catalog, ref)), allowed, catalog,
  }, signal)
  const now = Date.now()
  return db.transaction('rw', db.knowledge, db.studyCards, db.exerciseSessions, async () => {
    const resumed = await activeSession('new')
    if (resumed) return resumed.id
    await addUnits(next.newUnits, 'new', now)
    return saveSession({
      id: crypto.randomUUID(), mode: 'new', domain: DOMAIN, groupId: next.group.id, targetRefs, reviewRefs,
      exercises: generated.exercises, cursor: 0, status: 'active', model: connection.model, rejected: generated.rejected, createdAt: now,
    })
  })
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
    .filter(card => known.has(card.ref) && catalog.units.has(card.ref))
    .sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref))
  const targets = cards.slice(0, REVIEW_ITEMS_PER_SESSION).map(card => requireUnit(catalog, card.ref))
  if (!targets.length) throw new Error(known.size ? 'Nothing is due for review right now.' : 'Your knowledge set is empty. Start with New, or add items from the Dictionary.')
  const allowed = [...known].map(ref => requireUnit(catalog, ref))
  const generated = await generateExercises(connection, { mode: 'review', targets, review: [], allowed, catalog }, signal)
  return db.transaction('rw', db.exerciseSessions, async () => {
    const resumed = await activeSession('review')
    if (resumed) return resumed.id
    return saveSession({
      id: crypto.randomUUID(), mode: 'review', domain: DOMAIN, targetRefs: targets.map(unit => unit.ref), reviewRefs: [],
      exercises: generated.exercises, cursor: 0, status: 'active', model: connection.model, rejected: generated.rejected, createdAt: Date.now(),
    })
  })
}

function schedulingState(card: StudyCard): SchedulingState {
  return { due: card.due, stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview }
}

export async function submitExerciseAnswer(sessionId: string, index: number, response: unknown): Promise<ExerciseAttempt> {
  return db.transaction('rw', db.exerciseSessions, db.exerciseAttempts, db.studyCards, async () => {
    const id = `${sessionId}:${index}`
    const existing = await db.exerciseAttempts.get(id)
    if (existing) return existing
    const session = await db.exerciseSessions.get(sessionId)
    if (!session || session.status !== 'active' || session.cursor !== index) throw new Error('This exercise is no longer active.')
    const exercise = session.exercises[index]
    const result = checkAnswer(exercise, response)
    const now = Date.now()
    const attempt: ExerciseAttempt = { id, sessionId, index, refs: exercise.targets, response: result.response, correct: result.correct, createdAt: now }
    await db.exerciseAttempts.add(attempt)
    const rating: Rating = result.correct ? 3 : 1
    for (const ref of exercise.targets) {
      const card = await db.studyCards.get(cardId(ref, DOMAIN))
      if (!card) continue // Items removed from the knowledge set are not rescheduled.
      await db.studyCards.put({ ...card, ...schedule(schedulingState(card), rating, now), updatedAt: now })
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
    if (index < session.exercises.length - 1) {
      await db.exerciseSessions.put({ ...session, cursor: index + 1 })
    } else {
      await db.exerciseSessions.put({ ...session, status: 'completed', completedAt: Date.now() })
    }
  })
}

/** Abandons an unfinished session. Recorded answers keep their scheduling effect. */
export async function discardSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.exerciseSessions, async () => {
    const session = await db.exerciseSessions.get(sessionId)
    if (!session || session.status !== 'active') return
    await db.exerciseSessions.put({ ...session, status: 'abandoned', completedAt: Date.now() })
  })
}
