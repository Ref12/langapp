import { z } from 'zod'
import { CONTENT_VERSION, getLesson, getStory, getWord, retiredLessonIds } from '../data/mandarin'
import type { Workspace } from './model'
import { assistantBackupSchema, speechRateSchema, speechVoicePreferencesSchema, type AssistantBackup } from './assistant/contracts'
import { studyBackupSchema, type StudyBackup } from './study/contracts'
import { characterStateSchema } from './characters/contracts'
import { librarySchema, type LibraryBook } from './library/contracts'

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024
const time = z.number().int().nonnegative()
const count = z.number().int().nonnegative()
const activity = z.enum(['meaning', 'form'])
const question = z.object({ wordId: z.string(), activity, options: z.array(z.string()).min(2).max(4), revealed: z.boolean() }).strict()
export const workspaceSchema = z.object({
  preferences: z.object({
    id: z.literal('workspace'), language: z.literal('zh-Hans'), name: z.string().trim().min(1).max(80),
    theme: z.enum(['dark', 'light']), pinyin: z.boolean(), readingMode: z.enum(['source', 'weave', 'target']), sidebarCollapsed: z.boolean(),
    speechVoices: speechVoicePreferencesSchema.optional(),
    defaultSpeechRate: speechRateSchema.optional(),
    sudokuAutoSpeak: z.boolean().optional(),
    sudokuShowPinyin: z.boolean().optional(),
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
  characterStates: z.array(characterStateSchema).max(100000).default([]),
}).strict()
const legacyBackupSchema = z.object({
  format: z.literal('linguaweave-next-backup'), version: z.literal(1),
  contentVersion: z.union([z.literal(1), z.literal(CONTENT_VERSION)]), exportedAt: time, workspace: workspaceSchema,
}).strict()
const backupSchema = z.discriminatedUnion('version', [
  legacyBackupSchema,
  legacyBackupSchema.extend({ version: z.literal(2), assistant: assistantBackupSchema }).strict(),
  legacyBackupSchema.extend({ version: z.literal(3), assistant: assistantBackupSchema, study: studyBackupSchema }).strict(),
  legacyBackupSchema.extend({ version: z.literal(4), assistant: assistantBackupSchema, study: studyBackupSchema }).strict(),
  legacyBackupSchema.extend({ version: z.literal(5), assistant: assistantBackupSchema, study: studyBackupSchema, library: librarySchema }).strict(),
])

export type WorkspaceBackup = Workspace & { assistant?: AssistantBackup; library?: LibraryBook[] }

const emptyStudy = (): StudyBackup => ({ knowledge: [], cards: [], sessions: [], attempts: [] })

export function splitStudy(workspace: WorkspaceBackup): { learning: Omit<WorkspaceBackup, 'assistant' | 'library' | 'knowledge' | 'studyCards' | 'exerciseSessions' | 'exerciseAttempts'>; assistant?: AssistantBackup; library: LibraryBook[]; study: StudyBackup } {
  const { assistant, library = [], knowledge = [], studyCards = [], exerciseSessions = [], exerciseAttempts = [], ...learning } = workspace
  return { learning, assistant, library, study: { knowledge, cards: studyCards, sessions: exerciseSessions, attempts: exerciseAttempts } }
}

function withStudy(workspace: z.infer<typeof workspaceSchema>, study: StudyBackup): Workspace {
  return { ...workspace, knowledge: study.knowledge, studyCards: study.cards, exerciseSessions: study.sessions, exerciseAttempts: study.attempts }
}

export function validateStudy(study: StudyBackup) {
  unique(study.knowledge.map(entry => entry.ref), 'knowledge items')
  unique(study.cards.map(card => card.id), 'study cards')
  unique(study.sessions.map(session => session.id), 'exercise sessions')
  unique(study.attempts.map(attempt => attempt.id), 'exercise answers')
  for (const entry of study.knowledge) {
    if (entry.ref !== `${entry.kind}:${entry.lb}`) throw new Error('Backup knowledge entry has inconsistent labels.')
  }
  const known = new Set(study.knowledge.map(entry => entry.ref))
  for (const card of study.cards) {
    if (card.id !== `${card.ref}:${card.domain}` || !known.has(card.ref)) throw new Error('Backup study card does not belong to a knowledge item.')
  }
  const sessions = new Map(study.sessions.map(session => [session.id, session]))
  for (const session of study.sessions) {
    if (session.cursor >= session.exercises.length) throw new Error('Backup has an invalid exercise position.')
  }
  for (const attempt of study.attempts) {
    const session = sessions.get(attempt.sessionId)
    if (!session || attempt.id !== `${attempt.sessionId}:${attempt.index}` || attempt.index >= session.exercises.length) {
      throw new Error('Backup contains an exercise answer without its session.')
    }
  }
}

function unique(values: unknown[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Backup contains duplicate ${label}.`)
}

function validateLessonReference(id: string) {
  if (!retiredLessonIds.includes(id)) getLesson(id)
}

export function validateAssistant(assistant: AssistantBackup) {
  unique(assistant.threads.map(thread => thread.id), 'Assistant threads')
  unique(assistant.messages.map(message => message.id), 'Assistant messages')
  unique(assistant.runs.map(run => run.id), 'Assistant runs')
  unique(assistant.messages.map(message => JSON.stringify([message.threadId, message.sequence])), 'Assistant message sequences')
  unique(assistant.runs.filter(run => run.status === 'running').map(run => run.threadId), 'running Assistant threads')
  const threads = new Set(assistant.threads.map(thread => thread.id))
  const messages = new Map(assistant.messages.map(message => [message.id, message]))
  const runs = new Map(assistant.runs.map(run => [run.id, run]))
  for (const message of assistant.messages) {
    if (!threads.has(message.threadId)) throw new Error('Backup Assistant message refers to a missing conversation.')
    if (message.practice && (message.role !== 'user' || message.intent !== 'repeat')) throw new Error('Backup practice attempts must be learner repetition messages.')
    if (message.role !== 'assistant' && message.status !== 'completed') throw new Error('Backup contains an invalid user or event message status.')
    if (message.role === 'event' && message.runId !== undefined) throw new Error('Backup mode events cannot belong to an Assistant run.')
    if (message.status === 'pending' && !message.runId) throw new Error('Backup contains an unowned pending Assistant message.')
    if (message.runId !== undefined) {
      const run = runs.get(message.runId)
      if (!run || run.threadId !== message.threadId
        || (message.role === 'user' ? run.userMessageId : run.assistantMessageId) !== message.id) {
        throw new Error('Backup contains inconsistent Assistant message ownership.')
      }
    }
  }
  for (const run of assistant.runs) {
    const user = messages.get(run.userMessageId)
    const reply = messages.get(run.assistantMessageId)
    if (!threads.has(run.threadId) || !user || !reply || user.role !== 'user' || reply.role !== 'assistant'
      || user.threadId !== run.threadId || reply.threadId !== run.threadId
      || user.runId !== run.id || reply.runId !== run.id || user.sequence >= reply.sequence) {
      throw new Error('Backup contains inconsistent Assistant run ownership or message references.')
    }
    const status = run.status === 'running' ? 'pending'
      : run.status === 'awaiting-learner' ? 'completed'
        : run.status === 'cancelled' ? 'cancelled' : 'failed'
    if (reply.status !== status) throw new Error('Backup contains inconsistent Assistant run and message statuses.')
  }
}

export function interruptImportedRuns(assistant: AssistantBackup) {
  const messages = new Map(assistant.messages.map(message => [message.id, message]))
  for (const run of assistant.runs) {
    if (run.status !== 'running') continue
    const error = 'This response was interrupted by restoring a backup. Review your message and send again when ready.'
    run.status = 'interrupted'
    run.error = error
    run.updatedAt = Math.max(run.updatedAt, Date.now())
    const reply = messages.get(run.assistantMessageId)!
    reply.status = 'failed'
    reply.error = error
  }
}

export function validateWorkspace(workspace: z.infer<typeof workspaceSchema>) {
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
  unique(workspace.characterStates.map(state => state.character), 'character states')
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
}

export function readBackup(text: string): WorkspaceBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('The backup exceeds the 5 MiB limit.')
  const backup = backupSchema.parse(JSON.parse(text))
  const { workspace } = backup
  validateWorkspace(workspace)
  if (backup.version !== 1) validateAssistant(backup.assistant)
  if ('study' in backup) validateStudy(backup.study)
  if (backup.version !== 1) {
    interruptImportedRuns(backup.assistant)
    return { ...withStudy(workspace, 'study' in backup ? backup.study : emptyStudy()), assistant: backup.assistant,
      ...('library' in backup && backup.library.length ? { library: backup.library } : {}) }
  }
  return withStudy(workspace, emptyStudy())
}

export function exportBackup(workspace: WorkspaceBackup, assistant?: AssistantBackup): string {
  const { learning, assistant: includedAssistant, study, library } = splitStudy(workspace)
  const snapshot = assistant ?? includedAssistant ?? { threads: [], messages: [], runs: [] }
  const text = JSON.stringify({ format: 'linguaweave-next-backup', version: 5, contentVersion: CONTENT_VERSION, exportedAt: Date.now(), workspace: learning, assistant: snapshot, study, library }, null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('This workspace exceeds the 5 MiB backup limit.')
  readBackup(text)
  return text
}
