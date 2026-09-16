import Dexie, { type EntityTable } from 'dexie'
import { LANGUAGE, type Attempt, type LessonProgress, type PracticeSession, type Preferences, type ReadingProgress, type WordState, type Workspace } from './model'
import type { AIConnection, AssistantMessage, AssistantRun, AssistantThread } from './assistant/contracts'

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
  }
}

export const db = new LearningDatabase()

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
  return db.transaction('r', [db.preferences, db.words, db.readings, db.lessons, db.sessions, db.attempts], async () => {
    const preferences = await db.preferences.get('workspace')
    if (!preferences) throw new Error('Your workspace has not been initialized. Reload to try again.')
    return {
      preferences,
      words: await db.words.toArray(),
      readings: await db.readings.toArray(),
      lessons: await db.lessons.toArray(),
      sessions: await db.sessions.toArray(),
      attempts: await db.attempts.toArray(),
    }
  })
}
