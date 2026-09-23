import Dexie, { type EntityTable } from 'dexie'
import { LANGUAGE, type Attempt, type LessonProgress, type PracticeSession, type Preferences, type ReadingProgress, type WordState, type Workspace } from './model'
import type { AIConnection, AssistantMessage, AssistantRun, AssistantThread } from './assistant/contracts'
import type { SpeechConnection } from './assistant/speech-contracts'
import type { ExerciseAttempt, ExerciseSession, KnowledgeEntry, StudyCard } from './study/contracts'
import { DEFAULT_PROFILE_ID, profileIdSchema } from './profiles/identity'

export class LearningDatabase extends Dexie {
  preferences!: EntityTable<Preferences, 'id'>
  words!: EntityTable<WordState, 'wordId'>
  readings!: EntityTable<ReadingProgress, 'storyId'>
  lessons!: EntityTable<LessonProgress, 'lessonId'>
  sessions!: EntityTable<PracticeSession, 'id'>
  attempts!: EntityTable<Attempt, 'id'>
  assistantThreads!: EntityTable<AssistantThread, 'id'>
  assistantMessages!: EntityTable<AssistantMessage, 'id'>
  assistantRuns!: EntityTable<AssistantRun, 'id'>
  aiConnections!: EntityTable<AIConnection, 'id'>
  speechConnections!: EntityTable<SpeechConnection, 'id'>
  knowledge!: EntityTable<KnowledgeEntry, 'ref'>
  studyCards!: EntityTable<StudyCard, 'id'>
  exerciseSessions!: EntityTable<ExerciseSession, 'id'>
  exerciseAttempts!: EntityTable<ExerciseAttempt, 'id'>
  profileState!: EntityTable<{ id: 'local-settings'; imported: true }, 'id'>

  constructor(name = 'linguaweave-next') {
    super(name)
    this.version(1).stores({
      preferences: '&id',
      words: '&wordId, dueAt',
      readings: '&storyId, updatedAt',
      lessons: '&lessonId',
      sessions: '&id, status, createdAt',
      attempts: '&id, sessionId, wordId, createdAt',
    })
    this.version(2).stores({
      assistantThreads: '&id, updatedAt',
      assistantMessages: '&id, threadId, &[threadId+sequence], runId',
      assistantRuns: '&id, threadId, status, expiresAt, [threadId+status]',
      aiConnections: '&id',
    })
    this.version(3).stores({
      speechConnections: '&id',
    })
    this.version(4).stores({
      knowledge: '&ref, kind, band, addedAt',
      studyCards: '&id, ref, domain, due, [domain+due]',
      exerciseSessions: '&id, status, mode, createdAt',
      exerciseAttempts: '&id, sessionId, createdAt',
    })
    this.version(5).stores({ profileState: '&id' })
  }
}

export let db = new LearningDatabase()
let configuredProfileId: string | undefined

export function profileDatabaseName(id: string): string {
  const safeId = profileIdSchema.parse(id)
  return safeId === DEFAULT_PROFILE_ID ? 'linguaweave-next' : `linguaweave-next-profile-${safeId}`
}

export function configureDatabaseForProfile(id: string): void {
  const safeId = profileIdSchema.parse(id)
  if (configuredProfileId !== undefined && configuredProfileId !== safeId) {
    throw new Error('Reload the page to switch profiles.')
  }
  const name = profileDatabaseName(safeId)
  if (db.name !== name) {
    if (db.isOpen()) throw new Error('Profiles must be initialized before opening the workspace.')
    db.close()
    db = new LearningDatabase(name)
  }
  configuredProfileId = safeId
}

export function resetDatabaseForTests(): void {
  if (import.meta.env?.MODE !== 'test') throw new Error('Database reset is only available in tests.')
  db.close()
  db = new LearningDatabase()
  configuredProfileId = undefined
}

export async function initializeWorkspace(): Promise<void> {
  await db.transaction('rw', db.preferences, async () => {
    if (!await db.preferences.get('workspace')) {
      await db.preferences.add({
        id: 'workspace', language: LANGUAGE, name: 'Your workspace',
        theme: 'dark', pinyin: true, readingMode: 'weave', sidebarCollapsed: false,
      })
    }
  })
}

export async function loadWorkspace(): Promise<Workspace> {
  return db.transaction('r', [db.preferences, db.words, db.readings, db.lessons, db.sessions, db.attempts,
    db.knowledge, db.studyCards, db.exerciseSessions, db.exerciseAttempts], async () => {
    const preferences = await db.preferences.get('workspace')
    if (!preferences) throw new Error('Your workspace has not been initialized. Reload to try again.')
    return {
      preferences,
      words: await db.words.toArray(),
      readings: await db.readings.toArray(),
      lessons: await db.lessons.toArray(),
      sessions: await db.sessions.toArray(),
      attempts: await db.attempts.toArray(),
      knowledge: await db.knowledge.toArray(),
      studyCards: await db.studyCards.toArray(),
      exerciseSessions: await db.exerciseSessions.toArray(),
      exerciseAttempts: await db.exerciseAttempts.toArray(),
    }
  })
}
