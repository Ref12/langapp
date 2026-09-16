import { z } from 'zod'
import { CONTENT_VERSION, getLesson, getStory, getWord, retiredLessonIds } from '../data/mandarin'
import { db } from './database'
import type { Workspace } from './model'

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024
const time = z.number().int().nonnegative()
const count = z.number().int().nonnegative()
const activity = z.enum(['meaning', 'form'])
const question = z.object({ wordId: z.string(), activity, options: z.array(z.string()).min(2).max(4), revealed: z.boolean() }).strict()
const workspaceSchema = z.object({
  preferences: z.object({
    id: z.literal('workspace'), language: z.literal('zh-Hans'), name: z.string().trim().min(1).max(80),
    theme: z.enum(['dark', 'light']), pinyin: z.boolean(), readingMode: z.enum(['source', 'weave', 'target']), sidebarCollapsed: z.boolean(),
  }).strict(),
  words: z.array(z.object({
    wordId: z.string(), language: z.literal('zh-Hans'), introducedAt: time, introducedFrom: z.string().max(200),
    attempts: count, independentCorrect: count, successfulDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(3),
    successfulActivities: z.array(activity).max(2), dueAt: time,
  }).strict()).max(1000),
  readings: z.array(z.object({ storyId: z.string(), passage: count, completed: z.array(count), updatedAt: time }).strict()).max(1000),
  lessons: z.array(z.object({ lessonId: z.string(), startedAt: time, completedAt: time.optional() }).strict()).max(1000),
  sessions: z.array(z.object({
    id: z.string().min(1), kind: z.enum(['lesson', 'due', 'all']), lessonId: z.string().optional(),
    questions: z.array(question).min(1).max(100), cursor: count, status: z.enum(['active', 'completed']), createdAt: time, completedAt: time.optional(),
  }).strict()).max(10000),
  attempts: z.array(z.object({
    id: z.string(), sessionId: z.string(), question: count, wordId: z.string(), activity, answerId: z.string(),
    correct: z.boolean(), assisted: z.boolean(), createdAt: time,
  }).strict()).max(50000),
}).strict()
const backupSchema = z.object({
  format: z.literal('linguaweave-next-backup'), version: z.literal(1),
  contentVersion: z.union([z.literal(1), z.literal(CONTENT_VERSION)]), exportedAt: time, workspace: workspaceSchema,
}).strict()

function unique(values: unknown[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Backup contains duplicate ${label}.`)
}

function validateLessonReference(id: string) {
  if (!retiredLessonIds.includes(id)) getLesson(id)
}

export function readBackup(text: string): Workspace {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('The backup exceeds the 5 MiB limit.')
  const { workspace } = backupSchema.parse(JSON.parse(text))
  for (const word of workspace.words) {
    getWord(word.wordId)
    unique(word.successfulDays, 'practice days')
    unique(word.successfulActivities, 'practice activities')
    if (word.independentCorrect > word.attempts) throw new Error('Backup word counts are inconsistent.')
  }
  for (const reading of workspace.readings) {
    const story = getStory(reading.storyId)
    unique(reading.completed, 'completed passages')
    if ([reading.passage, ...reading.completed].some(index => index >= story.passages.length)) throw new Error('Backup refers to a missing passage.')
  }
  workspace.lessons.forEach(lesson => validateLessonReference(lesson.lessonId))
  unique(workspace.words.map(word => word.wordId), 'words')
  unique(workspace.readings.map(reading => reading.storyId), 'stories')
  unique(workspace.lessons.map(lesson => lesson.lessonId), 'lessons')
  unique(workspace.sessions.map(session => session.id), 'sessions')
  unique(workspace.attempts.map(attempt => attempt.id), 'attempts')
  const wordIds = new Set(workspace.words.map(word => word.wordId))
  const sessions = new Map(workspace.sessions.map(session => [session.id, session]))
  const attempts = new Map(workspace.attempts.map(attempt => [attempt.id, attempt]))
  for (const session of workspace.sessions) {
    if (session.cursor >= session.questions.length) throw new Error('Backup has an invalid practice position.')
    if (session.kind === 'lesson') {
      if (!session.lessonId || !workspace.lessons.some(lesson => lesson.lessonId === session.lessonId)) throw new Error('Backup is missing a lesson for its practice session.')
      validateLessonReference(session.lessonId)
    } else if (session.lessonId) throw new Error('A vocabulary review cannot claim lesson completion.')
    for (const [index, item] of session.questions.entries()) {
      getWord(item.wordId)
      item.options.forEach(getWord)
      unique(item.options, 'answer options')
      if (!wordIds.has(item.wordId) || !item.options.includes(item.wordId)) throw new Error('Backup practice is missing a learning item or correct option.')
      const answered = attempts.has(`${session.id}:${index}`)
      if ((index < session.cursor || session.status === 'completed') && !answered) throw new Error('Backup is missing a saved practice answer.')
      if (index > session.cursor && answered) throw new Error('Backup has an answer beyond the saved practice position.')
    }
    if (session.status === 'completed' && (session.cursor !== session.questions.length - 1 || session.completedAt === undefined)) throw new Error('Backup has an incomplete finished session.')
  }
  for (const attempt of workspace.attempts) {
    const item = sessions.get(attempt.sessionId)?.questions[attempt.question]
    if (!item || attempt.id !== `${attempt.sessionId}:${attempt.question}` || item.wordId !== attempt.wordId
      || item.activity !== attempt.activity || !item.options.includes(attempt.answerId)
      || attempt.correct !== (attempt.answerId === item.wordId) || attempt.assisted !== item.revealed) {
      throw new Error('Backup contains an inconsistent practice answer.')
    }
  }
  return workspace
}

export function exportBackup(workspace: Workspace): string {
  const text = JSON.stringify({ format: 'linguaweave-next-backup', version: 1, contentVersion: CONTENT_VERSION, exportedAt: Date.now(), workspace }, null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('This workspace exceeds the 5 MiB backup limit.')
  return text
}

export async function restoreBackup(text: string): Promise<void> {
  const workspace = readBackup(text)
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
    await db.preferences.add(workspace.preferences)
    await db.words.bulkAdd(workspace.words)
    await db.readings.bulkAdd(workspace.readings)
    await db.lessons.bulkAdd(workspace.lessons)
    await db.sessions.bulkAdd(workspace.sessions)
    await db.attempts.bulkAdd(workspace.attempts)
  })
}
